import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    name: "CareQueue AI",
    status: "ok",
    stateLayer: "Pulse Evorozen",
  });
}
