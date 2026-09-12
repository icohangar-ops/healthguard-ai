import { randomUUID } from "crypto";
import { rankCases, scoreCase, type TriageCase, type TriageInput } from "@/lib/triage-engine";

export type CaseHistoryKind = "intake" | "alert" | "note" | "feedback" | "navigator";

export type CaseHistoryEntry = {
  id: string;
  caseId: string;
  kind: CaseHistoryKind;
  title: string;
  detail: string;
  createdAt: string;
};

export type QueueCase = TriageCase & {
  history: CaseHistoryEntry[];
};

type PulseSignal = {
  id: string;
  caseId: string;
  outcome: string;
  note: string;
  patternId: string;
  createdAt: string;
};

type CareQueueSnapshot = {
  mode: "pulse" | "mock";
  cases: QueueCase[];
  summary: {
    total: number;
    critical: number;
    urgent: number;
    watch: number;
    routine: number;
    averageScore: number;
  };
  memory: Array<{ patternId: string; count: number; lastOutcome: string }>;
};

const PULSE_URL = "https://pulse.evorozen.com/api/neural";
const CASE_TABLE = "triage_cases";
const SIGNAL_TABLE = "learning_signals";
const HISTORY_TABLE = "case_history";

const seedCases: TriageInput[] = [
  {
    id: "case-asha-khan",
    name: "Asha Khan",
    age: 68,
    gender: "Female",
    conditions: "COPD, CHF",
    medications: "Albuterol, furosemide",
    latestVitals: { heartRate: 104, systolic: 146, diastolic: 92, temperature: 99.1, spo2: 91 },
    activeAlertCount: 3,
    hasCriticalAlert: true,
    createdAt: "2026-09-10T08:20:00.000Z",
    updatedAt: "2026-09-12T11:15:00.000Z",
  },
  {
    id: "case-marcus-chen",
    name: "Marcus Chen",
    age: 56,
    gender: "Male",
    conditions: "Type 2 diabetes, CAD",
    medications: "Metformin, aspirin, statin",
    latestVitals: { heartRate: 98, systolic: 168, diastolic: 101, temperature: 98.4, spo2: 95 },
    activeAlertCount: 2,
    hasCriticalAlert: false,
    createdAt: "2026-09-11T09:00:00.000Z",
    updatedAt: "2026-09-12T11:10:00.000Z",
  },
  {
    id: "case-elena-rodriguez",
    name: "Elena Rodriguez",
    age: 74,
    gender: "Female",
    conditions: "COPD, atrial fibrillation",
    medications: "Tiotropium, apixaban",
    latestVitals: { heartRate: 118, systolic: 132, diastolic: 84, temperature: 99.6, spo2: 88 },
    activeAlertCount: 4,
    hasCriticalAlert: true,
    createdAt: "2026-09-11T13:45:00.000Z",
    updatedAt: "2026-09-12T11:02:00.000Z",
  },
];

const mockSignals: PulseSignal[] = [
  {
    id: "signal-1",
    caseId: "case-asha-khan",
    outcome: "same-day review",
    note: "Respiratory history and low SpO2 made this case jump to the top.",
    patternId: "respiratory-escalation",
    createdAt: "2026-09-12T10:00:00.000Z",
  },
  {
    id: "signal-2",
    caseId: "case-marcus-chen",
    outcome: "follow-up",
    note: "Severe blood pressure without instability stayed in urgent instead of critical.",
    patternId: "bp-followup",
    createdAt: "2026-09-12T10:24:00.000Z",
  },
];

