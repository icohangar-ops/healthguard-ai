import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePatientAuth } from '@/lib/require-patient-auth';

// GET /api/dashboard — Dashboard stats
export async function GET(request: Request) {
  const unauthorized = requirePatientAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const totalPatients = await db.patient.count();

    const activeAlerts = await db.alert.groupBy({
      by: ['type'],
      where: { acknowledged: false },
      _count: { type: true },
    });

    const totalAlerts = await db.alert.count({ where: { acknowledged: false } });

    const acknowledgedAlerts = await db.alert.count({ where: { acknowledged: true } });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const vitalsToday = await db.vitalsReading.count({
      where: { recordedAt: { gte: todayStart } },
    });

    // Get latest vitals across all patients for summary
    const latestVitalsPerPatient = await db.vitalsReading.findMany({
      orderBy: { recordedAt: 'desc' },
      take: 20,
      include: {
        patient: {
          select: { id: true, name: true },
        },
      },
    });

    // Recent alerts (last 7 days)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const recentAlerts = await db.alert.findMany({
      where: { createdAt: { gte: weekAgo } },
      include: {
        patient: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Vitals summary: avg HR, avg BP across all readings
    const allVitals = await db.vitalsReading.findMany();
    const avgHeartRate = allVitals.length
      ? Math.round(allVitals.reduce((sum, v) => sum + v.heartRate, 0) / allVitals.length)
      : 0;
    const avgSystolic = allVitals.length
      ? Math.round(allVitals.reduce((sum, v) => sum + v.systolic, 0) / allVitals.length)
      : 0;
    const avgDiastolic = allVitals.length
      ? Math.round(allVitals.reduce((sum, v) => sum + v.diastolic, 0) / allVitals.length)
      : 0;
    const avgSpO2 = allVitals.length
      ? Math.round(allVitals.reduce((sum, v) => sum + v.spo2, 0) / allVitals.length)
      : 0;

    const severityBreakdown: Record<string, number> = {};
    for (const a of activeAlerts) {
      severityBreakdown[a.type] = a._count.type;
    }

    return NextResponse.json({
      totalPatients,
      totalActiveAlerts: totalAlerts,
      totalAcknowledgedAlerts: acknowledgedAlerts,
      vitalsReviewedToday: vitalsToday,
      severityBreakdown,
      latestVitals: latestVitalsPerPatient,
      recentAlerts,
      averages: {
        heartRate: avgHeartRate,
        systolic: avgSystolic,
        diastolic: avgDiastolic,
        spo2: avgSpO2,
      },
    });
  } catch (error) {
    console.error('Failed to fetch dashboard data:', error);
    return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 });
  }
}
