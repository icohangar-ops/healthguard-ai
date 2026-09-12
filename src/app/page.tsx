"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  ArrowUpRight,
  Brain,
  Clock3,
  Flame,
  MessageSquare,
  RefreshCcw,
  Shield,
  Sparkles,
  Users,
  AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type TriageVitals = {
  heartRate: number;
  systolic: number;
  diastolic: number;
  temperature: number;
  spo2: number;
};

type TriageCase = {
  id: string;
  name: string;
  age: number;
  gender: string;
  conditions: string;
  medications: string;
  latestVitals: TriageVitals | null;
  activeAlertCount: number;
  hasCriticalAlert: boolean;
  score: number;
  tier: "critical" | "urgent" | "watch" | "routine";
  reasons: string[];
  nextStep: string;
  patternId: string;
  summary: string;
  history: Array<{
    id: string;
    caseId: string;
    kind: string;
    title: string;
    detail: string;
    createdAt: string;
  }>;
  createdAt?: string;
  updatedAt?: string;
};

type CareQueueSnapshot = {
  mode: "pulse" | "mock";
  summary: {
    total: number;
    critical: number;
    urgent: number;
    watch: number;
    routine: number;
    averageScore: number;
  };
  cases: TriageCase[];
  memory: Array<{ patternId: string; count: number; lastOutcome: string }>;
};

const tierStyles: Record<TriageCase["tier"], string> = {
  critical: "border-red-500/30 bg-red-500/10 text-red-200",
  urgent: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  watch: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  routine: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
};

