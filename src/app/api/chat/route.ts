import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ZAI, { type ChatMessage } from 'z-ai-web-dev-sdk';
import { retry, withTimeout } from '@/lib/resilience';
import { requirePatientAuth } from '@/lib/require-patient-auth';
// Shared with the Agora voice navigator so the safety rules only exist once.
import { SYSTEM_PROMPT, withPatientContext } from '@/lib/clinical-prompt';

const zai = await ZAI.create();

export async function POST(request: Request) {
  const unauthorized = requirePatientAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();
    const { messages, patientContext } = body as {
      messages: Array<{ role: ChatMessage['role']; content: string }>;
      patientContext?: string;
    };

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'Messages are required' }, { status: 400 });
    }

    const fullMessages: ChatMessage[] = [
      { role: 'system', content: withPatientContext(SYSTEM_PROMPT, patientContext) },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ];

    // Resilient model call: each attempt is bounded by a 20s timeout, with up
    // to 2 retries (3 attempts total) and exponential backoff + jitter on
    // transient failures. Exhausted/failed calls fall through to the graceful
    // fallback in the catch block below.
    const completion = await retry(
      () =>
        withTimeout(
          zai.chat.completions.create({
            messages: fullMessages,
            max_tokens: 1500,
          }),
          20_000,
          'gemini chat completion',
        ),
      { maxAttempts: 3 },
    );

    const assistantMessage = completion.choices[0]?.message?.content || 'I apologize, but I was unable to generate a response. Please try again.';

    return NextResponse.json({
      role: 'assistant',
      content: assistantMessage,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Chat processing failed';
    return NextResponse.json({
      role: 'assistant',
      content: `I'm currently experiencing technical difficulties. Here's what I recommend in the meantime:\n\n1. Review the patient's vitals trends in the dashboard\n2. Check for any active alerts that may need attention\n3. Consult with the care team directly\n\nPlease try again in a moment. If issues persist, contact technical support.\n\n*Error: ${errorMessage}*`,
    });
  }
}
