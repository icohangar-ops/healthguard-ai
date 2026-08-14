import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BOT_UIDS,
  BOT_UID_CEILING,
  consultChannel,
  humanUid,
  isValidChannelName,
  mintRtcToken,
} from "./token";

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ["AGORA_APP_ID", "AGORA_APP_CERTIFICATE"]) {
    saved[key] = process.env[key];
  }
  process.env.AGORA_APP_ID = "0123456789abcdef0123456789abcdef";
  process.env.AGORA_APP_CERTIFICATE = "fedcba9876543210fedcba9876543210";
});

afterEach(() => {
  for (const key of ["AGORA_APP_ID", "AGORA_APP_CERTIFICATE"]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("isValidChannelName", () => {
  it("accepts the names we generate", () => {
    expect(isValidChannelName("consult-abc123")).toBe(true);
  });

  it("rejects empty and over-long names", () => {
    expect(isValidChannelName("")).toBe(false);
    expect(isValidChannelName("a".repeat(65))).toBe(false);
  });

  it("rejects path separators, which would otherwise reach the REST URLs", () => {
    expect(isValidChannelName("consult/../admin")).toBe(false);
    expect(isValidChannelName("consult with space")).toBe(false);
  });
});

describe("consultChannel", () => {
  it("prefixes the consult id", () => {
    expect(consultChannel("abc123")).toBe("consult-abc123");
  });

  it("throws rather than emitting a channel name that could escape a URL path", () => {
    expect(() => consultChannel("../../evil")).toThrow(/invalid Agora channel name/);
  });
});

describe("humanUid", () => {
  it("is deterministic for the same seed and entropy", () => {
    expect(humanUid("consult-1:patient:Ada", "e1")).toBe(humanUid("consult-1:patient:Ada", "e1"));
  });

  it("differs when entropy differs, so two Adas in one room do not collide", () => {
    expect(humanUid("consult-1:patient:Ada", "e1")).not.toBe(
      humanUid("consult-1:patient:Ada", "e2"),
    );
  });

  it("never collides with the reserved bot range", () => {
    const seeds = Array.from({ length: 500 }, (_, i) => `consult-${i}:patient:user${i}`);
    for (const seed of seeds) {
      const uid = humanUid(seed, String(seed.length));
      expect(uid).toBeGreaterThanOrEqual(BOT_UID_CEILING);
      expect(Object.values(BOT_UIDS)).not.toContain(uid);
    }
  });

  it("produces a valid 32-bit unsigned uid", () => {
    const uid = humanUid("anything", "entropy");
    expect(Number.isInteger(uid)).toBe(true);
    expect(uid).toBeLessThanOrEqual(0xffffffff);
    expect(uid).toBeGreaterThanOrEqual(1);
  });
});

describe("mintRtcToken", () => {
  it("returns a token bound to the channel and uid", () => {
    const minted = mintRtcToken({ channel: "consult-x", uid: 1_000_500, role: "patient" });
    expect(minted.token.startsWith("007")).toBe(true);
    expect(minted.channel).toBe("consult-x");
    expect(minted.uid).toBe(1_000_500);
    expect(minted.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("mints a distinct token for the subscriber role", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
    const publisher = mintRtcToken({ channel: "consult-x", uid: 42, role: "clinician" });
    const observer = mintRtcToken({ channel: "consult-x", uid: 42, role: "observer" });
    expect(publisher.token).not.toBe(observer.token);
    vi.useRealTimers();
  });

  it("rejects wildcard uid 0", () => {
    expect(() =>
      mintRtcToken({ channel: "consult-x", uid: 0, role: "patient" }),
    ).toThrow(/invalid Agora uid/);
  });

  it("rejects an invalid channel name", () => {
    expect(() =>
      mintRtcToken({ channel: "bad/name", uid: 1, role: "patient" }),
    ).toThrow(/invalid Agora channel name/);
  });

  it("rejects an out-of-range uid", () => {
    expect(() =>
      mintRtcToken({ channel: "consult-x", uid: -1, role: "patient" }),
    ).toThrow(/invalid Agora uid/);
  });

  it("fails loudly when the certificate is not configured", () => {
    delete process.env.AGORA_APP_CERTIFICATE;
    expect(() =>
      mintRtcToken({ channel: "consult-x", uid: 1, role: "patient" }),
    ).toThrow(/not configured/);
  });
});