const mockCaseHistory: CaseHistoryEntry[] = [
  {
    id: "history-asha-1",
    caseId: "case-asha-khan",
    kind: "intake",
    title: "New intake created",
    detail: "Reported shortness of breath overnight with COPD and CHF history.",
    createdAt: "2026-09-12T08:22:00.000Z",
  },
  {
    id: "history-asha-2",
    caseId: "case-asha-khan",
    kind: "alert",
    title: "Critical alert raised",
    detail: "SpO2 fell to 91 percent and open alerts increased to three.",
    createdAt: "2026-09-12T10:05:00.000Z",
  },
  {
    id: "history-marcus-1",
    caseId: "case-marcus-chen",
    kind: "intake",
    title: "Referral received",
    detail: "Referral for elevated blood pressure and diabetes follow-up.",
    createdAt: "2026-09-12T08:55:00.000Z",
  },
  {
    id: "history-marcus-2",
    caseId: "case-marcus-chen",
    kind: "note",
    title: "Provider note added",
    detail: "No chest pain reported, but blood pressure remains severe.",
    createdAt: "2026-09-12T10:35:00.000Z",
  },
  {
    id: "history-elena-1",
    caseId: "case-elena-rodriguez",
    kind: "intake",
    title: "Rapid response intake",
    detail: "Patient with COPD and atrial fibrillation presented with low oxygen saturation.",
    createdAt: "2026-09-12T08:10:00.000Z",
  },
  {
    id: "history-elena-2",
    caseId: "case-elena-rodriguez",
    kind: "alert",
    title: "Escalation triggered",
    detail: "SpO2 dropped below 90 percent with four active alerts.",
    createdAt: "2026-09-12T09:58:00.000Z",
  },
];

const seedHistory: CaseHistoryEntry[] = mockCaseHistory;

function pulseConfigured(): boolean {
  return Boolean(process.env.EVOROZEN_API_KEY);
}

