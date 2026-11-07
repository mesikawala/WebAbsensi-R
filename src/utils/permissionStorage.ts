import { turso, initDatabase } from './tursoClient';
import fs from 'node:fs';
import path from 'node:path';

const permissionsPath = path.resolve('src/data/permissions.json');

export interface Permission {
  id: string;
  studentId: string;
  name: string;
  className: string;
  category: 'sakit' | 'dispensasi' | 'keluarga';
  categoryLabel: string;
  title: string;
  startDate: string;
  endDate: string;
  daysCount: number;
  status: 'Menunggu' | 'Disetujui' | 'Ditolak' | 'Selesai';
  attachmentNote: string;
  jurusan?: string;
  photoProof?: string;
  approvedBy?: string;
  approvedAt?: string;
}

export async function getPermissions(): Promise<Permission[]> {
  await initDatabase();
  try {
    const res = await turso.execute('SELECT * FROM permissions ORDER BY start_date DESC;');
    return res.rows.map((r: any) => ({
      id: String(r.id),
      studentId: String(r.student_id),
      name: String(r.name),
      className: String(r.class_name),
      category: r.category as 'sakit' | 'dispensasi' | 'keluarga',
      categoryLabel: String(r.category_label || ''),
      title: String(r.title),
      startDate: String(r.start_date),
      endDate: String(r.end_date),
      daysCount: Number(r.days_count) || 1,
      status: r.status as 'Menunggu' | 'Disetujui' | 'Ditolak' | 'Selesai',
      attachmentNote: String(r.attachment_note || ''),
      jurusan: String(r.jurusan || ''),
      photoProof: String(r.photo_proof || ''),
      approvedBy: String(r.approved_by || ''),
      approvedAt: String(r.approved_at || ''),
    }));
  } catch (err) {
    console.error('Turso getPermissions error, fallback ke local JSON:', err);
    try {
      if (fs.existsSync(permissionsPath)) {
        return JSON.parse(fs.readFileSync(permissionsPath, 'utf-8'));
      }
      return [];
    } catch {
      return [];
    }
  }
}

export async function savePermission(data: Omit<Permission, 'id'>): Promise<Permission> {
  await initDatabase();
  const id = `PRM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const newPerm: Permission = { ...data, id };

  try {
    await turso.execute({
      sql: `INSERT INTO permissions (id, student_id, name, class_name, category, category_label, title, start_date, end_date, days_count, status, attachment_note, jurusan, photo_proof) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      args: [
        newPerm.id,
        newPerm.studentId,
        newPerm.name,
        newPerm.className,
        newPerm.category,
        newPerm.categoryLabel,
        newPerm.title,
        newPerm.startDate,
        newPerm.endDate,
        newPerm.daysCount,
        newPerm.status,
        newPerm.attachmentNote,
        newPerm.jurusan || '',
        newPerm.photoProof || '',
      ],
    });

    let list: Permission[] = [];
    try {
      if (fs.existsSync(permissionsPath)) {
        list = JSON.parse(fs.readFileSync(permissionsPath, 'utf-8'));
      }
    } catch {}
    const existIdx = list.findIndex((p) => p.id === id);
    if (existIdx >= 0) {
      list[existIdx] = newPerm;
    } else {
      list.push(newPerm);
    }
    fs.writeFileSync(permissionsPath, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('Turso savePermission error:', err);
  }

  return newPerm;
}

export async function updatePermission(id: string, data: Partial<Permission>): Promise<Permission | null> {
  await initDatabase();
  try {
    const existing = (await getPermissions()).find((p) => p.id === id);
    if (!existing) return null;

    const merged: Permission = { ...existing };
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) {
        (merged as any)[k] = v;
      }
    }

    await turso.execute({
      sql: `
        UPDATE permissions SET
          category = ?,
          category_label = ?,
          title = ?,
          start_date = ?,
          end_date = ?,
          days_count = ?,
          attachment_note = ?,
          jurusan = ?,
          photo_proof = ?
        WHERE id = ?;
      `,
      args: [
        merged.category ?? '',
        merged.categoryLabel ?? '',
        merged.title ?? '',
        merged.startDate ?? '',
        merged.endDate ?? '',
        merged.daysCount ?? 1,
        merged.attachmentNote ?? '',
        merged.jurusan ?? '',
        merged.photoProof ?? '',
        id,
      ],
    });

    return merged;
  } catch (err) {
    console.error('Turso updatePermission error:', err);
    return null;
  }
}

