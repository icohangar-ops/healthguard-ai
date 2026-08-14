import { afterEach, describe, expect, it } from "vitest";

import {
  _resetSessions,
  createSession,
  getSession,
  joinSession,
  releaseSlot,
  reserveSlot,
  updateSession,
} from "./session";

afterEach(() => {
  _resetSessions();
});

describe("joinSession", () => {
  it("reuses the live session for the same channel and appends uids", () => {
    const first = joinSession({ channel: "consult-p1", patientId: "p1", uid: 100 });
    const second = joinSession({ channel: "consult-p1", patientId: "p1", uid: 200 });
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.humanUids).toEqual([100, 200]);
  });

  it("does not duplicate a uid that rejoins", () => {
    joinSession({ channel: "consult-p1", patientId: "p1", uid: 100 });
    const again = joinSession({ channel: "consult-p1", patientId: "p1", uid: 100 });
    expect(again.humanUids).toEqual([100]);
  });
});

describe("reserveSlot", () => {
  it("claims recording so a concurrent start loses the race", () => {
    const session = createSession({ channel: "consult-x", patientId: null, humanUids: [1] });
    expect(reserveSlot(session.sessionId, "recording")).toBe(true);
    expect(reserveSlot(session.sessionId, "recording")).toBe(false);
    releaseSlot(session.sessionId, "recording");
    expect(reserveSlot(session.sessionId, "recording")).toBe(true);
  });

  it("claims transcription the same way", () => {
    const session = createSession({ channel: "consult-x", patientId: null, humanUids: [1] });
    expect(reserveSlot(session.sessionId, "transcriptionAgentId")).toBe(true);
    expect(getSession(session.sessionId)?.transcriptionAgentId).toBe("pending");
    expect(reserveSlot(session.sessionId, "transcriptionAgentId")).toBe(false);
    releaseSlot(session.sessionId, "transcriptionAgentId");
    expect(getSession(session.sessionId)?.transcriptionAgentId).toBeUndefined();
  });
});

describe("updateSession", () => {
  it("accepts only lifecycle fields", () => {
    const session = createSession({ channel: "consult-x", patientId: "p1", humanUids: [1] });
    updateSession(session.sessionId, { navigatorAgentId: "agent-1" });
    expect(getSession(session.sessionId)?.navigatorAgentId).toBe("agent-1");
    expect(getSession(session.sessionId)?.patientId).toBe("p1");
  });
});
