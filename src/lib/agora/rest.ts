/**
 * Shared Basic-auth REST client for Agora's server APIs.
 *
 * Every outbound call goes through the vendored `safeFetch` so it inherits
 * the repo's hardening: per-attempt timeout, backoff on 429/5xx, fail-fast on
 * other 4xx, and an SSRF allowlist pinned to Agora's API host.
 *
 * POSTs default to a single attempt. acquire/join/start are not idempotent —
 * retrying them creates a second agent or consumes a single-use resource id.
 */
import { NextResponse } from "next/server";

import { safeFetch } from "@/lib/resilience";

import { getAgoraConfig, PhiPostureError } from "./config";

export const AGORA_API_HOST = "api.agora.io";
const AGORA_API_BASE = `https://${AGORA_API_HOST}`;

/** Agora's REST surface is the only host these helpers may ever reach. */
const ALLOWLIST = [AGORA_API_HOST] as const;

export class AgoraApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string, context: string) {
    super(`Agora ${context} failed with ${status}`);
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

function parseBody<T>(text: string, status: number, context: string): T {
  if (text === "") return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AgoraApiError(status, text, `${context} (unparsable response)`);
  }
}

export interface AgoraPostOptions {
  readonly timeoutMs?: number;
  /** Override the default of 1. Only for idempotent reads. */
  readonly maxAttempts?: number;
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
  options: AgoraPostOptions = {},
): Promise<T> {
  const { timeoutMs = 15_000, maxAttempts = 1 } = options;
  const response = await safeFetch(`${AGORA_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    allowlist: ALLOWLIST,
    timeoutMs,
    maxAttempts,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new AgoraApiError(response.status, text, context);
  }
  return parseBody<T>(text, response.status, context);
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
  return parseBody<T>(text, response.status, context);
}

/**
 * Agora tears agents down on idle. A later leave then 404s; treating that as
 * success lets the session drop a stale id instead of getting stuck on 502.
 */
export function isAlreadyGone(error: unknown): boolean {
  if (!(error instanceof AgoraApiError)) return false;
  if (error.status === 404) return true;
  if (error.status === 400 || error.status === 422) {
    return /not found|unknown agent|does not exist|invalid agent/i.test(error.body);
  }
  return false;
}

/** Map a consult-route failure to a client response without leaking vendor bodies. */
export function consultErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof PhiPostureError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof AgoraApiError) {
    console.error(error.message, error.body.slice(0, 400));
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 502 },
  );
}
