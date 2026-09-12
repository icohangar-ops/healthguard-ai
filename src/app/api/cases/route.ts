import { NextResponse } from "next/server";
import { getCareQueueSnapshot } from "@/lib/pulse";

export async function GET() {
  try {
    const snapshot = await getCareQueueSnapshot();
    return NextResponse.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load care queue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
