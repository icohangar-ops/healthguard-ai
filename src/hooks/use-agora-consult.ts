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
  patientId: string | null;
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
  const credentialsRef = useRef<ConsultCredentials | null>(null);
  const joinGeneration = useRef(0);

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
        const user = clientRef.current?.remoteUsers.find((u) => String(u.uid) === key);
        user?.videoTrack?.play(element);
      } else {
        remoteContainers.current.delete(key);
      }
    },
    [],
  );

  const closeTracks = useCallback(() => {
    micTrackRef.current?.stop();
    micTrackRef.current?.close();
    camTrackRef.current?.stop();
    camTrackRef.current?.close();
    micTrackRef.current = null;
    camTrackRef.current = null;
  }, []);

  const leave = useCallback(async () => {
    joinGeneration.current += 1;
    const client = clientRef.current;
    closeTracks();

    if (client) {
      try {
        await client.leave();
      } catch {
        // Leaving a channel we are no longer in is not worth surfacing.
      }
      client.removeAllListeners();
    }
    clientRef.current = null;
    credentialsRef.current = null;
    setCredentials(null);
    setRemotes([]);
    setMicOn(true);
    setCameraOn(true);
    setStatus("idle");
  }, [closeTracks]);

  const join = useCallback(async () => {
    const generation = ++joinGeneration.current;
    setStatus("joining");
    setError(null);

    const stale = () => joinGeneration.current !== generation;

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
      if (stale()) return;

      const creds = payload as ConsultCredentials;
      credentialsRef.current = creds;
      setCredentials(creds);

      const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
      if (stale()) return;
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

      client.on("token-privilege-will-expire", async () => {
        const current = credentialsRef.current;
        if (!current) return;
        try {
          const renew = await fetch("/api/consult/token", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiToken}`,
            },
            body: JSON.stringify({
              sessionId: current.sessionId,
              uid: current.uid,
              role: current.role,
              displayName,
            }),
          });
          const fresh = (await renew.json()) as ConsultCredentials;
          if (renew.ok) {
            credentialsRef.current = { ...current, token: fresh.token, expiresAt: fresh.expiresAt };
            await client.renewToken(fresh.token);
          }
        } catch {
          // The call will end at expiry.
        }
      });

      await client.join(creds.appId, creds.channel, creds.token, creds.uid);
      if (stale()) {
        await client.leave();
        client.removeAllListeners();
        return;
      }

      if (creds.role !== "observer") {
        const [mic, cam] = await AgoraRTC.createMicrophoneAndCameraTracks();
        if (stale()) {
          mic.stop();
          mic.close();
          cam.stop();
          cam.close();
          await client.leave();
          client.removeAllListeners();
          return;
        }
        micTrackRef.current = mic;
        camTrackRef.current = cam;
        if (localContainer.current) cam.play(localContainer.current);
        await client.publish([mic, cam]);
        if (stale()) {
          closeTracks();
          await client.leave();
          client.removeAllListeners();
          return;
        }
      }

      syncRemotes(client);
      setStatus("connected");
    } catch (err) {
      if (stale()) return;
      setError(err instanceof Error ? err.message : "Failed to join the consult");
      setStatus("error");
      await leave();
    }
  }, [apiToken, patientId, role, displayName, syncRemotes, leave, closeTracks]);

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
