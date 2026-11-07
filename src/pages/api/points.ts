export const prerender = false;
import type { APIRoute } from 'astro';
import { getStudentPointSummary, getPointDeductions, savePointDeduction, resetStudentPoints, type PointDeduction } from '../../utils/pointsStorage';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const studentId = url.searchParams.get('studentId') || url.searchParams.get('id') || '';
  const rfidUid = url.searchParams.get('rfid') || url.searchParams.get('uid') || '';

  // Jika dipanggil dengan ID tertentu
  if (studentId || rfidUid) {
    const summary = await getStudentPointSummary(studentId, rfidUid);
    return new Response(JSON.stringify(summary), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Jika dipanggil tanpa ID, kembalikan semua log pengurangan poin
  const allDeductions = await getPointDeductions();
  return new Response(JSON.stringify(allDeductions), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    if (!body.studentId || !body.rfidUid) {
      return new Response(JSON.stringify({ status: 'error', message: 'studentId dan rfidUid wajib dikirim' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const deduction: PointDeduction = {
      id: body.id || `DED-${Date.now()}`,
      studentId: body.studentId,
      rfidUid: body.rfidUid,
      date: body.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }),
      time: body.time || '07:15:00',
      minutesLate: Number(body.minutesLate) || 5,
      pointsDeducted: Number(body.pointsDeducted) || 2,
      reason: body.reason || 'Terlambat sesi pagi gerbang',
    };

    await savePointDeduction(deduction);
    return new Response(JSON.stringify({ status: 'success', data: deduction }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ status: 'error', message: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const studentId = url.searchParams.get('studentId') || url.searchParams.get('id') || '';
    const rfidUid = url.searchParams.get('rfid') || url.searchParams.get('uid') || '';

    await resetStudentPoints(studentId, rfidUid);
    return new Response(JSON.stringify({ status: 'success', message: 'Poin berhasil direset ke 100 poin default.' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ status: 'error', message: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
