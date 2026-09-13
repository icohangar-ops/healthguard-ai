import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePatientAuth } from '@/lib/require-patient-auth';

// GET /api/alerts — List alerts with optional filtering
export async function GET(request: Request) {
  const unauthorized = requirePatientAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const acknowledged = searchParams.get('acknowledged');

    const where: Record<string, unknown> = {};

    if (type) where.type = type;
    if (acknowledged !== null && acknowledged !== undefined && acknowledged !== '') {
      where.acknowledged = acknowledged === 'true';
    }

    const alerts = await db.alert.findMany({
      where,
      include: {
        patient: {
          select: { id: true, name: true },
        },
      },
      orderBy: [
        { severity: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return NextResponse.json(alerts);
  } catch (error) {
    console.error('Failed to fetch alerts:', error);
    return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 });
  }
}

// PATCH /api/alerts — Acknowledge an alert
export async function PATCH(request: Request) {
  const unauthorized = requirePatientAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();
    const { id, acknowledged } = body;

    if (!id) {
      return NextResponse.json({ error: 'Alert ID is required' }, { status: 400 });
    }

    const alert = await db.alert.update({
      where: { id },
      data: { acknowledged: acknowledged ?? true },
    });

    return NextResponse.json(alert);
  } catch (error) {
    console.error('Failed to update alert:', error);
    return NextResponse.json({ error: 'Failed to update alert' }, { status: 500 });
  }
}
