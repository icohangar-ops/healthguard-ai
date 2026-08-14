"use client";

/**
 * Telehealth consult room.
 *
 * Escalation target for the navigator: when the AI has taken a patient as far
 * as it safely can, this is the room a human clinician joins.
 *
 * The PHI posture is rendered, not hidden. If the deployment has no BAA with
 * Agora, the operator sees exactly which controls are disabled and why —
 * far better than a "Record" button that 403s the moment someone needs it.
 */
import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Captions,
  Circle,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  ShieldCheck,
  Video,
  VideoOff,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useAgoraConsult, type ConsultRole } from "@/hooks/use-agora-consult";
import { cn } from "@/lib/utils";

interface ConsultRoomProps {
  apiToken: string;
  role: ConsultRole;
  displayName: string;
  patientId?: string;
}

type ToggleState = { pending: boolean; on: boolean; error: string | null };

const IDLE: ToggleState = { pending: false, on: false, error: null };

export function ConsultRoom({ apiToken, role, displayName, patientId }: ConsultRoomProps) {
  const {
    status,
    error: joinError,
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
  } = useAgoraConsult({ apiToken, role, displayName, patientId });
  const [voiceAgent, setVoiceAgent] = useState<ToggleState>(IDLE);
  const [captions, setCaptions] = useState<ToggleState>(IDLE);
  const [recording, setRecording] = useState<ToggleState>(IDLE);
  const voiceAgentRef = useRef<ToggleState>(IDLE);
  const captionsRef = useRef<ToggleState>(IDLE);
  const recordingRef = useRef<ToggleState>(IDLE);

  const caps = credentials?.capabilities;
  const sessionId = credentials?.sessionId;
  const connected = status === "connected";
  const hasPatientRecord = Boolean(credentials?.patientId);

  const call = useCallback(
    async (
      path: string,
      ref: React.MutableRefObject<ToggleState>,
      setState: React.Dispatch<React.SetStateAction<ToggleState>>,
      body: Record<string, unknown> = {},
    ) => {
      if (!sessionId) return;

      const current = ref.current;
      if (current.pending) return;
      const wasOn = current.on;
      const pending = { ...current, pending: true, error: null };
      ref.current = pending;
      setState(pending);

      try {
        const response = await fetch(path, {
          method: wasOn ? "DELETE" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiToken}`,
          },
          body: JSON.stringify({ sessionId, ...body }),
        });
        const payload = (await response.json()) as { error?: string };
        // 409 on start means the feature is already running (double-click or
        // a concurrent start). Treat as on so hangUp still issues DELETE.
        if (response.status === 409 && !wasOn) {
          const next = { pending: false, on: true, error: null };
          ref.current = next;
          setState(next);
          return;
        }
        if (!response.ok) throw new Error(payload.error ?? "Request failed");
        const next = { pending: false, on: !wasOn, error: null };
        ref.current = next;
        setState(next);
      } catch (err) {
        setState((prev) => {
          const next = {
            pending: false,
            on: prev.on,
            error: err instanceof Error ? err.message : "Request failed",
          };
          ref.current = next;
          return next;
        });
      }
    },
    [apiToken, sessionId],
  );

  const hangUp = useCallback(async () => {
    if (sessionId) {
      const stop = async (path: string, feature: ToggleState) => {
        // pending covers an in-flight POST whose success has not flipped `on`.
        if (!feature.on && !feature.pending) return;
        try {
          await fetch(path, {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiToken}`,
            },
            body: JSON.stringify({ sessionId }),
          });
        } catch {
          // Best-effort; Agora idle timeouts are the backstop.
        }
      };
      // Recording first so a dropped call still produces files.
      await stop("/api/consult/record", recordingRef.current);
      await stop("/api/consult/navigator", voiceAgentRef.current);
      await stop("/api/consult/transcript", captionsRef.current);
    }
    voiceAgentRef.current = IDLE;
    captionsRef.current = IDLE;
    recordingRef.current = IDLE;
    setVoiceAgent(IDLE);
    setCaptions(IDLE);
    setRecording(IDLE);
    await leave();
  }, [apiToken, sessionId, leave]);

  if (status === "idle" || status === "error") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Video className="h-5 w-5" />
            Start a consult
          </CardTitle>
          <CardDescription>
            Connect {role === "patient" ? "with a clinician" : "to the patient"} over
            live video.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {joinError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{joinError}</span>
            </div>
          )}
          <Button onClick={() => void join()}>
            <Video className="mr-2 h-4 w-4" />
            Join consult
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (status === "joining") {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-10">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm text-muted-foreground">Connecting…</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Video className="h-5 w-5" />
            Consult in progress
          </CardTitle>
          <PostureBadge
            posture={credentials?.phi.posture ?? "transport-only"}
            reason={credentials?.phi.reason ?? ""}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Tile label={`${displayName} (you)`}>
            <div ref={registerLocalContainer} className="h-full w-full" />
          </Tile>

          {remotes.length === 0 ? (
            <Tile label="Waiting for the other participant" muted>
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No one else has joined yet
              </div>
            </Tile>
          ) : (
            remotes.map((remote) => (
              <Tile key={String(remote.uid)} label={`Participant ${remote.uid}`}>
                <div
                  ref={(el) => registerRemoteContainer(remote.uid, el)}
                  className="h-full w-full"
                />
              </Tile>
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={micOn ? "secondary" : "destructive"}
            size="sm"
            onClick={() => void toggleMic()}
            disabled={role === "observer"}
          >
            {micOn ? (
              <Mic className="mr-2 h-4 w-4" />
            ) : (
              <MicOff className="mr-2 h-4 w-4" />
            )}
            {micOn ? "Mute" : "Unmute"}
          </Button>

          <Button
            variant={cameraOn ? "secondary" : "destructive"}
            size="sm"
            onClick={() => void toggleCamera()}
            disabled={role === "observer"}
          >
            {cameraOn ? (
              <Video className="mr-2 h-4 w-4" />
            ) : (
              <VideoOff className="mr-2 h-4 w-4" />
            )}
            {cameraOn ? "Stop video" : "Start video"}
          </Button>

          <Button variant="destructive" size="sm" onClick={() => void hangUp()}>
            <PhoneOff className="mr-2 h-4 w-4" />
            Leave
          </Button>
        </div>

        <Separator />

        <div className="space-y-2">
          <FeatureToggle
            icon={<Bot className="h-4 w-4" />}
            label="Voice navigator"
            description={
              caps?.phiInPrompt && hasPatientRecord
                ? "Speaks with the patient and can see their record."
                : "Speaks with the patient. No patient record is shared."
            }
            state={voiceAgent}
            available={Boolean(caps?.voiceNavigator) && connected}
            unavailableReason="Agora REST credentials are not configured."
            onToggle={() =>
              void call("/api/consult/navigator", voiceAgentRef, setVoiceAgent)
            }
          />

          <FeatureToggle
            icon={<Captions className="h-4 w-4" />}
            label="Live captions"
            description="Caption task lifecycle is implemented; on-screen rendering is not wired yet."
            state={captions}
            available={false}
            unavailableReason="Caption rendering is not wired yet. The transcript task API exists for a later UI."
            onToggle={() =>
              void call("/api/consult/transcript", captionsRef, setCaptions, {
                persist: Boolean(caps?.storedTranscript),
              })
            }
          />

          <FeatureToggle
            icon={<Circle className="h-4 w-4" />}
            label="Record visit"
            description="Stores the consult in configured object storage. Not automatically attached to the patient record."
            state={recording}
            available={Boolean(caps?.recording) && connected}
            unavailableReason="Recording a consult stores PHI with Agora. Requires a signed BAA."
            onToggle={() => void call("/api/consult/record", recordingRef, setRecording)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function PostureBadge({ posture, reason }: { posture: string; reason: string }) {
  const baa = posture === "baa-signed";
  return (
    <Badge
      variant={baa ? "default" : "outline"}
      className={cn("gap-1", !baa && "border-amber-500/50 text-amber-600")}
      title={reason}
    >
      {baa ? <ShieldCheck className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {baa ? "BAA on file" : "Transport only"}
    </Badge>
  );
}

function Tile({
  label,
  muted,
  children,
}: {
  label: string;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div
        className={cn(
          "aspect-video overflow-hidden rounded-lg bg-muted",
          muted && "border border-dashed",
        )}
      >
        {children}
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function FeatureToggle({
  icon,
  label,
  description,
  state,
  available,
  unavailableReason,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  state: ToggleState;
  available: boolean;
  unavailableReason: string;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border p-3">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {label}
        </div>
        <p className="text-xs text-muted-foreground">
          {available ? description : unavailableReason}
        </p>
        {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      </div>
      <Button
        size="sm"
        variant={state.on ? "destructive" : "secondary"}
        disabled={!available || state.pending}
        onClick={onToggle}
      >
        {state.pending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
        {state.on ? "Stop" : "Start"}
      </Button>
    </div>
  );
}
