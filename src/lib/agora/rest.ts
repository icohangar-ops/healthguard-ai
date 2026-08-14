/**
 * Shared Basic-auth REST client for Agora's server APIs.
 *
 * Every outbound call goes through the vendored `safeFetch` so it inherits
 * the repo's hardening: per-attempt timeout, backoff on 429/5xx, fail-fast on
 * other 4xx, and an SSRF allowlist pinned to Agora's API host.
 */
import { safeFetch } from "@/lib/resilience";

import { getAgoraConfig } from "./config";

export const AGORA_API_HOST = "api.agora.io";
const AGORA_API_BASE = `https://${AGORA_API_HOST}`;

/** Agora's REST surface is the only host these helpers may ever reach. */
const ALLOWLIST = [AGORA_API_HOST] as const;

export class AgoraApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string, context: string) {
    super(`Agora ${context} failed with ${status}: ${body.slice(0, 400)}`);
    this.name = "AgoraApiError";
    this.status = status;
    this.body = body;
  }
}

function authHeader(): string {
  const { restKey, restSecret } = getAgoraConfig();
  if (restKey === "" || restSecret === "") {
    throw new Error("AGORA_REST_KEY / AGORA_REST_SECRET are not configured");
  }
  return `Basic ${Buffer.from(`${restKey}:${restSecret}`).toString("base64")}`;
}

/**
 * POST JSON to an Agora REST path and parse the JSON reply.
 *
 * `path` must be an absolute path on api.agora.io. Callers assemble it from
 * validated components (app id, channel name, agent id) — never from raw user
 * input, which is why channel names are validated at mint time.
 */
export async function agoraPost<T>(
  path: string,
  body: unknown,
  context: string,
  timeoutMs = 15_000,
): Promise<T> {
  const response = await safeFetch(`${AGORA_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    allowlist: ALLOWLIST,
    timeoutMs,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new AgoraApiError(response.status, text, context);
  }
  // Some stop/leave endpoints return an empty body on success.
  return (text === "" ? {} : JSON.parse(text)) as T;
}

export async function agoraGet<T>(
  path: string,
  context: string,
  timeoutMs = 15_000,
): Promise<T> {
  const response = await safeFetch(`${AGORA_API_BASE}${path}`, {
    method: "GET",
    headers: { Authorization: authHeader() },
    allowlist: ALLOWLIST,
    timeoutMs,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new AgoraApiError(response.status, text, context);
  }
  return (text === "" ? {} : JSON.parse(text)) as T;
}
