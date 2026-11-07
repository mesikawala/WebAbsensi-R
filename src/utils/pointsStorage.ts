import { turso, initDatabase } from './tursoClient';
import fs from 'node:fs';
import path from 'node:path';

const pointsPath = path.resolve('src/data/pointDeductions.json');

export interface PointDeduction {
  id: string;
  studentId: string;
  rfidUid: string;
  date: string;
  time: string;
  minutesLate: number;
  pointsDeducted: number;
  reason: string;
  remainingPoints?: number;
}

/**
 * Hitung pengurangan poin secara akurat berdasarkan menit keterlambatan sesi pagi (ide.txt)
 */
export function calculatePointDeduction(minutesLate: number): { pointsDeducted: number; reason: string } {
  if (minutesLate <= 0) {
    return { pointsDeducted: 0, reason: 'Tepat Waktu (Tidak Ada Pengurangan)' };
  }
  if (minutesLate >= 1 && minutesLate <= 5) {
    return { pointsDeducted: 2, reason: `Terlambat ${minutesLate} menit pada sesi pagi (Kategori 1 - 5 menit: -2 Poin)` };
  }
  if (minutesLate > 5 && minutesLate < 10) {
    return { pointsDeducted: 3, reason: `Terlambat ${minutesLate} menit pada sesi pagi (Kategori 6 - 9 menit: -3 Poin)` };
  }
  if (minutesLate >= 10 && minutesLate <= 20) {
    return { pointsDeducted: 5, reason: `Terlambat ${minutesLate} menit pada sesi pagi (Kategori 10 - 20 menit: -5 Poin)` };
  }
  if (minutesLate > 20 && minutesLate <= 30) {
    return { pointsDeducted: 30, reason: `Terlambat ${minutesLate} menit pada sesi pagi (Kategori 20 - 30 menit: -30 Poin)` };
  }
  return { pointsDeducted: 40, reason: `Terlambat berat ${minutesLate} menit pada sesi pagi (> 30 menit: -40 Poin)` };
}

/**
 * Ambil tanggal awal minggu berjalan (Senin jam 00:00:00 WIB)
 */
