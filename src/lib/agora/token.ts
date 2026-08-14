/**
 * RTC token minting. Server-only — the app certificate must never reach a
 * browser bundle.
 *
 * Agora tokens carry two independent expiries:
 *   - tokenExpire:     when the credential itself dies
 *   - privilegeExpire: when the join/publish privilege inside it dies
 * We set both to the same horizon; a consult that outlives it renews.
 */
import { RtcRole, RtcTokenBuilder } from "agora-token";

import { getAgoraConfig } from "./config";

/** Consults are short. One hour covers a long visit without a renewal dance. */
export const DEFAULT_TTL_SECONDS = 3600;

export type ConsultRole = "patient" | "clinician" | "observer";

export interface MintedToken {
  readonly token: string;
  readonly appId: string;
  readonly channel: string;
  readonly uid: number;
  readonly role: ConsultRole;
  /** Unix seconds at which the client must have renewed. */
  readonly expiresAt: number;
}

/**
 * Observers (e.g. a supervising clinician auditing a resident) subscribe but
 * never publish. Everyone else publishes. Enforcing this in the token rather
 * than the UI means a tampered client still cannot push media.
 */
function agoraRole(role: ConsultRole): number {
  return role === "observer" ? RtcRole.SUBSCRIBER : RtcRole.PUBLISHER;
}

/**
 * Channel names are user-influenced (they embed a consult id), so constrain
 * them to what Agora accepts and to something that cannot be used to smuggle
 * path segments into the REST calls that later reference this channel.
 */
export function isValidChannelName(channel: string): boolean {
  return /^[A-Za-z0-9!#$%&()+\-:;<=.>?@[\]^_{|}~,]{1,64}$/.test(channel);
}

export function consultChannel(consultId: string): string {
  const channel = `consult-${consultId}`;
  if (!isValidChannelName(channel)) {
    throw new Error(`consult id "${consultId}" produces an invalid Agora channel name`);
  }
  return channel;
}

export function mintRtcToken(options: {
  channel: string;
  uid: number;
  role: ConsultRole;
  ttlSeconds?: number;
}): MintedToken {
  const { appId, appCertificate } = getAgoraConfig();
  if (appId === "" || appCertificate === "") {
    throw new Error("AGORA_APP_ID / AGORA_APP_CERTIFICATE are not configured");
  }

  const { channel, uid, role, ttlSeconds = DEFAULT_TTL_SECONDS } = options;
  if (!isValidChannelName(channel)) {
    throw new Error(`invalid Agora channel name: "${channel}"`);
  }
  if (!Number.isInteger(uid) || uid < 0 || uid > 0xffffffff) {
    throw new Error(`invalid Agora uid: ${uid}`);
  }

  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channel,
    uid,
    agoraRole(role),
    ttlSeconds,
    ttlSeconds,
  );

  return {
    token,
    appId,
    channel,
    uid,
    role,
    expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
}

/**
 * Reserved uids for the non-human participants in a consult channel.
 *
 * These are fixed so that REST calls (STT subscribe lists, recording layouts)
 * can reference them without a lookup, and so a human uid can never collide
 * with a bot. Human uids are allocated above BOT_UID_CEILING.
 */
export const BOT_UIDS = {
  /** The Conversational AI voice navigator. */
  navigator: 1_000_001,
  /** Real-time STT publishes captions as this uid. */
  transcriber: 1_000_002,
  /** Cloud Recording joins as this uid. */
  recorder: 1_000_003,
} as const;

export const BOT_UID_CEILING = 1_000_100;

/** Deterministic, collision-free-enough uid for a human participant. */
export function humanUid(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Keep clear of the reserved bot range.
  return (Math.abs(hash) % (0x7fffffff - BOT_UID_CEILING)) + BOT_UID_CEILING;
}
