"use client";

/**
 * Agora RTC lifecycle for a consult room.
 *
 * The SDK touches `window` at import time, so it is loaded dynamically inside
 * the join path rather than at module scope — a static import breaks the
 * Next.js server render.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ICameraVideoTrack,
  IMicrophoneAudioTrack,
} from "agora-rtc-sdk-ng";

export type ConsultRole = "patient" | "clinician" | "observer";

export interface ConsultCapabilities {
  consult: boolean;
  voiceNavigator: boolean;
  phiInPrompt: boolean;
  recording: boolean;
  storedTranscript: boolean;
}

export interface ConsultCredentials {
  appId: string;
  channel: string;
  token: string;
  uid: number;
  role: ConsultRole;
  expiresAt: number;
  sessionId: string;
  capabilities: ConsultCapabilities;
  phi: { posture: string; reason: string };
}

export type ConsultStatus = "idle" | "joining" | "connected" | "error";

export interface RemoteParticipant {
  uid: string | number;
  hasVideo: boolean;
  hasAudio: boolean;
}

interface UseAgoraConsultOptions {
  /** Bearer token for HealthGuard's own patient-data API. */
  apiToken: string;
  patientId?: string;
  role: ConsultRole;
  displayName: string;
}

/**
 * Reserved bot uids, mirrored from `src/lib/agora/token.ts`. The UI hides them
 * from the participant grid — a caption bot rendered as an empty video tile
 * looks like a broken participant.
 */
const BOT_UIDS = new Set([1_000_001, 1_000_002, 1_000_003]);

export function useAgoraConsult(options: UseAgoraConsultOptions) {
  const { apiToken, patientId, role, displayName } = options;

  const [status, setStatus] = useState<ConsultStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<ConsultCredentials | null>(null);
  const [remotes, setRemotes] = useState<RemoteParticipant[]>([]);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);

  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const micTrackRef = useRef<IMicrophoneAudioTrack | null>(null);
  const camTrackRef = useRef<ICameraVideoTrack | null>(null);
  const localContainer = useRef<HTMLDivElement | null>(null);
  const remoteContainers = useRef(new Map<string, HTMLDivElement>());

  /**
   * Callback refs rather than exposed ref objects: the consumer never touches
   * `.current` during render, and a container that mounts *after* the track
   * exists still gets the video attached.
   */
  const registerLocalContainer = useCallback((element: HTMLDivElement | null) => {
    localContainer.current = element;
    if (element && camTrackRef.current) camTrackRef.current.play(element);
  }, []);

  const syncRemotes = useCallback((client: IAgoraRTCClient) => {
    setRemotes(
      client.remoteUsers
        .filter((u) => !BOT_UIDS.has(Number(u.uid)))
        .map((u) => ({
          uid: u.uid,
          hasVideo: u.hasVideo,
          hasAudio: u.hasAudio,
        })),
    );
  }, []);

  const registerRemoteContainer = useCallback(
    (uid: string | number, element: HTMLDivElement | null) => {
      const key = String(uid);
      if (element) {
        remoteContainers.current.set(key, element);
        // Replay in case the tile mounted after the publish event arrived.
        const user = clientRef.current?.remoteUsers.find((u) => String(u.uid) === key);
        user?.videoTrack?.play(element);
      } else {
        remoteContainers.current.delete(key);
      }
    },
    [],
  );

  const leave = useCallback(async () => {
    const client = clientRef.current;
    micTrackRef.current?.stop();
    micTrackRef.current?.close();
    camTrackRef.current?.stop();
    camTrackRef.current?.close();
    micTrackRef.current = null;
    camTrackRef.current = null;

    if (client) {
      try {
        await client.leave();
      } catch {
        // Leaving a channel we are no longer in is not worth surfacing.
      }
      client.removeAllListeners();
    }
    clientRef.current = null;
    setRemotes([]);
    setStatus("idle");
  }, []);

  const join = useCallback(async () => {
    setStatus("joining");
    setError(null);

    try {
      const response = await fetch("/api/consult/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({ patientId, role, displayName }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not start the consult");

      const creds = payload as ConsultCredentials;
      setCredentials(creds);

      const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
      // Only surface real problems; the SDK is chatty at info level.
      AgoraRTC.setLogLevel(2);

      const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      clientRef.current = client;

      client.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType) => {
        await client.subscribe(user, mediaType);
        if (mediaType === "video") {
          const container = remoteContainers.current.get(String(user.uid));
          if (container) user.videoTrack?.play(container);
        }
        if (mediaType === "audio") {
          user.audioTrack?.play();
        }
        syncRemotes(client);
      });

      client.on("user-unpublished", () => syncRemotes(client));
      client.on("user-left", () => syncRemotes(client));

      // The token carries its own expiry; renew before Agora drops the call.
      client.on("token-privilege-will-expire", async () => {
        try {
          const renew = await fetch("/api/consult/token", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiToken}`,
            },
            body: JSON.stringify({ patientId, role, displayName }),
          });
          const fresh = (await renew.json()) as ConsultCredentials;
          if (renew.ok) await client.renewToken(fresh.token);
        } catch {
          // Nothing useful to do here; the call will end at expiry.
        }
      });

      await client.join(creds.appId, creds.channel, creds.token, creds.uid);

      // Observers subscribe only — the token would reject a publish anyway.
      if (creds.role !== "observer") {
        const [mic, cam] = await AgoraRTC.createMicrophoneAndCameraTracks();
        micTrackRef.current = mic;
        camTrackRef.current = cam;
        if (localContainer.current) cam.play(localContainer.current);
        await client.publish([mic, cam]);
      }

      syncRemotes(client);
      setStatus("connected");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join the consult");
      setStatus("error");
      await leave();
    }
  }, [apiToken, patientId, role, displayName, syncRemotes, leave]);

  const toggleMic = useCallback(async () => {
    const track = micTrackRef.current;
    if (!track) return;
    const next = !micOn;
    await track.setEnabled(next);
    setMicOn(next);
  }, [micOn]);

  const toggleCamera = useCallback(async () => {
    const track = camTrackRef.current;
    if (!track) return;
    const next = !cameraOn;
    await track.setEnabled(next);
    setCameraOn(next);
  }, [cameraOn]);

  // Release the mic/camera if the component unmounts mid-call.
  useEffect(() => {
    return () => {
      void leave();
    };
  }, [leave]);

  return {
    status,
    error,
    credentials,
    remotes,
    micOn,
    cameraOn,
    registerLocalContainer,
    registerRemoteContainer,
    join,
    leave,
    toggleMic,
    toggleCamera,
  };
}
