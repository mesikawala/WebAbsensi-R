export const prerender = false;
import type { APIRoute } from 'astro';
import { checkAndApplyBolos, getLogs, getStudents } from '../../../utils/attendanceStorage';

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const dateStr = url.searchParams.get('date') || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

    const allLogs = await getLogs();
    const dateLogs = allLogs.filter((l) => l.date === dateStr && l.role === 'siswa');
    const students = await getStudents();

    const morningMap = new Map<string, any>();
    const afternoonSet = new Set<string>();
    const bolosSet = new Set<string>();

    dateLogs.forEach((l) => {
      const u = l.rfidUid.toUpperCase();
      if (l.type === 'masuk') morningMap.set(u, l);
      if (l.type === 'pulang') {
        afternoonSet.add(u);
        if (l.status === 'Bolos') bolosSet.add(u);
      }
    });

    // Siswa yang berpotensi bolos (hadir pagi tapi belum pulang)
    const pendingBolos: any[] = [];
    const confirmedBolos: any[] = [];

    students.forEach((s) => {
      if (s.role === 'siswa') {
        const u = s.rfidUid.toUpperCase();
        if (morningMap.has(u)) {
          if (bolosSet.has(u)) {
            confirmedBolos.push({ student: s, masukLog: morningMap.get(u), status: 'Sudah Dihukum Bolos (-10 Poin)' });
          } else if (!afternoonSet.has(u)) {
            pendingBolos.push({ student: s, masukLog: morningMap.get(u), status: 'Belum Presensi Pulang' });
          }
        }
      }
    });

    return new Response(JSON.stringify({
      status: 'success',
      date: dateStr,
      pendingCount: pendingBolos.length,
      confirmedCount: confirmedBolos.length,
      pendingBolos,
      confirmedBolos,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ status: 'error', message: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const dateStr = body.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const studentId = body.studentId || '';

    const result = await checkAndApplyBolos(dateStr, studentId);
    return new Response(JSON.stringify({
      status: 'success',
      message: studentId
        ? `Siswa ${result.penalizedStudents[0]?.name || studentId} berhasil ditindaklanjuti dan dipotong 10 poin disiplin.`
        : `Evaluasi bolos selesai: ${result.bolosCount} siswa dikategorikan bolos dan dipotong 10 poin.`,
      data: result,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ status: 'error', message: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
