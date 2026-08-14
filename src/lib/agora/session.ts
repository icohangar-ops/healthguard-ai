/**
 * Consult session registry.
 *
 * When the voice navigator starts, Agora only carries an opaque session id.
 * The LLM bridge resolves that id back to a patient here — server-side, behind
 * the PHI gate — so no patient identifier ever transits Agora's control plane.
 *
 * Intentionally in-memory: a consult session is minutes long, and *not*
 * persisting the mapping means a stolen database file does not reveal who was
 * on which call. Sessions die with the process, which is the correct blast
 * radius for something this short-lived.
 *
 * This is a single-instance store. Multi-replica or serverless deployments
 * will 404 follow-up navigator/transcript/record calls that land on a
 * different instance, and a process restart mid-consult leaves Agora agents
 * running until their idle timeout (60s navigator, 120s STT/recording). Do
 * not put this behind more than one replica without sticky routing on
 * `sessionId` or a shared store. Redis is the planned follow-up; it is not
 * in this PR.
 */
import { randomUUID } from "node:crypto";

export interface ConsultSession {
  readonly sessionId: string;
  readonly channel: string;
  /** Null for an anonymous walk-up consult with no patient record attached. */
  readonly patientId: string | null;
  humanUids: number[];
  readonly createdAt: number;
  navigatorAgentId?: string;
  transcriptionAgentId?: string;
  recording?: { resourceId: string; sid: string };
}

/** Only agent-lifecycle fields are mutable after creation. */
export type SessionPatch = Partial<
  Pick<ConsultSession, "navigatorAgentId" | "transcriptionAgentId" | "recording">
>;

/** Sessions expire well after the longest plausible consult. */
const TTL_MS = 4 * 60 * 60 * 1000;

const PENDING = "pending";

const sessions = new Map<string, ConsultSession>();
const byChannel = new Map<string, string>();

function sweep(now: number): void {
  for (const [id, session] of sessions) {
    if (now - session.createdAt > TTL_MS) {
      sessions.delete(id);
      byChannel.delete(session.channel);
    }
  }
}

export function createSession(input: {
  channel: string;
  patientId: string | null;
  humanUids: readonly number[];
}): ConsultSession {
  const now = Date.now();
  sweep(now);

  const session: ConsultSession = {
    sessionId: randomUUID(),
    channel: input.channel,
    patientId: input.patientId,
    humanUids: [...input.humanUids],
    createdAt: now,
  };
  sessions.set(session.sessionId, session);
  byChannel.set(session.channel, session.sessionId);
  return session;
}

/**
 * Reuse the live session for this channel so a clinician joining a patient's
 * room shares navigator/recording/transcription state, and so every human uid
 * is visible to those services.
 */
export function joinSession(input: {
  channel: string;
  patientId: string | null;
  uid: number;
}): ConsultSession {
  const existingId = byChannel.get(input.channel);
  const existing = existingId ? getSession(existingId) : null;
  if (!existing) {
    return createSession({
      channel: input.channel,
      patientId: input.patientId,
      humanUids: [input.uid],
    });
  }
  if (!existing.humanUids.includes(input.uid)) {
    existing.humanUids.push(input.uid);
  }
  return existing;
}

export function getSession(sessionId: string): ConsultSession | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (Date.now() - session.createdAt > TTL_MS) {
    sessions.delete(sessionId);
    byChannel.delete(session.channel);
    return null;
  }
  return session;
}

export function updateSession(sessionId: string, patch: SessionPatch): ConsultSession | null {
  const session = getSession(sessionId);
  if (!session) return null;
  Object.assign(session, patch);
  return session;
}

/**
 * Claim a one-shot Agora task slot before the network round-trip so a
 * concurrent POST cannot start a second unstoppable agent.
 */
export function reserveSlot(
  sessionId: string,
  field: "navigatorAgentId" | "transcriptionAgentId" | "recording",
): boolean {
  const session = getSession(sessionId);
  if (!session) return false;
  if (field === "recording") {
    if (session.recording) return false;
    session.recording = { resourceId: "", sid: "" };
    return true;
  }
  if (session[field]) return false;
  session[field] = PENDING;
  return true;
}

export function releaseSlot(
  sessionId: string,
  field: "navigatorAgentId" | "transcriptionAgentId" | "recording",
): void {
  const session = getSession(sessionId);
  if (!session) return;
  if (field === "recording") {
    if (session.recording && session.recording.sid === "") {
      session.recording = undefined;
    }
    return;
  }
  if (session[field] === PENDING) session[field] = undefined;
}

export function endSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  sessions.delete(sessionId);
  if (session) byChannel.delete(session.channel);
}

/** Test seam. */
export function _resetSessions(): void {
  sessions.clear();
  byChannel.clear();
}
