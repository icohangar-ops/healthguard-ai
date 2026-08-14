/**
 * Start / stop the recorded consult.
 *
 * POST   /api/consult/record  { sessionId }
 * DELETE /api/consult/record  { sessionId }
 *
 * Only POST refuses under transport-only posture. DELETE stays open so an
 * active recording can always be stopped after a posture change.
 */
import { NextResponse } from "next/server";

import { missingEnv } from "@/lib/agora/config";
import { startRecording, stopRecording } from "@/lib/agora/recording";
import { consultErrorResponse } from "@/lib/agora/rest";
import { getSession, releaseSlot, reserveSlot, updateSession } from "@/lib/agora/session";
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

function restConfigError(): NextResponse | null {
  const missing = missingEnv(true);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Agora REST is not configured. Missing: ${missing.join(", ")}` },
      { status: 503 },
    );
  }
  return null;
}

export async function POST(request: Request) {
  const unauthorized = requirePatientAuth(request);
  if (unauthorized) return unauthorized;

  const misconfigured = restConfigError();
  if (misconfigured) return misconfigured;

  const resolved = await resolve(request);
  if ("error" in resolved) return resolved.error;
  const { session } = resolved;

  if (!reserveSlot(session.sessionId, "recording")) {
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
      // Empty list = subscribe to everyone, including late joiners (e.g. a
      // clinician who enters after record is already on). A whitelist of
      // session.humanUids would miss anyone who joins after this call.
      uids: [],
    });

    updateSession(session.sessionId, {
      recording: { resourceId: handle.resourceId, sid: handle.sid },
    });

    return NextResponse.json({ recording: true, sid: handle.sid });
  } catch (error) {
    releaseSlot(session.sessionId, "recording");
    return consultErrorResponse(error, "Failed to start recording");
  }
}

export async function DELETE(request: Request) {
  const unauthorized = requirePatientAuth(request);
  if (unauthorized) return unauthorized;

  const misconfigured = restConfigError();
  if (misconfigured) return misconfigured;

  const resolved = await resolve(request);
  if ("error" in resolved) return resolved.error;
  const { session } = resolved;

  if (!session.recording || session.recording.sid === "") {
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
    return consultErrorResponse(error, "Failed to stop recording");
  }
}
