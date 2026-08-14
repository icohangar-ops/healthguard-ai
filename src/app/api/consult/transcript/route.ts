/**
 * Start / stop live captions for a consult.
 *
 * POST   /api/consult/transcript  { sessionId, languages?, persist? }
 * DELETE /api/consult/transcript  { sessionId }
 *
 * Live captions run under any posture — they are an accessibility feature and
 * nothing is stored. `persist: true` (durable transcript in the visit record)
 * is BAA-gated.
 */
import { NextResponse } from "next/server";

import { PhiPostureError, capabilities, missingEnv } from "@/lib/agora/config";
import { getSession, updateSession } from "@/lib/agora/session";
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
  if (session.transcriptionAgentId) {
    return NextResponse.json({ error: "Captions already running" }, { status: 409 });
  }

  const languages = Array.isArray(body.languages)
    ? body.languages.filter((l): l is string => typeof l === "string")
    : ["en-US"];

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
    if (error instanceof PhiPostureError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start captions" },
      { status: 502 },
    );
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
  if (!session.transcriptionAgentId) {
    return NextResponse.json({ stopped: false, reason: "captions not running" });
  }

  try {
    await stopTranscription(session.transcriptionAgentId);
    updateSession(session.sessionId, { transcriptionAgentId: undefined });
    return NextResponse.json({ stopped: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to stop captions" },
      { status: 502 },
    );
  }
}
