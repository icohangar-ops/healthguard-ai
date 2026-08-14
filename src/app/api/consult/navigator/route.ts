/**
 * Start / stop the Agora voice navigator for a consult session.
 *
 * POST   /api/consult/navigator  { sessionId, language? }
 * DELETE /api/consult/navigator  { sessionId }
 */
import { NextResponse } from "next/server";

import { missingEnv } from "@/lib/agora/config";
import { startNavigator, stopNavigator } from "@/lib/agora/navigator";
import { consultErrorResponse } from "@/lib/agora/rest";
import { getSession, releaseSlot, reserveSlot, updateSession } from "@/lib/agora/session";
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
  if (!reserveSlot(session.sessionId, "navigatorAgentId")) {
    return NextResponse.json(
      { error: "Navigator is already running for this session" },
      { status: 409 },
    );
  }

  const language = typeof body.language === "string" ? body.language : "en-US";

  try {
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
        : "Navigator is running without patient context.",
    });
  } catch (error) {
    releaseSlot(session.sessionId, "navigatorAgentId");
    return consultErrorResponse(error, "Failed to start navigator");
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
  if (!session.navigatorAgentId || session.navigatorAgentId === "pending") {
    return NextResponse.json({ stopped: false, reason: "no navigator running" });
  }

  try {
    await stopNavigator(session.navigatorAgentId);
    updateSession(session.sessionId, { navigatorAgentId: undefined });
    return NextResponse.json({ stopped: true });
  } catch (error) {
    return consultErrorResponse(error, "Failed to stop navigator");
  }
}
