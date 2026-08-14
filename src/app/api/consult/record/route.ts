/**
 * Start / stop the recorded visit record.
 *
 * POST   /api/consult/record  { sessionId }
 * DELETE /api/consult/record  { sessionId }
 *
 * Both paths refuse under transport-only posture: a recorded consult is PHI
 * at rest with a third party, which is the exact thing a BAA governs.
 */
import { NextResponse } from "next/server";

import { PhiPostureError, missingEnv } from "@/lib/agora/config";
import { startRecording, stopRecording } from "@/lib/agora/recording";
import { getSession, updateSession } from "@/lib/agora/session";
import { BOT_UIDS, mintRtcToken } from "@/lib/agora/token";
import { requirePatientAuth } from "@/lib/require-patient-auth";

async function resolve(request: Request) {
  let body: { sessionId?: unknown };
  try {
    body = (await request.json()) as { sessionId?: unknown };
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const session = getSession(sessionId);
  if (!session) {
    return {
      error: NextResponse.json({ error: "Unknown or expired session" }, { status: 404 }),
    };
  }
  return { session };
}

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

  const resolved = await resolve(request);
  if ("error" in resolved) return resolved.error;
  const { session } = resolved;

  if (session.recording) {
    return NextResponse.json({ error: "Already recording" }, { status: 409 });
  }

  try {
    const botToken = mintRtcToken({
      channel: session.channel,
      uid: BOT_UIDS.recorder,
      role: "observer",
    });

    const handle = await startRecording({
      channel: session.channel,
      token: botToken.token,
      uids: session.humanUids,
    });

    updateSession(session.sessionId, {
      recording: { resourceId: handle.resourceId, sid: handle.sid },
    });

    return NextResponse.json({ recording: true, sid: handle.sid });
  } catch (error) {
    if (error instanceof PhiPostureError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start recording" },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request) {
  const unauthorized = requirePatientAuth(request);
  if (unauthorized) return unauthorized;

  const resolved = await resolve(request);
  if ("error" in resolved) return resolved.error;
  const { session } = resolved;

  if (!session.recording) {
    return NextResponse.json({ recording: false, reason: "not recording" });
  }

  try {
    const files = await stopRecording({
      resourceId: session.recording.resourceId,
      sid: session.recording.sid,
      channel: session.channel,
    });
    updateSession(session.sessionId, { recording: undefined });
    return NextResponse.json({ recording: false, files });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to stop recording" },
      { status: 502 },
    );
  }
}
