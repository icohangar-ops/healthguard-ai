/**
 * Mint an RTC token and open (or rejoin) a consult session.
 *
 * POST /api/consult/token
 *   { patientId?: string, role, displayName, sessionId?: string, uid?: number }
 *
 * Auth is the same shared PATIENT_API_TOKEN as /api/patients and /api/chat —
 * a service credential, not a per-user session. There is no authenticated
 * subject to bind the channel to. Role is therefore a declared consult role
 * (enforced in the Agora token privileges), not an identity claim.
 *
 * Renewal: pass the existing sessionId (and uid) so we mint for the same
 * channel instead of opening a new room.
 */
import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { capabilities, missingEnv, resolvePosture } from "@/lib/agora/config";
import { getSession, joinSession } from "@/lib/agora/session";
import { consultChannel, humanUid, mintRtcToken, type ConsultRole } from "@/lib/agora/token";
import { db } from "@/lib/db";
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

  let body: {
    patientId?: unknown;
    role?: unknown;
    displayName?: unknown;
    sessionId?: unknown;
    uid?: unknown;
  };
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

  const existingSessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  if (existingSessionId) {
    return renew(existingSessionId, role as ConsultRole, body.uid);
  }

  const patientId =
    typeof body.patientId === "string" && body.patientId.trim() !== ""
      ? body.patientId.trim()
      : null;

  if (patientId) {
    const patient = await db.patient.findUnique({
      where: { id: patientId },
      select: { id: true },
    });
    if (!patient) {
      return NextResponse.json({ error: "Unknown patient" }, { status: 404 });
    }
  }

  const consultId = patientId ?? randomUUID();

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
  return mintAndJoin({ channel, uid, role: role as ConsultRole, patientId });
}

async function renew(sessionId: string, role: ConsultRole, rawUid: unknown) {
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Unknown or expired session" }, { status: 404 });
  }

  let uid: number;
  if (typeof rawUid === "number" && Number.isInteger(rawUid) && session.humanUids.includes(rawUid)) {
    uid = rawUid;
  } else {
    uid = humanUid(`${session.channel}:${role}:renew`);
    joinSession({ channel: session.channel, patientId: session.patientId, uid });
  }

  return mintAndJoin({
    channel: session.channel,
    uid,
    role,
    patientId: session.patientId,
  });
}

function mintAndJoin(input: {
  channel: string;
  uid: number;
  role: ConsultRole;
  patientId: string | null;
}) {
  let minted;
  try {
    minted = mintRtcToken({ channel: input.channel, uid: input.uid, role: input.role });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "token minting failed" },
      { status: 500 },
    );
  }

  const session = joinSession({
    channel: input.channel,
    patientId: input.patientId,
    uid: input.uid,
  });
  const { posture, reason } = resolvePosture();

  return NextResponse.json({
    appId: minted.appId,
    channel: minted.channel,
    token: minted.token,
    uid: minted.uid,
    role: minted.role,
    expiresAt: minted.expiresAt,
    sessionId: session.sessionId,
    patientId: session.patientId,
    capabilities: capabilities(),
    phi: { posture, reason },
  });
}
