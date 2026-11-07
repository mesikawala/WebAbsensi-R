export const prerender = false;
import type { APIRoute } from 'astro';
import { getStudents, getLogs, saveLog, clearLogs, syncDailyAttendanceAndPermissions, type AttendanceLog } from '../../utils/attendanceStorage';
import { getSettings, timeToMinutes } from '../../utils/settingsStorage';
import { attendanceEmitter } from '../../utils/attendanceEvents';
import { getStudentPointSummary, calculatePointDeduction, savePointDeduction } from '../../utils/pointsStorage';

let lastCheckedDate = '';

export const GET: APIRoute = async () => {
  const todayWib = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  if (lastCheckedDate !== todayWib) {
    lastCheckedDate = todayWib;
    await syncDailyAttendanceAndPermissions().catch(() => {});
  }
  const logs = await getLogs();
  // Lindungi UID Admin agar tidak terekspos di log presensi frontend
  const safeLogs = logs.map((l) => {
    if (l.role === 'admin') {
      return { ...l, rfidUid: '' };
    }
    return l;
  });
  return new Response(JSON.stringify(safeLogs), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const DELETE: APIRoute = async () => {
  await clearLogs();
  attendanceEmitter.emit('attendance', { type: 'reset' });
  return new Response(JSON.stringify({ status: 'success', message: 'Log presensi berhasil direset' }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// Helper pemfilter UID: Mengekstrak UID Decimal 9 digit dari payload scanner/IoT
function extractDecimalUid(raw: any): string {
  if (!raw) return '';
  const text = String(raw).trim();
  if (text.toUpperCase().startsWith('ADM-') || /^(admin|piket)$/i.test(text)) return text.toUpperCase();
  const decMatch = text.match(/(?:UID\s*Decimal|Decimal|Dec)\s*[:=]?\s*([0-9]{8,12})/i);
  if (decMatch && decMatch[1]) return decMatch[1].trim();
  const digitsOnly = text.replace(/[^0-9]/g, '');
  if (digitsOnly.length >= 9) return digitsOnly.slice(0, 9);
  return digitsOnly || text;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const todayWib = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    if (lastCheckedDate !== todayWib) {
      lastCheckedDate = todayWib;
      await syncDailyAttendanceAndPermissions().catch(() => {});
    }

    const contentType = request.headers.get('content-type') || '';
    let body: any = {};
    let rawInput = '';

    if (contentType.includes('application/json')) {
      body = await request.json().catch(() => ({}));
      rawInput = body.uid || body.rfid || body.id || body.rfidUid || body.data || body.text || '';
      if (!rawInput && typeof body === 'string') rawInput = body;
    } else {
      const text = await request.text().catch(() => '');
      try {
        body = JSON.parse(text);
        rawInput = body.uid || body.rfid || body.id || body.rfidUid || body.data || text;
      } catch {
        rawInput = text;
      }
    }

    const uid = extractDecimalUid(rawInput);

    console.log('\n==================================================');
    console.log('📡 [PRESENSI API] Data Masuk dari Scanner / IoT:');
    console.log('--------------------------------------------------');
    console.log('Raw Data     : ' + (rawInput ? rawInput.replace(/\n\s*/g, ' | ') : '(kosong)'));
    console.log('Filter UID   : [' + uid + ']');
    console.log('==================================================');

    if (!uid) {
      return new Response(JSON.stringify({ status: 'error', message: 'ID/UID wajib dikirim' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Step 1: Cek apakah ID terdaftar
    const students = await getStudents();
    const student = students.find(
      (s) => s.rfidUid.toUpperCase() === uid || s.id.toUpperCase() === uid
    );
    if (!student) {
      console.log(`❌ [PRESENSI] UID [${uid}] BELUM TERDAFTAR di database.\n`);
      return new Response(
        JSON.stringify({ status: 'error', message: `ID/UID ${uid} belum terdaftar di sistem` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`✅ [PRESENSI] Siswa Terdeteksi: ${student.name} (${student.className})\n`);

    // Konfigurasi Jam Operasional Dinamis dari Turso
    const settings = await getSettings();
    const bukaMinutes = timeToMinutes(settings.jamBuka);
    const masukMinutes = timeToMinutes(settings.jamMasuk);
    const pulangMinutes = timeToMinutes(settings.jamPulang);

    // Waktu WIB & Support Simulasi Waktu
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const realTimeStr = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta' });
    const customTime = (body.simulatedTime || body.time || body.scanTime || '').trim();
    const timeStr = customTime ? (customTime.length === 5 ? `${customTime}:00` : customTime) : realTimeStr;

    const [hh, mm] = timeStr.split(':').map(Number);
    const totalMinutes = hh * 60 + mm;

    // Tentukan Sesi Presensi: Pagi (Masuk) atau Siang (Pulang)
    const validCustomType = body.type === 'masuk' || body.type === 'pulang' ? body.type : undefined;
    const session: 'masuk' | 'pulang' = validCustomType || (totalMinutes < Math.min(pulangMinutes, 12 * 60) ? 'masuk' : 'pulang');

    const isStaff = student.role === 'guru' || student.role === 'admin';

    // Step 2: Cek jadwal gerbang umum (05:00 WIB hingga 23:00 WIB)
    if (totalMinutes < 5 * 60 || totalMinutes > 23 * 60) {
      return new Response(
        JSON.stringify({ status: 'error', message: `Di luar jadwal operasional gerbang (05:00 - 23:00 WIB)` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Step 2b: Cek jadwal khusus siswa (tolak jika belum masuk jadwal pagi atau siang)
    if (!isStaff) {
      if (session === 'masuk' && totalMinutes < bukaMinutes) {
        return new Response(
          JSON.stringify({
            status: 'error',
            message: `Presensi masuk belum dibuka (Gerbang buka pukul ${settings.jamBuka} WIB)`,
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (session === 'pulang' && totalMinutes < pulangMinutes) {
        return new Response(
          JSON.stringify({
            status: 'error',
            message: `Presensi pulang belum dibuka (Kepulangan pukul ${settings.jamPulang} WIB)`,
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // Step 3: Cek Anti Double-Tap (Staff: hanya 1x sehari, Siswa: 1x per sesi)
    const logs = await getLogs();
    const existing = logs.find((l) => {
      const matchRfid = l.rfidUid.toUpperCase() === student.rfidUid.toUpperCase() && l.date === dateStr;
      if (!matchRfid) return false;
      if (isStaff) return true; // Guru & Admin hanya absen satu kali sehari
      return l.type === session;
    });

    if (existing) {
      return new Response(
        JSON.stringify({
          status: 'warning',
          message: isStaff
            ? `Staff/Pendidik (${student.name}) sudah melakukan presensi hari ini (jam ${existing.time} WIB)`
            : `${student.name} sudah absen ${session === 'masuk' ? 'masuk' : 'pulang'} hari ini (${existing.status} jam ${existing.time} WIB)`,
          data: existing,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Cek Poin Disiplin Siswa (ide.txt)
    let studentPoints = 100;
    if (!isStaff) {
      const pSum = await getStudentPointSummary(student.id, student.rfidUid);
      studentPoints = pSum.totalPoints;
      if (studentPoints <= 0) {
        return new Response(
          JSON.stringify({
            status: 'error',
            message: `Akses Ditolak: Poin siswa 0 (Terkunci). Silahkan temui Guru Piket atau Wakasis untuk persetujuan / reset poin.`,
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // Status: Staff tidak ada terlambat (selalu Hadir), siswa ada kalkulasi keterlambatan
    let status: 'Hadir' | 'Terlambat' | 'Pulang';
    let message: string;
    let deductionInfo: any = null;

    if (isStaff) {
      status = 'Hadir';
      message = `Presensi ${student.role === 'admin' ? 'Administrator' : 'Pendidik'} Berhasil (${student.name}) - Hadir Bertugas`;
    } else if (session === 'masuk') {
      const isLate = totalMinutes > masukMinutes;
      status = isLate ? 'Terlambat' : 'Hadir';

      if (isLate) {
        const minutesLate = totalMinutes - masukMinutes;
        const { pointsDeducted, reason } = calculatePointDeduction(minutesLate);
        if (pointsDeducted > 0) {
          const deductionRecord = {
            id: `DED-${Date.now()}`,
            studentId: student.id,
            rfidUid: student.rfidUid,
            date: dateStr,
            time: timeStr.slice(0, 8),
            minutesLate,
            pointsDeducted,
            reason,
          };
          await savePointDeduction(deductionRecord);
          studentPoints = Math.max(0, studentPoints - pointsDeducted);
          deductionInfo = deductionRecord;
        }

        message = `Presensi Masuk Terlambat (${student.name}) - Telat ${minutesLate} menit.`;
        if (studentPoints < 10) {
          message += ` ⚠️ Peringatan: Poin Anda sisa ${studentPoints} (kurang dari 10), silahkan temui guru terlebih dahulu!`;
        } else if (deductionInfo) {
          message += ` Poin berkurang -${deductionInfo.pointsDeducted} (Sisa ${studentPoints} Poin).`;
        }
      } else {
        message = `Presensi Masuk Tepat Waktu (${student.name})`;
      }
    } else {
      status = 'Pulang';
      message = `Presensi Pulang Berhasil (${student.name})`;
    }

    const newLog: AttendanceLog = {
      id: `ATT-${Date.now()}`,
      rfidUid: student.rfidUid,
      name: student.name,
      className: student.className,
      role: student.role,
      date: dateStr,
      time: timeStr.slice(0, 8),
      type: session,
      status,
    };

    await saveLog(newLog);

    const clientLog = student.role === 'admin' ? { ...newLog, rfidUid: '' } : newLog;
    attendanceEmitter.emit('attendance', { type: 'new_log', log: clientLog, deduction: deductionInfo, remainingPoints: studentPoints });

    return new Response(
      JSON.stringify({
        status: 'success',
        message,
        data: clientLog,
        points: studentPoints,
        deduction: deductionInfo,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ status: 'error', message: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