export function getStartOfCurrentWeekDate(): string {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Minggu, 1 = Senin, dst.
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  return monday.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

/**
 * Reset otomatis mingguan: Hapus catatan riwayat sebelum minggu berjalan
 * agar riwayat bersih dan tidak memenuhi local storage / database
 */
export async function pruneOldPointDeductions(): Promise<void> {
  await initDatabase();
  const startOfWeek = getStartOfCurrentWeekDate();
  try {
    await turso.execute({
      sql: 'DELETE FROM point_deductions WHERE date < ?;',
      args: [startOfWeek],
    });
  } catch (err) {
    console.error('pruneOldPointDeductions error:', err);
  }
}

export async function getPointDeductions(studentId?: string, rfidUid?: string): Promise<PointDeduction[]> {
  await initDatabase();
  // Catatan: Poin kedisiplinan TIDAK reset otomatis berkala, hanya direset manual oleh Admin (Kepsek / Waka Kesiswaan)
  try {
    let sql = 'SELECT * FROM point_deductions ORDER BY date DESC, time DESC;';
    let args: any[] = [];

    const cleanSid = (studentId || '').trim();
    const cleanRfid = (rfidUid || '').trim().replace(/\s+/g, '');

    if (cleanSid && cleanRfid) {
      sql = 'SELECT * FROM point_deductions WHERE UPPER(student_id) = UPPER(?) OR UPPER(rfid_uid) = UPPER(?) ORDER BY date DESC, time DESC;';
      args = [cleanSid, cleanRfid];
    } else if (cleanSid) {
      sql = 'SELECT * FROM point_deductions WHERE UPPER(student_id) = UPPER(?) ORDER BY date DESC, time DESC;';
      args = [cleanSid];
    } else if (cleanRfid) {
      sql = 'SELECT * FROM point_deductions WHERE UPPER(rfid_uid) = UPPER(?) ORDER BY date DESC, time DESC;';
      args = [cleanRfid];
    }

    const res = await turso.execute({ sql, args });
    return res.rows.map((r: any) => ({
      id: String(r.id),
      studentId: String(r.student_id),
      rfidUid: String(r.rfid_uid),
      date: String(r.date),
      time: String(r.time),
      minutesLate: Number(r.minutes_late),
      pointsDeducted: Number(r.points_deducted),
      reason: String(r.reason),
    }));
  } catch (err) {
    console.error('Turso getPointDeductions error, fallback local JSON:', err);
    try {
      if (!fs.existsSync(pointsPath)) return [];
      const all: PointDeduction[] = JSON.parse(fs.readFileSync(pointsPath, 'utf-8'));
      const cleanSid = (studentId || '').trim().toUpperCase();
      const cleanRfid = (rfidUid || '').trim().toUpperCase().replace(/\s+/g, '');

      if (cleanSid && cleanRfid) {
        return all.filter((p) => (p.studentId && p.studentId.toUpperCase() === cleanSid) || (p.rfidUid && p.rfidUid.toUpperCase() === cleanRfid));
      } else if (cleanSid) {
        return all.filter((p) => p.studentId && p.studentId.toUpperCase() === cleanSid);
      } else if (cleanRfid) {
        return all.filter((p) => p.rfidUid && p.rfidUid.toUpperCase() === cleanRfid);
      }
      return all;
    } catch {
      return [];
    }
  }
}

export async function savePointDeduction(deduction: PointDeduction): Promise<void> {
  await initDatabase();
  try {
    await turso.execute({
      sql: `
        INSERT OR REPLACE INTO point_deductions (id, student_id, rfid_uid, date, time, minutes_late, points_deducted, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?);
      `,
      args: [
        deduction.id,
        deduction.studentId,
        deduction.rfidUid,
        deduction.date,
        deduction.time,
        deduction.minutesLate,
        deduction.pointsDeducted,
        deduction.reason,
      ],
    });
  } catch (err) {
    console.error('Turso savePointDeduction error:', err);
  }
}

export async function getStudentPointSummary(studentId: string, rfidUid: string): Promise<{
  totalPoints: number;
  status: 'aman' | 'peringatan' | 'diblokir';
  statusLabel: string;
  totalDeducted: number;
  deductions: PointDeduction[];
}> {
  const deductions = await getPointDeductions(studentId, rfidUid);
  const totalDeducted = deductions.reduce((acc, curr) => acc + curr.pointsDeducted, 0);
  const totalPoints = Math.max(0, 100 - totalDeducted);

  let status: 'aman' | 'peringatan' | 'diblokir' = 'aman';
  let statusLabel = 'Disiplin & Aman';

  if (totalPoints === 0) {
    status = 'diblokir';
    statusLabel = 'Terkunci / Diblokir (Poin 0)';
  } else if (totalPoints < 10) {
    status = 'peringatan';
    statusLabel = 'Peringatan! Poin Kritis (< 10)';
  }

  // Tambahkan akumulasi remainingPoints di tiap record
  let currentAccum = 100;
  const enriched = [...deductions].reverse().map((d) => {
    currentAccum = Math.max(0, currentAccum - d.pointsDeducted);
    return { ...d, remainingPoints: currentAccum };
  }).reverse();

  return {
    totalPoints,
    status,
    statusLabel,
    totalDeducted,
    deductions: enriched,
  };
}

export async function resetStudentPoints(studentId: string, rfidUid?: string): Promise<void> {
  await initDatabase();
  const cleanSid = (studentId || '').trim();
  const cleanRfid = (rfidUid || '').trim().replace(/\s+/g, '');
  try {
    if (cleanSid || cleanRfid) {
      await turso.execute({
        sql: 'DELETE FROM point_deductions WHERE UPPER(student_id) = UPPER(?) OR UPPER(rfid_uid) = UPPER(?);',
        args: [cleanSid, cleanRfid],
      });
    } else {
      await turso.execute('DELETE FROM point_deductions;');
    }
  } catch (err) {
    console.error('Turso resetStudentPoints error:', err);
  }
}
