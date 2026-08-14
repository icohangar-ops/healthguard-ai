/**
 * OpenAI-compatible bridge that Agora's Conversational AI Engine calls.
 *
 * Agora runs ASR and TTS; the *thinking* happens here, so the spoken navigator
 * and the typed dashboard chat share one brain and one set of safety rules.
 *
 * This endpoint is the PHI gate's teeth. Agora only ever sends us an opaque
 * session id (planted as a system message when the agent was created). We
 * resolve it to a patient locally, and inject that record into the prompt
 * ONLY when both an Agora BAA *and* HEALTHGUARD_LLM_PHI_POSTURE=attested are
 * set. An Agora BAA does not authorize the LLM provider. Under transport-only
 * the navigator is still fully useful — it just does not know who it is
 * talking to.
 *
 * POST /api/consult/navigator/llm/chat/completions
 * Auth: Bearer AGORA_LLM_BRIDGE_KEY
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import ZAI, { type ChatMessage } from "z-ai-web-dev-sdk";

import { capabilities } from "@/lib/agora/config";
import { getSession } from "@/lib/agora/session";
import { VOICE_SYSTEM_PROMPT, withPatientContext } from "@/lib/clinical-prompt";
import { db } from "@/lib/db";
import { retry, withTimeout } from "@/lib/resilience";
import { scoreVitals } from "@/lib/vitals-scoring";

const zai = await ZAI.create();

const SESSION_PREFIX = "healthguard-session:";

/**
 * A spoken turn cannot be long, and a slow turn is worse than a short one —
 * dead air on a voice call reads as "it broke". Bound both.
 */
const MAX_TOKENS = 220;
const TURN_TIMEOUT_MS = 12_000;
/** Agora's max_history is 16; keep the bridge at the same bound. */
const MAX_TURNS = 16;
const MAX_TURN_CHARS = 4_000;

interface OpenAiRequest {
  messages?: Array<{ role: string; content: string }>;
  stream?: boolean;
  model?: string;
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function authorized(request: Request): boolean {
  const expected = (process.env.AGORA_LLM_BRIDGE_KEY ?? "").trim();
  // Fail closed: an unset key means nobody gets in, not everybody.
  if (expected === "") return false;

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (presented === "") return false;

  return constantTimeEqual(presented, expected);
}

/** Pull the session id out of the system message Agora replays to us. */
function extractSessionId(messages: Array<{ role: string; content: string }>): string | null {
  for (const message of messages) {
    if (message.role !== "system") continue;
    const index = message.content.indexOf(SESSION_PREFIX);
    if (index === -1) continue;
    const value = message.content.slice(index + SESSION_PREFIX.length).trim().split(/\s/)[0];
    if (value) return value;
  }
  return null;
}

function boundTurns(
  turns: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  const recent = turns.slice(-MAX_TURNS);
  let remaining = MAX_TURN_CHARS;
  const kept: Array<{ role: string; content: string }> = [];
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const turn = recent[i];
    if (turn.content.length > remaining) break;
    remaining -= turn.content.length;
    kept.unshift(turn);
  }
  return kept;
}

/**
 * Build the spoken-language patient summary.
 *
 * Deliberately terse: this is read by a model that has ~60 words to answer in,
 * so a wall of history crowds out the actual question.
 */
async function patientContextFor(patientId: string): Promise<string | null> {
  const patient = await db.patient.findUnique({
    where: { id: patientId },
    include: { vitals: { orderBy: { recordedAt: "desc" }, take: 1 } },
  });
  if (!patient) return null;

  const lines = [
    `Name: ${patient.name}, age ${patient.age}, ${patient.gender}`,
    patient.conditions ? `Known conditions: ${patient.conditions}` : null,
    patient.medications ? `Medications: ${patient.medications}` : null,
  ].filter((l): l is string => l !== null);

  const latest = patient.vitals[0];
  if (latest) {
    lines.push(
      `Latest vitals: HR ${latest.heartRate}, BP ${latest.systolic}/${latest.diastolic}, ` +
        `temp ${latest.temperature}F, SpO2 ${latest.spo2}%`,
    );
    const alerts = scoreVitals({
      heartRate: latest.heartRate,
      systolic: latest.systolic,
      diastolic: latest.diastolic,
      temperature: latest.temperature,
      spo2: latest.spo2,
    });
    if (alerts.length > 0) {
      lines.push(`Active vitals flags: ${alerts.map((a) => a.message).join("; ")}`);
    }
  }

  return lines.join("\n");
}

/** Shape a completion the way Agora's OpenAI-compatible client expects. */
function completionBody(content: string, model: string) {
  return {
    id: `healthguard-${Date.now().toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  };
}

/**
 * Agora's client prefers a streaming response. We do not get incremental
 * tokens back from the SDK, so emit the finished turn as a single delta plus
 * the terminator — valid SSE, and the perceived latency is the same because
 * TTS cannot start before the sentence is chosen anyway.
 */
function streamBody(content: string, model: string): Response {
  const chunk = {
    id: `healthguard-${Date.now().toString(36)}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: "stop" }],
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

const FALLBACK =
  "Sorry, I am having trouble right now. If this feels like an emergency, " +
  "please hang up and call your local emergency number. Otherwise, please try again in a moment.";

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: OpenAiRequest;
  try {
    body = (await request.json()) as OpenAiRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const model = body.model ?? "healthguard-navigator";

  const turns = boundTurns(
    incoming.filter(
      (m) => m.role !== "system" && typeof m.content === "string" && m.content !== "",
    ),
  );

  let context: string | null = null;
  const caps = capabilities();
  if (caps.phiInPrompt) {
    const sessionId = extractSessionId(incoming);
    const session = sessionId ? getSession(sessionId) : null;
    if (session?.patientId) {
      try {
        context = await patientContextFor(session.patientId);
      } catch {
        context = null;
      }
    }
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: withPatientContext(VOICE_SYSTEM_PROMPT, context ?? undefined, "plain"),
    },
    ...turns.map((m) => ({ role: m.role as ChatMessage["role"], content: m.content })),
  ];

  let content: string;
  try {
    const completion = await retry(
      () =>
        withTimeout(
          zai.chat.completions.create({ messages, max_tokens: MAX_TOKENS }),
          TURN_TIMEOUT_MS,
          "navigator turn",
        ),
      { maxAttempts: 2 },
    );
    content = completion.choices[0]?.message?.content?.trim() || FALLBACK;
  } catch {
    content = FALLBACK;
  }

  return body.stream === true
    ? streamBody(content, model)
    : NextResponse.json(completionBody(content, model));
}
