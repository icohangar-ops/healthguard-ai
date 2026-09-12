export interface TriageVitals {
  heartRate: number;
  systolic: number;
  diastolic: number;
  temperature: number;
  spo2: number;
}

export interface TriageInput {
  id: string;
  name: string;
  age: number;
  gender: string;
  conditions: string;
  medications: string;
  latestVitals: TriageVitals | null;
  activeAlertCount: number;
  hasCriticalAlert: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type TriageTier = "critical" | "urgent" | "watch" | "routine";

export interface TriageCase extends TriageInput {
  score: number;
  tier: TriageTier;
  reasons: string[];
  nextStep: string;
  patternId: string;
  summary: string;
}

function tierForScore(score: number): TriageTier {
  if (score >= 75) return "critical";
  if (score >= 50) return "urgent";
  if (score >= 30) return "watch";
  return "routine";
}

function conditionsText(value: string): string {
  return value.toLowerCase();
}

export function scoreCase(input: TriageInput): TriageCase {
  const reasons: string[] = [];
  let score = 10;
  const conditions = conditionsText(input.conditions);

  if (input.hasCriticalAlert) {
    score += 35;
    reasons.push("critical alert already active");
  }

  if (input.activeAlertCount >= 3) {
    score += 15;
    reasons.push("multiple open alerts");
  } else if (input.activeAlertCount > 0) {
    score += 8;
    reasons.push("active alert backlog");
  }

  if (input.age >= 75) {
    score += 10;
    reasons.push("older adult patient");
  } else if (input.age >= 65) {
    score += 6;
    reasons.push("age elevates risk");
  }

  if (input.latestVitals) {
    const { heartRate, systolic, diastolic, temperature, spo2 } = input.latestVitals;

    if (spo2 < 92) {
      score += 25;
      reasons.push(`SpO2 ${spo2}% is below safe range`);
    } else if (spo2 < 95) {
      score += 12;
      reasons.push(`SpO2 ${spo2}% needs monitoring`);
    }

    if (systolic >= 160 || diastolic >= 100) {
      score += 22;
      reasons.push(`BP ${systolic}/${diastolic} is severe`);
    } else if (systolic >= 140 || diastolic >= 90) {
      score += 12;
      reasons.push(`BP ${systolic}/${diastolic} is elevated`);
    }

    if (heartRate >= 120 || heartRate <= 45) {
      score += 16;
      reasons.push(`heart rate ${heartRate} is unstable`);
    } else if (heartRate >= 110 || heartRate <= 55) {
      score += 8;
      reasons.push(`heart rate ${heartRate} needs review`);
    }

    if (temperature >= 101) {
      score += 8;
      reasons.push(`temperature ${temperature}F suggests fever`);
    }
  }

  if (conditions.includes("copd") || conditions.includes("asthma")) {
    score += 8;
    reasons.push("respiratory history raises concern");
  }

  if (conditions.includes("cad") || conditions.includes("heart failure") || conditions.includes("afib")) {
    score += 8;
    reasons.push("cardiac history raises concern");
  }

  if (conditions.includes("diabetes") || conditions.includes("pregnancy") || conditions.includes("immunocompromised")) {
    score += 5;
    reasons.push("comorbidity increases follow-up risk");
  }

  const tier = tierForScore(score);
  const nextStep =
    tier === "critical"
      ? "Escalate to clinician now and hold the queue"
      : tier === "urgent"
        ? "Route to same-day clinician review"
        : tier === "watch"
          ? "Schedule a callback and verify symptoms"
          : "Keep on routine follow-up and monitor trends";

  const patternId =
    input.hasCriticalAlert || (input.latestVitals && input.latestVitals.spo2 < 92)
      ? "respiratory-escalation"
      : conditions.includes("bp") || (input.latestVitals && input.latestVitals.systolic >= 140)
        ? "bp-followup"
        : conditions.includes("diabetes")
          ? "metabolic-watch"
          : "routine-check-in";

  const summary = `${input.name} scored ${score}/100 (${tier}). ${nextStep}.`;

  return {
    ...input,
    score,
    tier,
    reasons,
    nextStep,
    patternId,
    summary,
  };
}

export function rankCases(cases: TriageInput[]): TriageCase[] {
  return cases.map(scoreCase).sort((a, b) => b.score - a.score);
}
