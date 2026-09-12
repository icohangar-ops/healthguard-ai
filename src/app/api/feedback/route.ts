import { NextResponse } from "next/server";
import { recordFeedback } from "@/lib/pulse";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      caseId?: string;
      outcome?: string;
      note?: string;
      patternId?: string;
    };

    if (!body.caseId || !body.outcome || !body.patternId) {
      return NextResponse.json({ error: "caseId, outcome, and patternId are required" }, { status: 400 });
    }

    await recordFeedback({
      caseId: body.caseId,
      outcome: body.outcome,
      note: body.note || "",
      patternId: body.patternId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record feedback";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
