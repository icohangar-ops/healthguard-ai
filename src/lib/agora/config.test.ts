/**
 * The PHI gate is the one piece of this integration where a silent regression
 * is a reportable breach rather than a bug, so it gets characterization tests
 * covering every way an operator can get the env wrong.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PhiPostureError,
  assertPhiAllowed,
  capabilities,
  missingEnv,
  resolvePosture,
} from "./config";

const AGORA_KEYS = [
  "AGORA_APP_ID",
  "AGORA_APP_CERTIFICATE",
  "AGORA_REST_KEY",
  "AGORA_REST_SECRET",
  "AGORA_PHI_POSTURE",
  "AGORA_BAA_REFERENCE",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of AGORA_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of AGORA_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function fullyConfigured(): void {
  process.env.AGORA_APP_ID = "app-id";
  process.env.AGORA_APP_CERTIFICATE = "app-cert";
  process.env.AGORA_REST_KEY = "rest-key";
  process.env.AGORA_REST_SECRET = "rest-secret";
}

describe("resolvePosture", () => {
  it("defaults to transport-only when unset", () => {
    expect(resolvePosture().posture).toBe("transport-only");
  });

  it("stays transport-only for an unrecognised value rather than throwing", () => {
    process.env.AGORA_PHI_POSTURE = "true";
    const { posture, reason } = resolvePosture();
    expect(posture).toBe("transport-only");
    expect(reason).toContain("not a recognised posture");
  });

  it("refuses to unlock PHI when the BAA reference is missing", () => {
    process.env.AGORA_PHI_POSTURE = "baa-signed";
    const { posture, reason } = resolvePosture();
    expect(posture).toBe("transport-only");
    expect(reason).toContain("AGORA_BAA_REFERENCE is empty");
  });

  it("refuses when the BAA reference is only whitespace", () => {
    process.env.AGORA_PHI_POSTURE = "baa-signed";
    process.env.AGORA_BAA_REFERENCE = "   ";
    expect(resolvePosture().posture).toBe("transport-only");
  });

  it("unlocks only with both the posture and a named agreement", () => {
    process.env.AGORA_PHI_POSTURE = "baa-signed";
    process.env.AGORA_BAA_REFERENCE = "MSA-2026-0142";
    const { posture, reason } = resolvePosture();
    expect(posture).toBe("baa-signed");
    expect(reason).toContain("MSA-2026-0142");
  });

  it("is case-insensitive on the posture value", () => {
    process.env.AGORA_PHI_POSTURE = "BAA-Signed";
    process.env.AGORA_BAA_REFERENCE = "MSA-1";
    expect(resolvePosture().posture).toBe("baa-signed");
  });
});

describe("capabilities", () => {
  it("reports nothing available with no configuration at all", () => {
    expect(capabilities()).toEqual({
      consult: false,
      voiceNavigator: false,
      phiInPrompt: false,
      recording: false,
      storedTranscript: false,
    });
  });

  it("allows a consult with transport credentials alone", () => {
    process.env.AGORA_APP_ID = "app-id";
    process.env.AGORA_APP_CERTIFICATE = "app-cert";
    const caps = capabilities();
    expect(caps.consult).toBe(true);
    expect(caps.voiceNavigator).toBe(false);
  });

  it("keeps the voice navigator available without a BAA, but with no PHI", () => {
    fullyConfigured();
    const caps = capabilities();
    expect(caps.voiceNavigator).toBe(true);
    expect(caps.phiInPrompt).toBe(false);
    expect(caps.recording).toBe(false);
    expect(caps.storedTranscript).toBe(false);
  });

  it("unlocks the PHI-bearing features once a BAA is on file", () => {
    fullyConfigured();
    process.env.AGORA_PHI_POSTURE = "baa-signed";
    process.env.AGORA_BAA_REFERENCE = "MSA-2026-0142";
    expect(capabilities()).toEqual({
      consult: true,
      voiceNavigator: true,
      phiInPrompt: true,
      recording: true,
      storedTranscript: true,
    });
  });

  it("does not unlock PHI features on a BAA claim without REST credentials", () => {
    process.env.AGORA_APP_ID = "app-id";
    process.env.AGORA_APP_CERTIFICATE = "app-cert";
    process.env.AGORA_PHI_POSTURE = "baa-signed";
    process.env.AGORA_BAA_REFERENCE = "MSA-2026-0142";
    const caps = capabilities();
    expect(caps.recording).toBe(false);
    expect(caps.storedTranscript).toBe(false);
  });
});

describe("assertPhiAllowed", () => {
  it("throws under transport-only posture", () => {
    fullyConfigured();
    expect(() => assertPhiAllowed("recording")).toThrow(PhiPostureError);
  });

  it("names the remediation in the error message", () => {
    fullyConfigured();
    try {
      assertPhiAllowed("storedTranscript");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PhiPostureError);
      expect((error as Error).message).toContain("AGORA_PHI_POSTURE=baa-signed");
      expect((error as Error).message).toContain("AGORA_BAA_REFERENCE");
    }
  });

  it("passes once the BAA is on file", () => {
    fullyConfigured();
    process.env.AGORA_PHI_POSTURE = "baa-signed";
    process.env.AGORA_BAA_REFERENCE = "MSA-2026-0142";
    expect(() => assertPhiAllowed("recording")).not.toThrow();
  });
});

describe("missingEnv", () => {
  it("lists transport vars when REST is not needed", () => {
    expect(missingEnv(false)).toEqual(["AGORA_APP_ID", "AGORA_APP_CERTIFICATE"]);
  });

  it("lists REST vars too when they are needed", () => {
    process.env.AGORA_APP_ID = "app-id";
    process.env.AGORA_APP_CERTIFICATE = "app-cert";
    expect(missingEnv(true)).toEqual(["AGORA_REST_KEY", "AGORA_REST_SECRET"]);
  });

  it("returns empty when fully configured", () => {
    fullyConfigured();
    expect(missingEnv(true)).toEqual([]);
  });
});
