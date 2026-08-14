/**
 * Start / stop live captions for a consult.
 *
 * POST   /api/consult/transcript  { sessionId, languages?, persist? }
 * DELETE /api/consult/transcript  { sessionId }
 *
 * Live captions run under any posture — they are an accessibility feature and
 * nothing is stored. `persist: true` (durable transcript in object storage)
 * is BAA-gated. Caption *rendering* in the UI is not wired yet.
 */
import { NextResponse } from "next/server";

import { capabilities, missingEnv } from "@/lib/agora/config";
import { consultErrorResponse } from "@/lib/agora/rest";
import { getSession, releaseSlot, reserveSlot, updateSession } from "@/lib/agora/session";
import { startTranscription, stopTranscription } from "@/lib/agora/transcription";
import { requirePatientAuth } from "@/lib/require-patient-auth";

export async function POST(request: Request) {
  const unauthorized = requirePatientAuth(request);
  if (unauthorized) return unauthorized;

  const missing = missingEnv(true);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Agora REST is not configured. Missing: ${missing.join(", ")}` },
      { status: 503 },
    );
  }

  let body: { sessionId?: unknown; languages?: unknown; persist?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const session = getSession(typeof body.sessionId === "string" ? body.sessionId : "");
  if (!session) {
    return NextResponse.json({ error: "Unknown or expired session" }, { status: 404 });
  }

  const requested = Array.isArray(body.languages)
    ? body.languages.filter((l): l is string => typeof l === "string" && l.trim() !== "")
    : [];
  if (Array.isArray(body.languages) && requested.length === 0) {
    return NextResponse.json(
      { error: "languages must contain 1-4 non-empty language tags" },
      { status: 400 },
    );
  }
  if (requested.length > 4) {
    return NextResponse.json({ error: "languages accepts at most 4 tags" }, { status: 400 });
  }
  const languages = requested.length > 0 ? requested : ["en-US"];

  if (!reserveSlot(session.sessionId, "transcriptionAgentId")) {
    return NextResponse.json({ error: "Captions already running" }, { status: 409 });
  }

  try {
    const task = await startTranscription({
      channel: session.channel,
      subscribeAudioUids: session.humanUids,
      languages,
      persist: body.persist === true,
    });

    updateSession(session.sessionId, { transcriptionAgentId: task.agentId });

    return NextResponse.json({
      agentId: task.agentId,
      status: task.status,
      persisted: task.persisted,
      captionsOnly: !capabilities().storedTranscript,
    });
  } catch (error) {
    releaseSlot(session.sessionId, "transcriptionAgentId");
    return consultErrorResponse(error, "Failed to start captions");
  }
}

export async function DELETE(request: Request) {
  const unauthorized = requirePatientAuth(request);
  if (unauthorized) return unauthorized;

  let sessionId = "";
  try {
    const body = (await request.json()) as { sessionId?: unknown };
    sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Unknown or expired session" }, { status: 404 });
  }
  if (!session.transcriptionAgentId || session.transcriptionAgentId === "pending") {
    return NextResponse.json({ stopped: false, reason: "captions not running" });
  }

  try {
    await stopTranscription(session.transcriptionAgentId);
    updateSession(session.sessionId, { transcriptionAgentId: undefined });
    return NextResponse.json({ stopped: true });
  } catch (error) {
    return consultErrorResponse(error, "Failed to stop captions");
  }
}