export async function deletePermission(id: string): Promise<boolean> {
  await initDatabase();
  try {
    const res = await turso.execute({
      sql: 'DELETE FROM permissions WHERE id = ?;',
      args: [id],
    });
    return res.rowsAffected > 0;
  } catch (err) {
    console.error('Turso deletePermission error:', err);
    return false;
  }
}

export async function updatePermissionStatus(
  id: string,
  status: 'Menunggu' | 'Disetujui' | 'Ditolak' | 'Selesai',
  approvedBy?: string
): Promise<Permission | null> {
  await initDatabase();
  const approvedAt = new Date().toISOString();
  try {
    if (approvedBy !== undefined && approvedBy !== '') {
      await turso.execute({
        sql: 'UPDATE permissions SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?;',
        args: [status, approvedBy, approvedAt, id],
      });
    } else {
      await turso.execute({
        sql: 'UPDATE permissions SET status = ? WHERE id = ?;',
        args: [status, id],
      });
    }

    const res = await turso.execute({
      sql: 'SELECT * FROM permissions WHERE id = ?;',
      args: [id],
    });
    if (!res.rows.length) return null;
    const r: any = res.rows[0];

    return {
      id: String(r.id),
      studentId: String(r.student_id),
      name: String(r.name),
      className: String(r.class_name),
      category: r.category as 'sakit' | 'dispensasi' | 'keluarga',
      categoryLabel: String(r.category_label || ''),
      title: String(r.title),
      startDate: String(r.start_date),
      endDate: String(r.end_date),
      daysCount: Number(r.days_count) || 1,
      status: r.status as 'Menunggu' | 'Disetujui' | 'Ditolak' | 'Selesai',
      attachmentNote: String(r.attachment_note || ''),
      jurusan: String(r.jurusan || ''),
      photoProof: String(r.photo_proof || ''),
      approvedBy: String(r.approved_by || ''),
      approvedAt: String(r.approved_at || ''),
    };
  } catch (err) {
    console.error('Turso updatePermissionStatus error:', err);
    return null;
  }
}

/**
 * Otomatis membersihkan data foto bukti surat izin (photo_proof) yang umurnya sudah melebihi 7 hari (1 minggu).
 * Menjaga ukuran database tetap ringan dan hemat memori, sementara rekaman teks status izin tetap tersimpan.
 */
export async function cleanExpiredProofPhotos(days = 7): Promise<{ cleanedCount: number }> {
  await initDatabase();
  const now = new Date();
  const thresholdDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

  try {
    const res = await turso.execute({
      sql: `UPDATE permissions SET photo_proof = '' WHERE start_date < ? AND photo_proof != '' AND photo_proof IS NOT NULL;`,
      args: [thresholdDate],
    });

    return { cleanedCount: res.rowsAffected };
  } catch (err) {
    console.error('cleanExpiredProofPhotos error:', err);
    return { cleanedCount: 0 };
  }
}

/**
 * Otomatis mengarsipkan izin yang tanggal selesainya sudah lampau (endDate < todayStr).
 * Status permohonan diubah menjadi 'Selesai'.
 * Sekaligus membersihkan foto bukti lampau yang berumur lebih dari 7 hari.
 */
export async function archiveExpiredPermissions(todayDate?: string): Promise<{
  archivedCount: number;
  expiredPerms: Permission[];
}> {
  await initDatabase();
  const todayStr = todayDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  await cleanExpiredProofPhotos(7).catch(() => {});
  const permissions = await getPermissions();

  const expired = permissions.filter((p) => p.status === 'Disetujui' && (p.endDate || p.startDate) < todayStr);
  const expiredPerms: Permission[] = [];

  for (const perm of expired) {
    try {
      await turso.execute({
        sql: `UPDATE permissions SET status = 'Selesai' WHERE id = ?;`,
        args: [perm.id],
      });
      perm.status = 'Selesai';
      expiredPerms.push(perm);
    } catch (err) {
      console.error(`Gagal mengarsipkan izin ${perm.id}:`, err);
    }
  }

  return { archivedCount: expiredPerms.length, expiredPerms };
}