export default function CareQueuePage() {
  const [snapshot, setSnapshot] = useState<CareQueueSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [navigatorReply, setNavigatorReply] = useState<string>("");
  const [sendingChat, setSendingChat] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/cases");
        const data = (await res.json()) as CareQueueSnapshot;
        if (!ignore) {
          setSnapshot(data);
          setSelectedId((current) => current ?? data.cases[0]?.id ?? null);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, []);

  const selectedCase = useMemo(() => {
    if (!snapshot) return null;
    return snapshot.cases.find((row) => row.id === selectedId) ?? snapshot.cases[0] ?? null;
  }, [selectedId, snapshot]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/cases");
      const data = (await res.json()) as CareQueueSnapshot;
      setSnapshot(data);
      setSelectedId((current) => current ?? data.cases[0]?.id ?? null);
    } finally {
      setLoading(false);
    }
  }

  async function submitFeedback(outcome: string) {
    if (!selectedCase) return;
    setSendingFeedback(true);
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: selectedCase.id,
          outcome,
          note,
          patternId: selectedCase.patternId,
        }),
      });
      setNote("");
      await refresh();
    } finally {
      setSendingFeedback(false);
    }
  }

  async function askNavigator() {
    if (!selectedCase) return;
    setSendingChat(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: `Give a concise triage plan for ${selectedCase.name}. Focus on next steps, safety concerns, and what the team should verify.`,
            },
          ],
          caseData: selectedCase,
        }),
      });
      const data = (await res.json()) as { content?: string };
      setNavigatorReply(data.content || "No reply returned.");
    } finally {
      setSendingChat(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-zinc-950 text-slate-100 bg-grid">
      <header className="border-b border-white/5 bg-slate-950/70 backdrop-blur-xl sticky top-0 z-20">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 shadow-lg shadow-amber-500/20">
              <Shield className="h-5 w-5 text-slate-950" />
            </div>
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                CareQueue <span className="text-amber-400">AI</span>
              </div>
              <div className="text-xs text-slate-400">Pulse-backed triage cockpit</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className={cn("h-2 w-2 rounded-full", snapshot?.mode === "pulse" ? "bg-emerald-400" : "bg-amber-400")}></span>
            {snapshot?.mode === "pulse" ? "Pulse live" : "Mock fallback"}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <section className="grid gap-4 lg:grid-cols-4">
          {[
            { label: "Cases", value: snapshot?.summary.total ?? 0, icon: Users },
            { label: "Critical", value: snapshot?.summary.critical ?? 0, icon: Flame },
            { label: "Urgent", value: snapshot?.summary.urgent ?? 0, icon: AlertTriangle },
            { label: "Avg Score", value: snapshot?.summary.averageScore ?? 0, icon: Activity },
          ].map((card) => (
            <Card key={card.label} className="border-white/5 bg-white/[0.03]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardDescription>{card.label}</CardDescription>
                <card.icon className="h-4 w-4 text-amber-400" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold tracking-tight">
                  {loading ? <Skeleton className="h-9 w-16 bg-white/10" /> : card.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-white/5 bg-white/[0.03]">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Queue</CardTitle>
                <CardDescription>Deterministic ranking, then Pulse memory.</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
                <RefreshCcw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading && !snapshot ? (
                <div className="space-y-3">
                  <Skeleton className="h-24 bg-white/10" />
                  <Skeleton className="h-24 bg-white/10" />
                  <Skeleton className="h-24 bg-white/10" />
                </div>
              ) : (
                snapshot?.cases.map((row) => (
                  <button
                    key={row.id}
                    onClick={() => setSelectedId(row.id)}
                    className={cn(
                      "w-full rounded-2xl border p-4 text-left transition",
                      selectedCase?.id === row.id ? "border-amber-400/50 bg-amber-400/10" : "border-white/5 bg-white/[0.02] hover:bg-white/[0.04]",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{row.name}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {row.age} {row.gender} - {row.conditions}
                        </div>
                      </div>
                      <Badge className={cn("border", tierStyles[row.tier])}>{row.tier}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                      <span className="rounded-full bg-white/5 px-2.5 py-1">Score {row.score}</span>
                      <span className="rounded-full bg-white/5 px-2.5 py-1">Pattern {row.patternId}</span>
                      <span className="rounded-full bg-white/5 px-2.5 py-1">{row.activeAlertCount} alerts</span>
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-white/5 bg-white/[0.03]">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>{selectedCase?.name ?? "Selected case"}</CardTitle>
                  <CardDescription>{selectedCase?.summary ?? "Pick a case from the queue."}</CardDescription>
                </div>
                {selectedCase ? <Badge className={cn("border", tierStyles[selectedCase.tier])}>{selectedCase.tier}</Badge> : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedCase ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-400">Next step</div>
                      <div className="mt-1 text-sm font-medium">{selectedCase.nextStep}</div>
                    </div>
                    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-400">Last updated</div>
                      <div className="mt-1 text-sm font-medium">
                        {selectedCase.updatedAt
                          ? formatDistanceToNow(new Date(selectedCase.updatedAt), { addSuffix: true })
                          : "just now"}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400">Reasons</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedCase.reasons.map((reason) => (
                        <Badge key={reason} variant="secondary" className="bg-white/5 text-slate-200">
                          {reason}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <Separator className="bg-white/5" />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-400">Vitals</div>
                      <div className="mt-2 text-sm text-slate-200">
                        {selectedCase.latestVitals
                          ? `${selectedCase.latestVitals.heartRate} bpm, ${selectedCase.latestVitals.systolic}/${selectedCase.latestVitals.diastolic}, SpO2 ${selectedCase.latestVitals.spo2}%, ${selectedCase.latestVitals.temperature}F`
                          : "No vitals recorded"}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-400">Pattern</div>
                      <div className="mt-2 text-sm text-slate-200">{selectedCase.patternId}</div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs uppercase tracking-wide text-slate-400">Conditions and meds</div>
                    <div className="text-sm text-slate-300">{selectedCase.conditions}</div>
                    <div className="text-sm text-slate-400">{selectedCase.medications}</div>
                  </div>

                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400">Case history</div>
                    <div className="mt-2 space-y-2 max-h-64 overflow-auto pr-1">
                      {selectedCase.history.length > 0 ? selectedCase.history.map((entry) => (
                        <div key={entry.id} className="rounded-2xl border border-white/5 bg-white/[0.02] p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-slate-100">{entry.title}</div>
                            <div className="text-[11px] uppercase tracking-wide text-slate-500">{entry.kind}</div>
                          </div>
                          <div className="mt-1 text-sm text-slate-300">{entry.detail}</div>
                          <div className="mt-2 text-[11px] text-slate-500">
                            {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                          </div>
                        </div>
                      )) : (
                        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3 text-sm text-slate-400">
                          No history recorded yet.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      "Escalated",
                      "Same-day review",
                      "Callback scheduled",
                      "Resolved",
                    ].map((outcome) => (
                      <Button
                        key={outcome}
                        variant="outline"
                        size="sm"
                        disabled={sendingFeedback}
                        onClick={() => submitFeedback(outcome)}
                        className="justify-start"
                      >
                        <ArrowUpRight className="mr-2 h-4 w-4" />
                        {outcome}
                      </Button>
                    ))}
                  </div>

                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add a brief learning note for the next case..."
                    className="min-h-24 border-white/10 bg-white/5"
                  />

                  <div className="flex flex-wrap gap-2">
                    <Button onClick={askNavigator} disabled={sendingChat} className="bg-amber-400 text-slate-950 hover:bg-amber-300">
                      <MessageSquare className="mr-2 h-4 w-4" />
                      Ask navigator
                    </Button>
                    <Button variant="ghost" onClick={refresh}>
                      <RefreshCcw className="mr-2 h-4 w-4" />
                      Re-rank queue
                    </Button>
                  </div>

                  {navigatorReply ? (
                    <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-slate-100">
                      {navigatorReply}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="text-sm text-slate-400">No case selected.</div>
              )}
            </CardContent>
          </Card>
        </section>

        <Tabs defaultValue="memory" className="mt-6">
          <TabsList className="grid w-full grid-cols-2 bg-white/[0.04]">
            <TabsTrigger value="memory">Pulse memory</TabsTrigger>
            <TabsTrigger value="workflow">Workflow</TabsTrigger>
          </TabsList>

          <TabsContent value="memory" className="mt-4">
            <Card className="border-white/5 bg-white/[0.03]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5 text-amber-400" />
                  Learning signals
                </CardTitle>
                <CardDescription>The same closed-loop idea from outreach, redirected into triage memory.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-3">
                  {snapshot?.memory.map((row) => (
                    <div key={row.patternId} className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">{row.patternId}</div>
                        <Badge variant="secondary" className="bg-white/5">{row.count}</Badge>
                      </div>
                      <div className="mt-2 text-xs text-slate-400">Last outcome: {row.lastOutcome}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="workflow" className="mt-4">
            <Card className="border-white/5 bg-white/[0.03]">
              <CardHeader>
                <CardTitle>How it works</CardTitle>
                <CardDescription>Pulse holds queue state. The app scores cases locally, then writes feedback back into the same living schema.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-4">
                {[
                  ["Ingest", "Cases and vitals land in Pulse or the seeded fallback."],
                  ["Score", "Deterministic triage rules rank urgency and explain why."],
                  ["Act", "The navigator suggests next steps and clinician escalation."],
                  ["Learn", "Feedback writes pattern signals back into Pulse."],
                ].map(([title, body]) => (
                  <div key={title} className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                    <div className="flex items-center gap-2 font-medium">
                      <Sparkles className="h-4 w-4 text-amber-400" />
                      {title}
                    </div>
                    <div className="mt-2 text-sm text-slate-400">{body}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <footer className="mt-8 flex items-center justify-between border-t border-white/5 pt-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <Clock3 className="h-3.5 w-3.5" />
            Built for live triage, with mock fallback when Pulse is not configured.
          </div>
          <div>CareQueue AI</div>
        </footer>
      </main>
    </div>
  );
}
