/**
 * Voice navigator — Agora Conversational AI Engine.
 *
 * Agora joins the consult channel as a participant, runs ASR → LLM → TTS, and
 * speaks back. The LLM it calls is *ours*: `llm.url` points at this app's
 * OpenAI-compatible bridge (`/api/consult/navigator/llm`), so the navigator
 * inherits HealthGuard's existing clinical system prompt and never-diagnose
 * rules rather than being a second, unsupervised brain.
 *
 * That callback shape is also what makes the PHI gate enforceable: patient
 * context is decided server-side in the bridge, not passed through Agora.
 *
 * API: POST https://api.agora.io/api/conversational-ai-agent/v2/projects/{appid}/join
 *      POST .../agents/{agentId}/leave
 */
import { capabilities, getAgoraConfig } from "./config";
import { agoraPost, isAlreadyGone } from "./rest";
import { BOT_UIDS } from "./token";

export interface StartNavigatorOptions {
  readonly channel: string;
  /** RTC token the navigator uses to join, minted for BOT_UIDS.navigator. */
  readonly token: string;
  /** Human uids the navigator should listen to. */
  readonly listenTo: readonly number[];
  /** Opaque handle the LLM bridge uses to look up patient context. */
  readonly sessionId: string;
  /** Spoken language, BCP-47. Drives ASR and the greeting. */
  readonly language?: string;
  /** Seconds of silence before Agora tears the agent down. */
  readonly idleTimeout?: number;
}

export interface NavigatorAgent {
  readonly agentId: string;
  readonly createdAt: number;
  readonly status: string;
  /** Whether this agent was allowed to see identifiable patient data. */
  readonly phiEnabled: boolean;
}

interface JoinResponse {
  agent_id: string;
  create_ts: number;
  status: string;
}

/**
 * Greeting matters more than usual here: the target user may be elderly, low
 * literacy, or in distress at 2am. Lead with what the thing is and that it is
 * not a doctor, in one breath.
 */
const GREETING =
  "Hello, this is the HealthGuard navigator. I am an automated assistant, not a doctor. " +
  "Tell me what is going on and I will help you work out what to do next.";

const FAILURE_MESSAGE =
  "Sorry, I did not catch that. Could you say it once more? " +
  "If this is an emergency, please hang up and call your local emergency number.";

function requiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (value === "") throw new Error(`${name} is not configured`);
  return value;
}

/**
 * Public base URL of this deployment. Agora's servers must be able to reach
 * the LLM bridge, so localhost will not do — this is an explicit env var
 * rather than an inferred request host, to avoid a Host-header rebind
 * pointing Agora's callback somewhere else.
 */
function ttsParams(): Record<string, unknown> {
  const raw = requiredEnv("AGORA_TTS_PARAMS");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AGORA_TTS_PARAMS must be a JSON object");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("AGORA_TTS_PARAMS must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function llmBridgeUrl(): string {
  const base = requiredEnv("HEALTHGUARD_PUBLIC_URL").replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error("HEALTHGUARD_PUBLIC_URL must be an absolute URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("HEALTHGUARD_PUBLIC_URL must be https (Agora calls this from the internet)");
  }
  return `${base}/api/consult/navigator/llm/chat/completions`;
}

export async function startNavigator(
  options: StartNavigatorOptions,
): Promise<NavigatorAgent> {
  const { appId } = getAgoraConfig();
  const caps = capabilities();
  const {
    channel,
    token,
    listenTo,
    sessionId,
    language = "en-US",
    idleTimeout = 60,
  } = options;

  const body = {
    // Agent names must be unique per channel; Agora rejects a duplicate join.
    name: `healthguard-navigator-${channel}`,
    properties: {
      channel,
      token,
      agent_rtc_uid: String(BOT_UIDS.navigator),
      remote_rtc_uids: listenTo.map(String),
      enable_string_uid: false,
      idle_timeout: idleTimeout,
      asr: {
        vendor: process.env.AGORA_ASR_VENDOR || "ares",
        params: { language },
      },
      llm: {
        url: llmBridgeUrl(),
        // Shared secret; the bridge rejects anything else. Not a user credential.
        api_key: requiredEnv("AGORA_LLM_BRIDGE_KEY"),
        // The bridge owns the clinical prompt. We pass only the session handle
        // so the bridge can decide, under the PHI gate, what context to add.
        system_messages: [
          { role: "system", content: `healthguard-session:${sessionId}` },
        ],
        greeting_message: GREETING,
        failure_message: FAILURE_MESSAGE,
        max_history: 16,
        params: { model: process.env.AGORA_NAVIGATOR_MODEL || "healthguard-navigator" },
      },
      tts: {
        vendor: requiredEnv("AGORA_TTS_VENDOR"),
        params: ttsParams(),
      },
    },
  };

  const response = await agoraPost<JoinResponse>(
    `/api/conversational-ai-agent/v2/projects/${appId}/join`,
    body,
    "conversational-ai join",
  );

  return {
    agentId: response.agent_id,
    createdAt: response.create_ts,
    status: response.status,
    phiEnabled: caps.phiInPrompt,
  };
}

export async function stopNavigator(agentId: string): Promise<void> {
  const { appId } = getAgoraConfig();
  try {
    await agoraPost<Record<string, never>>(
      `/api/conversational-ai-agent/v2/projects/${appId}/agents/${encodeURIComponent(agentId)}/leave`,
      {},
      "conversational-ai leave",
    );
  } catch (error) {
    if (!isAlreadyGone(error)) throw error;
  }
}
