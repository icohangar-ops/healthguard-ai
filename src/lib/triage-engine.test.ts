import { describe, expect, it } from "vitest";
import { rankCases, scoreCase } from "@/lib/triage-engine";

describe("triage engine", () => {
  it("scores respiratory instability above routine cases", () => {
    const critical = scoreCase({
      id: "case-1",
      name: "Test Patient",
      age: 74,
      gender: "Female",
      conditions: "COPD, CHF",
      medications: "Inhaler",
      latestVitals: { heartRate: 118, systolic: 132, diastolic: 84, temperature: 99.4, spo2: 88 },
      activeAlertCount: 4,
      hasCriticalAlert: true,
    });

    const routine = scoreCase({
      id: "case-2",
      name: "Stable Patient",
      age: 38,
      gender: "Male",
      conditions: "Seasonal allergies",
      medications: "Antihistamine",
      latestVitals: { heartRate: 72, systolic: 118, diastolic: 76, temperature: 98.4, spo2: 98 },
      activeAlertCount: 0,
      hasCriticalAlert: false,
    });

    expect(critical.score).toBeGreaterThan(routine.score);
    expect(critical.tier).toBe("critical");
    expect(routine.tier).toBe("routine");
  });

  it("sorts cases by score", () => {
    const ranked = rankCases([
      {
        id: "case-a",
        name: "A",
        age: 40,
        gender: "Male",
        conditions: "None",
        medications: "None",
        latestVitals: { heartRate: 70, systolic: 118, diastolic: 76, temperature: 98.4, spo2: 98 },
        activeAlertCount: 0,
        hasCriticalAlert: false,
      },
      {
        id: "case-b",
        name: "B",
        age: 78,
        gender: "Female",
        conditions: "COPD",
        medications: "Inhaler",
        latestVitals: { heartRate: 112, systolic: 142, diastolic: 92, temperature: 99.7, spo2: 90 },
        activeAlertCount: 3,
        hasCriticalAlert: true,
      },
    ]);

    expect(ranked[0].id).toBe("case-b");
  });
});
