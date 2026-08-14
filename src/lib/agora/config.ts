/**
 * Agora real-time engagement configuration + PHI posture gate.
 *
 * HealthGuard routes two very different things through Agora:
 *
 *   1. Transport   — WebRTC audio/video for a consult. Agora relays media.
 *   2. Processing  — Conversational AI (ASR/LLM/TTS), Real-time STT, and
 *                    Cloud Recording. Agora *reads and stores* content.
 *
 * (2) is where PHI leaves our control. A signed Business Associate Agreement
 * is a paid/enterprise arrangement with Agora — it is NOT something the free
 * console tier grants you. So this module fails closed: unless the operator
 * has explicitly attested to a signed BAA, every code path that would hand
 * identifiable patient data to Agora is disabled, and the transport-only
 * paths keep working.
 *
 * This is deliberately a hard gate rather than a doc note: the failure mode
 * (PHI silently shipped to a vendor with no BAA) is a reportable breach, not
 * a bug you notice in review.
 */

/** How much patient data the operator is contractually allowed to send Agora. */
export type PhiPosture =
  /** No BAA. Transport only; no PHI in prompts, no recording, no stored transcripts. */
  | "transport-only"
  /** BAA signed with Agora. PHI-bearing features unlocked. */
  | "baa-signed";

export interface AgoraConfig {
  readonly appId: string;
  readonly appCertificate: string;
  /** Customer ID / secret pair for the REST APIs (Basic auth). */
  readonly restKey: string;
  readonly restSecret: string;
  readonly posture: PhiPosture;
  /** Operator-supplied reference for the executed BAA (contract id, ticket, URI). */
  readonly baaReference: string | null;
}

export interface AgoraCapabilities {
  /** Can we place a patient and a clinician in an A/V room at all? */
  readonly consult: boolean;
  /** Can the voice navigator run? (Always transport-safe; see phi below.) */
  readonly voiceNavigator: boolean;
  /** May we inject identifiable patient context into the navigator prompt? */
  readonly phiInPrompt: boolean;
  /** May we record the consult to Agora Cloud Recording? */
  readonly recording: boolean;
  /** May we persist STT output as a durable visit transcript? */
  readonly storedTranscript: boolean;
}

const REQUIRED_FOR_TRANSPORT = ["AGORA_APP_ID", "AGORA_APP_CERTIFICATE"] as const;
const REQUIRED_FOR_REST = ["AGORA_REST_KEY", "AGORA_REST_SECRET"] as const;

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

/**
 * Resolve the PHI posture from the environment.
 *
 * `AGORA_PHI_POSTURE=baa-signed` is only honoured when `AGORA_BAA_REFERENCE`
 * is also set — an operator claiming a BAA must name it. Anything else
 * (unset, typo'd, "true", "yes") degrades to transport-only rather than
 * throwing, because a misconfigured env var must never take the consult
 * feature offline; it must only take the *PHI* features offline.
 */
export function resolvePosture(): { posture: PhiPosture; reason: string } {
  const raw = env("AGORA_PHI_POSTURE").toLowerCase();
  const reference = env("AGORA_BAA_REFERENCE");

  if (raw !== "baa-signed") {
    return {
      posture: "transport-only",
      reason:
        raw === ""
          ? "AGORA_PHI_POSTURE is unset — defaulting to transport-only"
          : `AGORA_PHI_POSTURE="${raw}" is not a recognised posture — defaulting to transport-only`,
    };
  }

  if (reference === "") {
    return {
      posture: "transport-only",
      reason:
        "AGORA_PHI_POSTURE=baa-signed but AGORA_BAA_REFERENCE is empty — " +
        "refusing to unlock PHI features without a named agreement",
    };
  }

  return { posture: "baa-signed", reason: `BAA on file: ${reference}` };
}

export function getAgoraConfig(): AgoraConfig {
  const { posture } = resolvePosture();
  return {
    appId: env("AGORA_APP_ID"),
    appCertificate: env("AGORA_APP_CERTIFICATE"),
    restKey: env("AGORA_REST_KEY"),
    restSecret: env("AGORA_REST_SECRET"),
    posture,
    baaReference: env("AGORA_BAA_REFERENCE") || null,
  };
}

/** Names of env vars that are required but missing, for a given feature set. */
export function missingEnv(needsRest: boolean): string[] {
  const required = needsRest
    ? [...REQUIRED_FOR_TRANSPORT, ...REQUIRED_FOR_REST]
    : [...REQUIRED_FOR_TRANSPORT];
  return required.filter((name) => env(name) === "");
}

/**
 * What this deployment is actually allowed to do right now.
 *
 * Note `voiceNavigator` stays true under transport-only: an un-personalised
 * navigator ("describe your symptoms") is still enormously useful for the
 * low-literacy / elderly users this product targets, and carries no PHI we
 * put there ourselves. What transport-only forbids is *us* seeding the model
 * with the patient's record, and *us* asking Agora to store the audio.
 */
export function capabilities(config = getAgoraConfig()): AgoraCapabilities {
  const transportReady = config.appId !== "" && config.appCertificate !== "";
  const restReady = transportReady && config.restKey !== "" && config.restSecret !== "";
  const baa = config.posture === "baa-signed";

  return {
    consult: transportReady,
    voiceNavigator: restReady,
    phiInPrompt: restReady && baa,
    recording: restReady && baa,
    storedTranscript: restReady && baa,
  };
}

/**
 * Thrown when a caller tries to use a PHI-bearing feature under
 * transport-only posture. Routes translate this into a 403 with the reason,
 * so the UI can tell an operator exactly which env var to fix.
 */
export class PhiPostureError extends Error {
  readonly feature: string;
  readonly posture: PhiPosture;

  constructor(feature: string, posture: PhiPosture) {
    super(
      `"${feature}" requires a signed Agora BAA. Current posture: ${posture}. ` +
        "Set AGORA_PHI_POSTURE=baa-signed and AGORA_BAA_REFERENCE=<contract ref> " +
        "only after the agreement is actually executed.",
    );
    this.name = "PhiPostureError";
    this.feature = feature;
    this.posture = posture;
  }
}

/** Assert a PHI-bearing feature is permitted, or throw {@link PhiPostureError}. */
export function assertPhiAllowed(
  feature: "phiInPrompt" | "recording" | "storedTranscript",
  caps = capabilities(),
): void {
  if (!caps[feature]) {
    throw new PhiPostureError(feature, getAgoraConfig().posture);
  }
}