async function neuralRequest<T>(body: Record<string, unknown>): Promise<T> {
  const apiKey = process.env.EVOROZEN_API_KEY;
  if (!apiKey) {
    throw new Error("EVOROZEN_API_KEY is not configured");
  }

  const res = await fetch(PULSE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Pulse request failed with ${res.status}`);
  }

  return (await res.json()) as T;
}

async function ensureSchema(): Promise<void> {
  try {
    await neuralRequest({
      action_type: "create_schema",
      prompt: "Create triage queue schema",
      data_payload: {
        tables: [
          {
            name: CASE_TABLE,
            columns: [
              { name: "id", type: "text", primary: true },
              { name: "name", type: "text" },
              { name: "age", type: "int" },
              { name: "gender", type: "text" },
              { name: "conditions", type: "text" },
              { name: "medications", type: "text" },
              { name: "heart_rate", type: "int" },
              { name: "systolic", type: "int" },
              { name: "diastolic", type: "int" },
              { name: "temperature", type: "float" },
              { name: "spo2", type: "int" },
              { name: "active_alert_count", type: "int" },
              { name: "has_critical_alert", type: "boolean" },
              { name: "score", type: "int" },
              { name: "tier", type: "text" },
              { name: "reasons", type: "text" },
              { name: "next_step", type: "text" },
              { name: "pattern_id", type: "text" },
              { name: "summary", type: "text" },
              { name: "created_at", type: "text" },
              { name: "updated_at", type: "text" },
            ],
          },
          {
            name: SIGNAL_TABLE,
            columns: [
              { name: "id", type: "text", primary: true },
              { name: "case_id", type: "text" },
              { name: "outcome", type: "text" },
              { name: "note", type: "text" },
              { name: "pattern_id", type: "text" },
              { name: "created_at", type: "text" },
            ],
          },
          {
            name: HISTORY_TABLE,
            columns: [
              { name: "id", type: "text", primary: true },
              { name: "case_id", type: "text" },
              { name: "kind", type: "text" },
              { name: "title", type: "text" },
              { name: "detail", type: "text" },
              { name: "created_at", type: "text" },
            ],
          },
        ],
      },
    });
  } catch {
    // Schema creation is idempotent in the happy path; if it already exists or
    // Pulse rejects the bootstrap call, we continue and let the select/insert
    // path decide whether to fall back to seeded mock data.
  }
}

function rowToInput(row: Record<string, unknown>): TriageInput {
  const hasCriticalAlert =
    row.has_critical_alert === true || String(row.has_critical_alert ?? "").toLowerCase() === "true";

  return {
    id: String(row.id ?? row.case_id),
    name: String(row.name ?? "Unknown"),
    age: Number(row.age ?? 0),
    gender: String(row.gender ?? "Unknown"),
    conditions: String(row.conditions ?? ""),
    medications: String(row.medications ?? ""),
    latestVitals: {
      heartRate: Number(row.heart_rate ?? 0),
      systolic: Number(row.systolic ?? 0),
      diastolic: Number(row.diastolic ?? 0),
      temperature: Number(row.temperature ?? 0),
      spo2: Number(row.spo2 ?? 0),
    },
    activeAlertCount: Number(row.active_alert_count ?? 0),
    hasCriticalAlert,
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

function extractRows(result: Record<string, unknown>): Record<string, unknown>[] {
  const rows = result.data ?? result.rows ?? result.records ?? [];
  return Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
}

function toHistoryEntry(row: Record<string, unknown>): CaseHistoryEntry {
  return {
    id: String(row.id ?? randomUUID()),
    caseId: String(row.case_id ?? row.caseId ?? ""),
    kind: normalizeHistoryKind(String(row.kind ?? "note")),
    title: String(row.title ?? "Update"),
    detail: String(row.detail ?? ""),
    createdAt: String(row.created_at ?? row.createdAt ?? new Date().toISOString()),
  };
}

function normalizeHistoryKind(value: string): CaseHistoryKind {
  const normalized = value.trim().toLowerCase();
  if (normalized === "intake" || normalized === "alert" || normalized === "note" || normalized === "feedback" || normalized === "navigator") {
    return normalized;
  }
  return "note";
}

function deriveMemory(signals: PulseSignal[]): CareQueueSnapshot["memory"] {
  const counts = new Map<string, { count: number; lastOutcome: string }>();
  for (const signal of signals) {
    const current = counts.get(signal.patternId) ?? { count: 0, lastOutcome: signal.outcome };
    counts.set(signal.patternId, {
      count: current.count + 1,
      lastOutcome: signal.outcome,
    });
  }

  return Array.from(counts.entries())
    .map(([patternId, value]) => ({ patternId, ...value }))
    .sort((a, b) => b.count - a.count);
}

function summarize(cases: QueueCase[]): CareQueueSnapshot["summary"] {
  const total = cases.length;
  const critical = cases.filter((row) => row.tier === "critical").length;
  const urgent = cases.filter((row) => row.tier === "urgent").length;
  const watch = cases.filter((row) => row.tier === "watch").length;
  const routine = cases.filter((row) => row.tier === "routine").length;
  const averageScore = total ? Math.round(cases.reduce((sum, row) => sum + row.score, 0) / total) : 0;

  return { total, critical, urgent, watch, routine, averageScore };
}

function attachHistory(cases: TriageCase[], historyRows: CaseHistoryEntry[]): QueueCase[] {
  const historyByCase = new Map<string, CaseHistoryEntry[]>();
  for (const entry of historyRows) {
    const list = historyByCase.get(entry.caseId) ?? [];
    list.push(entry);
    historyByCase.set(entry.caseId, list);
  }

  return cases.map((row) => ({
    ...row,
    history: (historyByCase.get(row.id) ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  }));
}

function mockHistory(): CaseHistoryEntry[] {
  return [...mockCaseHistory].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function pushMockHistory(entry: CaseHistoryEntry): void {
  mockCaseHistory.unshift(entry);
}

export async function getCareQueueSnapshot(): Promise<CareQueueSnapshot> {
  if (!pulseConfigured()) {
    const cases = attachHistory(rankCases(seedCases), mockHistory());
    return {
      mode: "mock",
      cases,
      summary: summarize(cases),
      memory: deriveMemory(mockSignals),
    };
  }

  try {
    await ensureSchema();

    const caseResult = await neuralRequest<Record<string, unknown>>({
      action_type: "select_data",
      prompt: "Load triage queue",
      data_payload: { table: CASE_TABLE },
    });

    let rows = extractRows(caseResult).map(rowToInput);

    if (rows.length === 0) {
      for (const seed of seedCases.map(scoreCase)) {
        await neuralRequest({
          action_type: "insert_data",
          prompt: `Seed triage case ${seed.name}`,
          data_payload: {
            table: CASE_TABLE,
            record: {
              id: seed.id,
              name: seed.name,
              age: seed.age,
              gender: seed.gender,
              conditions: seed.conditions,
              medications: seed.medications,
              heart_rate: seed.latestVitals?.heartRate ?? 0,
              systolic: seed.latestVitals?.systolic ?? 0,
              diastolic: seed.latestVitals?.diastolic ?? 0,
              temperature: seed.latestVitals?.temperature ?? 0,
              spo2: seed.latestVitals?.spo2 ?? 0,
              active_alert_count: seed.activeAlertCount,
              has_critical_alert: seed.hasCriticalAlert,
              score: seed.score,
              tier: seed.tier,
              reasons: seed.reasons.join(" | "),
              next_step: seed.nextStep,
              pattern_id: seed.patternId,
              summary: seed.summary,
              created_at: seed.createdAt ?? new Date().toISOString(),
              updated_at: seed.updatedAt ?? new Date().toISOString(),
            },
          },
        });
      }

      for (const history of seedHistory) {
        await neuralRequest({
          action_type: "insert_data",
          prompt: `Seed history for ${history.caseId}`,
          data_payload: {
            table: HISTORY_TABLE,
            record: {
              id: history.id,
              case_id: history.caseId,
              kind: history.kind,
              title: history.title,
              detail: history.detail,
              created_at: history.createdAt,
            },
          },
        });
      }

      const seeded = await neuralRequest<Record<string, unknown>>({
        action_type: "select_data",
        prompt: "Reload triage queue after seeding",
        data_payload: { table: CASE_TABLE },
      });

      rows = extractRows(seeded).map(rowToInput);
    }

    const historyResult = await neuralRequest<Record<string, unknown>>({
      action_type: "select_data",
      prompt: "Load case history",
      data_payload: { table: HISTORY_TABLE },
    });

    const cases = attachHistory(rankCases(rows), extractRows(historyResult).map(toHistoryEntry));

    const signalResult = await neuralRequest<Record<string, unknown>>({
      action_type: "select_data",
      prompt: "Load learning signals",
      data_payload: { table: SIGNAL_TABLE },
    });

    const memory = deriveMemory(
      extractRows(signalResult).map((row) => ({
        id: String(row.id ?? randomUUID()),
        caseId: String(row.case_id ?? ""),
        outcome: String(row.outcome ?? ""),
        note: String(row.note ?? ""),
        patternId: String(row.pattern_id ?? "routine-check-in"),
        createdAt: String(row.created_at ?? new Date().toISOString()),
      })),
    );

    return {
      mode: "pulse",
      cases,
      summary: summarize(cases),
      memory,
    };
  } catch {
    const cases = attachHistory(rankCases(seedCases), mockHistory());
    return {
      mode: "mock",
      cases,
      summary: summarize(cases),
      memory: deriveMemory(mockSignals),
    };
  }
}

export async function recordFeedback(input: {
  caseId: string;
  outcome: string;
  note: string;
  patternId: string;
}): Promise<void> {
  const historyEntry = {
    id: randomUUID(),
    caseId: input.caseId,
    kind: "feedback" as CaseHistoryKind,
    title: input.outcome,
    detail: input.note || input.outcome,
    createdAt: new Date().toISOString(),
  };

  if (!pulseConfigured()) {
    mockSignals.unshift({
      id: randomUUID(),
      caseId: input.caseId,
      outcome: input.outcome,
      note: input.note,
      patternId: input.patternId,
      createdAt: new Date().toISOString(),
    });
    pushMockHistory(historyEntry);
    return;
  }

  try {
    await ensureSchema();
    await neuralRequest({
      action_type: "insert_data",
      prompt: "Store triage learning signal",
      data_payload: {
        table: SIGNAL_TABLE,
        record: {
          id: randomUUID(),
          case_id: input.caseId,
          outcome: input.outcome,
          note: input.note,
          pattern_id: input.patternId,
          created_at: new Date().toISOString(),
        },
      },
    });
    await neuralRequest({
      action_type: "insert_data",
      prompt: "Store triage history entry",
      data_payload: {
        table: HISTORY_TABLE,
        record: {
          id: historyEntry.id,
          case_id: historyEntry.caseId,
          kind: historyEntry.kind,
          title: historyEntry.title,
          detail: historyEntry.detail,
          created_at: historyEntry.createdAt,
        },
      },
    });
  } catch {
    mockSignals.unshift({
      id: randomUUID(),
      caseId: input.caseId,
      outcome: input.outcome,
      note: input.note,
      patternId: input.patternId,
      createdAt: new Date().toISOString(),
    });
    pushMockHistory(historyEntry);
  }
}

export async function recordCaseHistory(input: {
  caseId: string;
  kind: CaseHistoryKind;
  title: string;
  detail: string;
  createdAt?: string;
}): Promise<void> {
  const historyEntry: CaseHistoryEntry = {
    id: randomUUID(),
    caseId: input.caseId,
    kind: input.kind,
    title: input.title,
    detail: input.detail,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };

  if (!pulseConfigured()) {
    pushMockHistory(historyEntry);
    return;
  }

  try {
    await ensureSchema();
    await neuralRequest({
      action_type: "insert_data",
      prompt: "Store case history entry",
      data_payload: {
        table: HISTORY_TABLE,
        record: {
          id: historyEntry.id,
          case_id: historyEntry.caseId,
          kind: historyEntry.kind,
          title: historyEntry.title,
          detail: historyEntry.detail,
          created_at: historyEntry.createdAt,
        },
      },
    });
  } catch {
    pushMockHistory(historyEntry);
  }
}

function buildNavigatorPrompt(params: {
  caseData?: QueueCase | null;
  patientContext?: string;
  userMessage: string;
}): string {
  const lines = [
    "You are CareQueue AI, a triage navigator for a care team.",
    "Use the current case history and context to answer clearly and concisely.",
    "Do not diagnose. Focus on safety, next steps, and what to verify.",
    "",
  ];

  if (params.caseData) {
    const c = params.caseData;
    lines.push(`Case: ${c.name} | ${c.age} ${c.gender}`);
    lines.push(`Conditions: ${c.conditions}`);
    lines.push(`Meds: ${c.medications}`);
    lines.push(
      `Vitals: ${c.latestVitals ? `${c.latestVitals.heartRate} bpm, ${c.latestVitals.systolic}/${c.latestVitals.diastolic}, SpO2 ${c.latestVitals.spo2}%, Temp ${c.latestVitals.temperature}F` : "none"}`,
    );
    lines.push(`Score: ${c.score} (${c.tier})`);
    lines.push(`Next step: ${c.nextStep}`);
    if (c.history.length > 0) {
      lines.push("History:");
      for (const item of c.history.slice(0, 6)) {
        lines.push(`- ${item.kind}: ${item.title} — ${item.detail}`);
      }
    }
  } else if (params.patientContext) {
    lines.push(params.patientContext);
  }

  lines.push("");
  lines.push(`User question: ${params.userMessage}`);
  lines.push("Return a short triage answer with bullets if useful.");

  return lines.join("\n");
}

function fallbackNavigatorReply(params: {
  caseData?: QueueCase | null;
  userMessage: string;
}): string {
  const name = params.caseData?.name ?? "the selected case";
  const nextStep = params.caseData?.nextStep ?? "review the case manually";
  return [
    `Pulse is unavailable, so here is the local fallback for ${name}.`,
    `Next step: ${nextStep}.`,
    `Question received: ${params.userMessage}`,
  ].join(" ");
}

export async function runPulseChat(prompt: string): Promise<{ content: string; source: "pulse" | "mock" }> {
  if (!pulseConfigured()) {
    return { content: "Pulse is unavailable right now.", source: "mock" };
  }

  try {
    const result = await neuralRequest<{ response?: string }>({
      action_type: "chat",
      prompt,
    });
    return {
      content: String(result.response ?? "").trim() || "Pulse returned an empty response.",
      source: "pulse",
    };
  } catch {
    return { content: "Pulse is unavailable right now.", source: "mock" };
  }
}

export async function getNavigatorReply(params: {
  caseData?: QueueCase | null;
  patientContext?: string;
  userMessage: string;
}): Promise<{ content: string; source: "pulse" | "mock" }> {
  if (!pulseConfigured()) {
    const content = fallbackNavigatorReply(params);
    if (params.caseData) {
      await recordCaseHistory({
        caseId: params.caseData.id,
        kind: "navigator",
        title: "Navigator reply (fallback)",
        detail: content,
      });
    }
    return { content, source: "mock" };
  }

  const prompt = buildNavigatorPrompt(params);

  try {
    const result = await runPulseChat(prompt);
    const content = result.source === "pulse" ? result.content : fallbackNavigatorReply(params);
    if (params.caseData) {
      await recordCaseHistory({
        caseId: params.caseData.id,
        kind: "navigator",
        title: "Navigator reply",
        detail: content,
      });
    }
    return { content, source: result.source };
  } catch {
    const content = fallbackNavigatorReply(params);
    if (params.caseData) {
      await recordCaseHistory({
        caseId: params.caseData.id,
        kind: "navigator",
        title: "Navigator reply (fallback)",
        detail: content,
      });
    }
    return { content, source: "mock" };
  }
}
