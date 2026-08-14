/**
 * Live captions — Agora Real-Time Speech-to-Text.
 *
 * Two distinct uses, with different PHI weight:
 *
 *   - Live captions in the consult UI. Transient, never persisted by us.
 *     Valuable accessibility for deaf/hard-of-hearing and non-native speakers,
 *     which is squarely the underserved-patient thesis.
 *   - `captionConfig.storage` — Agora writes transcript slices to object
 *     storage. That is PHI at rest in a third party, so it is gated.
 *
 * API: POST https://api.agora.io/api/speech-to-text/v1/projects/{appid}/join
 *      POST .../agents/{agentId}/leave
 */
import { assertPhiAllowed, capabilities, getAgoraConfig } from "./config";
import { agoraPost, isAlreadyGone } from "./rest";
import { agoraStorageConfig } from "./storage";
import { BOT_UIDS } from "./token";

export interface StartTranscriptionOptions {
  readonly channel: string;
  /** Human uids whose audio should be transcribed (max 32). */
  readonly subscribeAudioUids: readonly number[];
  /** Up to four recognition languages. */
  readonly languages?: readonly string[];
  /** Seconds of channel idleness before the task self-terminates. */
  readonly maxIdleTime?: number;
  /**
   * Persist transcript slices to object storage for the visit record.
   * Requires a signed BAA — throws {@link PhiPostureError} otherwise.
   */
  readonly persist?: boolean;
}

export interface TranscriptionTask {
  readonly agentId: string;
  readonly status: string;
  readonly persisted: boolean;
}

interface JoinResponse {
  agent_id: string;
  create_ts: number;
  status: string;
}


export async function startTranscription(
  options: StartTranscriptionOptions,
): Promise<TranscriptionTask> {
  const { appId } = getAgoraConfig();
  const {
    channel,
    subscribeAudioUids,
    languages = ["en-US"],
    maxIdleTime = 120,
    persist = false,
  } = options;

  if (persist) assertPhiAllowed("storedTranscript");
  if (subscribeAudioUids.length === 0 || subscribeAudioUids.length > 32) {
    throw new Error("subscribeAudioUids must contain between 1 and 32 uids");
  }
  if (languages.length === 0 || languages.length > 4) {
    throw new Error("Agora Real-time STT accepts between 1 and 4 languages");
  }

  const body: Record<string, unknown> = {
    name: `healthguard-stt-${channel}`,
    languages: [...languages],
    maxIdleTime,
    rtcConfig: {
      channelName: channel,
      pubBotUid: String(BOT_UIDS.transcriber),
      subscribeAudioUids: subscribeAudioUids.map(String),
    },
  };

  if (persist) {
    body.captionConfig = {
      sliceDuration: 60,
      storage: agoraStorageConfig(["healthguard", "transcripts"]),
    };
  }

  const response = await agoraPost<JoinResponse>(
    `/api/speech-to-text/v1/projects/${appId}/join`,
    body,
    "speech-to-text join",
  );

  return {
    agentId: response.agent_id,
    status: response.status,
    persisted: persist,
  };
}

export async function stopTranscription(agentId: string): Promise<void> {
  const { appId } = getAgoraConfig();
  try {
    await agoraPost<Record<string, never>>(
      `/api/speech-to-text/v1/projects/${appId}/agents/${encodeURIComponent(agentId)}/leave`,
      {},
      "speech-to-text leave",
    );
  } catch (error) {
    if (!isAlreadyGone(error)) throw error;
  }
}

/** Whether persisted transcripts are currently permitted. */
export function canPersistTranscripts(): boolean {
  return capabilities().storedTranscript;
}
