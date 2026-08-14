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
 * radius for something this short-lived. Multi-instance deployments should
 * back this with Redis keyed the same way.
 */
import { randomUUID } from "node:crypto";

export interface ConsultSession {
  readonly sessionId: string;
  readonly channel: string;
  /** Null for an anonymous walk-up consult with no patient record attached. */
  readonly patientId: string | null;
  readonly humanUids: readonly number[];
  readonly createdAt: number;
  navigatorAgentId?: string;
  transcriptionAgentId?: string;
  recording?: { resourceId: string; sid: string };
}

/** Sessions expire well after the longest plausible consult. */
const TTL_MS = 4 * 60 * 60 * 1000;

const sessions = new Map<string, ConsultSession>();

function sweep(now: number): void {
  for (const [id, session] of sessions) {
    if (now - session.createdAt > TTL_MS) sessions.delete(id);
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
  return session;
}

export function getSession(sessionId: string): ConsultSession | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (Date.now() - session.createdAt > TTL_MS) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

export function updateSession(
  sessionId: string,
  patch: Partial<Omit<ConsultSession, "sessionId" | "createdAt">>,
): ConsultSession | null {
  const session = getSession(sessionId);
  if (!session) return null;
  Object.assign(session, patch);
  return session;
}

export function endSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/** Test seam. */
export function _resetSessions(): void {
  sessions.clear();
}
