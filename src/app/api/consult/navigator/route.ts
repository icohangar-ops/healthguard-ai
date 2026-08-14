/**
 * Start / stop the Agora voice navigator for a consult session.
 *
 * POST   /api/consult/navigator  { sessionId, language? }
 * DELETE /api/consult/navigator  { sessionId }
 */
import { NextResponse } from "next/server";

import { PhiPostureError, missingEnv } from "@/lib/agora/config";
import { startNavigator, stopNavigator } from "@/lib/agora/navigator";
import { getSession, updateSession } from "@/lib/agora/session";
import { BOT_UIDS, mintRtcToken } from "@/lib/agora/token";
import { requirePatientAuth } from "@/lib/require-patient-auth";

function configError(): NextResponse | null {
  const missing = missingEnv(true);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Agora REST is not configured. Missing: ${missing.join(", ")}` },
      { status: 503 },
    );
  }
  return null;
}

async function readSessionId(request: Request): Promise<string | null> {
  try {
    const body = (await request.json()) as { sessionId?: unknown };
    return typeof body.sessionId === "string" && body.sessionId !== ""
      ? body.sessionId
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const unauthorized = requirePatientAuth(request);
  if (unauthorized) return unauthorized;

  const misconfigured = configError();
  if (misconfigured) return misconfigured;

  let body: { sessionId?: unknown; language?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Unknown or expired session" }, { status: 404 });
  }
  if (session.navigatorAgentId) {
    return NextResponse.json(
      { error: "Navigator is already running for this session" },
      { status: 409 },
    );
  }

  const language = typeof body.language === "string" ? body.language : "en-US";

  try {
    // The navigator joins as its own reserved uid, with its own token.
    const botToken = mintRtcToken({
      channel: session.channel,
      uid: BOT_UIDS.navigator,
      role: "clinician",
    });

    const agent = await startNavigator({
      channel: session.channel,
      token: botToken.token,
      listenTo: session.humanUids,
      sessionId: session.sessionId,
      language,
    });

    updateSession(session.sessionId, { navigatorAgentId: agent.agentId });

    return NextResponse.json({
      agentId: agent.agentId,
      status: agent.status,
      phiEnabled: agent.phiEnabled,
      notice: agent.phiEnabled
        ? "Navigator has access to this patient's record."
        : "Navigator is running without patient context (no BAA on file).",
    });
  } catch (error) {
    if (error instanceof PhiPostureError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start navigator" },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request) {
  const unauthorized = requirePatientAuth(request);
  if (unauthorized) return unauthorized;

  const misconfigured = configError();
  if (misconfigured) return misconfigured;

  const sessionId = await readSessionId(request);
  const session = sessionId ? getSession(sessionId) : null;
  if (!session) {
    return NextResponse.json({ error: "Unknown or expired session" }, { status: 404 });
  }
  if (!session.navigatorAgentId) {
    return NextResponse.json({ stopped: false, reason: "no navigator running" });
  }

  try {
    await stopNavigator(session.navigatorAgentId);
    updateSession(session.sessionId, { navigatorAgentId: undefined });
    return NextResponse.json({ stopped: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to stop navigator" },
      { status: 502 },
    );
  }
}
