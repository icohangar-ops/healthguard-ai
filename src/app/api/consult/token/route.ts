/**
 * Mint an RTC token and open a consult session.
 *
 * POST /api/consult/token
 *   { patientId?: string, role: "patient" | "clinician" | "observer", displayName: string }
 *
 * Returns everything the browser needs to join the Agora channel, plus the
 * capability set so the UI can render honestly — a greyed-out "Record visit"
 * button with a reason beats a button that fails at the moment of use.
 */
import { NextResponse } from "next/server";

import { capabilities, missingEnv, resolvePosture } from "@/lib/agora/config";
import { createSession } from "@/lib/agora/session";
import { consultChannel, humanUid, mintRtcToken, type ConsultRole } from "@/lib/agora/token";
import { requirePatientAuth } from "@/lib/require-patient-auth";

const ROLES: ReadonlySet<string> = new Set(["patient", "clinician", "observer"]);

export async function POST(request: Request) {
  const unauthorized = requirePatientAuth(request);
  if (unauthorized) return unauthorized;

  const missing = missingEnv(false);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Agora is not configured. Missing: ${missing.join(", ")}` },
      { status: 503 },
    );
  }

  let body: { patientId?: unknown; role?: unknown; displayName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const role = typeof body.role === "string" ? body.role : "";
  if (!ROLES.has(role)) {
    return NextResponse.json(
      { error: `role must be one of: ${[...ROLES].join(", ")}` },
      { status: 400 },
    );
  }

  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (displayName === "" || displayName.length > 80) {
    return NextResponse.json(
      { error: "displayName is required (1-80 characters)" },
      { status: 400 },
    );
  }

  const patientId =
    typeof body.patientId === "string" && body.patientId.trim() !== ""
      ? body.patientId.trim()
      : null;

  // A consult is identified by the patient when there is one, otherwise it is
  // an anonymous walk-up and gets a random room.
  const consultId = patientId ?? `anon-${Date.now().toString(36)}`;

  let channel: string;
  try {
    channel = consultChannel(consultId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "invalid consult id" },
      { status: 400 },
    );
  }

  const uid = humanUid(`${channel}:${role}:${displayName}`);

  let minted;
  try {
    minted = mintRtcToken({ channel, uid, role: role as ConsultRole });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "token minting failed" },
      { status: 500 },
    );
  }

  const session = createSession({ channel, patientId, humanUids: [uid] });
  const { posture, reason } = resolvePosture();

  return NextResponse.json({
    appId: minted.appId,
    channel: minted.channel,
    token: minted.token,
    uid: minted.uid,
    role: minted.role,
    expiresAt: minted.expiresAt,
    sessionId: session.sessionId,
    capabilities: capabilities(),
    phi: { posture, reason },
  });
}
