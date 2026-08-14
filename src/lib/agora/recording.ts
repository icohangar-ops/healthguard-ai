/**
 * Visit record — Agora Cloud Recording.
 *
 * A recorded consult is unambiguously PHI at rest in a third party, so every
 * entry point here asserts the BAA gate first. There is no "just for the demo"
 * bypass on purpose: the demo path is the one that gets shipped.
 *
 * Three-step lifecycle, per Agora's REST contract:
 *   acquire → start → stop
 * The resource id from `acquire` is valid for five minutes and single-use;
 * the `sid` from `start` is required to stop.
 */
import { assertPhiAllowed, getAgoraConfig } from "./config";
import { agoraPost } from "./rest";
import { BOT_UIDS } from "./token";

export interface StartRecordingOptions {
  readonly channel: string;
  /** Token minted for BOT_UIDS.recorder on this channel. */
  readonly token: string;
  /** Uids to record. Empty records everyone in the channel. */
  readonly uids?: readonly number[];
}

export interface RecordingHandle {
  readonly resourceId: string;
  readonly sid: string;
  readonly channel: string;
}

interface AcquireResponse {
  resourceId: string;
}

interface StartResponse {
  sid: string;
  resourceId: string;
}

interface StopResponse {
  serverResponse?: { fileList?: Array<{ fileName?: string }> };
}

const RECORDER_UID = String(BOT_UIDS.recorder);

function storageConfig(): Record<string, unknown> {
  const required = [
    "AGORA_STORAGE_VENDOR",
    "AGORA_STORAGE_REGION",
    "AGORA_STORAGE_BUCKET",
    "AGORA_STORAGE_ACCESS_KEY",
    "AGORA_STORAGE_SECRET_KEY",
  ];
  const missing = required.filter((n) => (process.env[n] ?? "").trim() === "");
  if (missing.length > 0) {
    throw new Error(`cloud recording needs: ${missing.join(", ")}`);
  }
  return {
    vendor: Number(process.env.AGORA_STORAGE_VENDOR),
    region: Number(process.env.AGORA_STORAGE_REGION),
    bucket: process.env.AGORA_STORAGE_BUCKET,
    accessKey: process.env.AGORA_STORAGE_ACCESS_KEY,
    secretKey: process.env.AGORA_STORAGE_SECRET_KEY,
    fileNamePrefix: ["healthguard", "consults"],
  };
}

/**
 * Start recording a consult.
 *
 * Uses `individual` mode — each participant is recorded to a separate track.
 * For a clinical record that is the right call: a composited grid is harder to
 * review, and separate tracks let you produce a per-speaker transcript later
 * without diarisation guesswork.
 */
export async function startRecording(
  options: StartRecordingOptions,
): Promise<RecordingHandle> {
  assertPhiAllowed("recording");

  const { appId } = getAgoraConfig();
  const { channel, token, uids = [] } = options;

  const acquire = await agoraPost<AcquireResponse>(
    `/v1/apps/${appId}/cloud_recording/acquire`,
    {
      cname: channel,
      uid: RECORDER_UID,
      clientRequest: { resourceExpiredHour: 24, scene: 0 },
    },
    "cloud recording acquire",
  );

  const start = await agoraPost<StartResponse>(
    `/v1/apps/${appId}/cloud_recording/resourceid/${encodeURIComponent(acquire.resourceId)}/mode/individual/start`,
    {
      cname: channel,
      uid: RECORDER_UID,
      clientRequest: {
        token,
        recordingConfig: {
          channelType: 0, // communication profile — a consult, not a broadcast
          streamTypes: 2, // audio + video
          maxIdleTime: 120,
          subscribeAudioUids: uids.length > 0 ? uids.map(String) : undefined,
          subscribeVideoUids: uids.length > 0 ? uids.map(String) : undefined,
          subscribeUidGroup: 0,
        },
        recordingFileConfig: { avFileType: ["hls", "mp4"] },
        storageConfig: storageConfig(),
      },
    },
    "cloud recording start",
  );

  return { resourceId: start.resourceId, sid: start.sid, channel };
}

/** Stop a recording. Returns the produced file names, when Agora reports them. */
export async function stopRecording(handle: RecordingHandle): Promise<string[]> {
  const { appId } = getAgoraConfig();
  const { resourceId, sid, channel } = handle;

  const response = await agoraPost<StopResponse>(
    `/v1/apps/${appId}/cloud_recording/resourceid/${encodeURIComponent(resourceId)}/sid/${encodeURIComponent(sid)}/mode/individual/stop`,
    {
      cname: channel,
      uid: RECORDER_UID,
      clientRequest: {},
    },
    "cloud recording stop",
  );

  return (response.serverResponse?.fileList ?? [])
    .map((f) => f.fileName)
    .filter((n): n is string => typeof n === "string");
}
