import { NextResponse } from "next/server";
import { getNavigatorReply, type QueueCase } from "@/lib/pulse";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      messages?: ChatMessage[];
      patientContext?: string;
      caseData?: QueueCase;
    };

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const userMessage = [...messages].reverse().find((message) => message.role === "user")?.content?.trim();

    if (!userMessage) {
      return NextResponse.json({ error: "Messages are required" }, { status: 400 });
    }

    const result = await getNavigatorReply({
      caseData: body.caseData,
      patientContext: body.patientContext,
      userMessage,
    });

    return NextResponse.json({
      role: "assistant",
      content: result.content,
      source: result.source,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Chat processing failed";
    return NextResponse.json({
      role: "assistant",
      content: `I am currently experiencing technical difficulties. Please review the selected case, verify the latest vitals, and escalate if the patient is unstable.\n\n*Error: ${errorMessage}*`,
      source: "mock",
    });
  }
}