export async function isStudentOnPermitToday(studentId: string, targetDate?: string): Promise<Permission | undefined> {
  const date = targetDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const permissions = await getPermissions();
  return permissions.find(
    (p) => p.studentId === studentId && p.status === 'Disetujui' && p.startDate <= date && p.endDate >= date
  );
}

export async function clearPermissions(): Promise<void> {
  await initDatabase();
  try {
    await turso.execute('DELETE FROM permissions;');
  } catch (err) {
    console.error('Turso clearPermissions error:', err);
  }
}

/**
 * Pembersihan Total Terfilter:
 * 1. Menghapus total (permanen) berkas yang 'Ditolak'.
 * 2. Menghapus total (permanen) permohonan 'Menunggu' yang masa pengajuannya sudah lewat (endDate < todayWib) alias Kadaluarsa/Hangus.
 * 3. Memindahkan berkas 'Disetujui' yang sudah selesai (endDate < todayWib) ke status 'Selesai' (Arsip Sah) dan menjamin presensi lampau tercatat di attendance_history.
 * 4. Mempertahankan berkas 'Menunggu' dan 'Disetujui' yang masih aktif (hari ini / masa depan).
 */
export async function cleanupPermissionsTotal(targetDate?: string): Promise<{
  deletedRejected: number;
  deletedExpired: number;
  cleanedCompleted: number;
  archivedApproved: number;
  keptActiveCount: number;
}> {
  await initDatabase();
  const todayWib = targetDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const allPerms = await getPermissions();

  let deletedRejected = 0;
  let deletedExpired = 0;
  let cleanedCompleted = 0;
  let archivedApproved = 0;

  for (const p of allPerms) {
    const end = p.endDate || p.startDate;
    // 1. Hapus total berkas yang Ditolak
    if (p.status === 'Ditolak') {
      await turso.execute({ sql: 'DELETE FROM permissions WHERE id = ?;', args: [p.id] });
      deletedRejected++;
    }
    // 2. Hapus total berkas Menunggu yang sudah lewat tanggalnya (Kadaluarsa/Hangus)
    else if (p.status === 'Menunggu' && end < todayWib) {
      await turso.execute({ sql: 'DELETE FROM permissions WHERE id = ?;', args: [p.id] });
      deletedExpired++;
    }
    // 3. Berkas yang sudah Selesai (Arsip lampau): Presensinya sudah tercatat sah di attendance_history, bersihkan dari daftar aktif
    else if (p.status === 'Selesai') {
      await turso.execute({ sql: 'DELETE FROM permissions WHERE id = ?;', args: [p.id] });
      cleanedCompleted++;
    }
    // 4. Berkas Disetujui yang sudah lampau: Pastikan masuk arsip presensi attendance_history, lalu bersihkan dari daftar aktif
    else if (p.status === 'Disetujui' && end < todayWib) {
      try {
        await turso.execute({
          sql: `INSERT OR REPLACE INTO attendance_history (id, rfid_uid, name, class_name, role, date, time, type, status)
                VALUES (?, ?, ?, ?, 'siswa', ?, '07:00:00', 'masuk', 'Izin');`,
          args: [`HIST-${p.id}`, p.studentId, p.name, p.className, p.startDate],
        });
      } catch {}
      await turso.execute({ sql: 'DELETE FROM permissions WHERE id = ?;', args: [p.id] });
      archivedApproved++;
    }
  }

  const currentPerms = await getPermissions();
  const keptActiveCount = currentPerms.filter((p) => p.status === 'Menunggu' || p.status === 'Disetujui').length;

  return {
    deletedRejected,
    deletedExpired,
    cleanedCompleted,
    archivedApproved,
    keptActiveCount,
  };
}
