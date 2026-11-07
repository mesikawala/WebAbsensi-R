export const prerender = false;
import type { APIRoute } from 'astro';
import { getPermissions, savePermission, updatePermissionStatus, updatePermission, deletePermission, clearPermissions, archiveExpiredPermissions, cleanupPermissionsTotal } from '../../utils/permissionStorage';
import { attendanceEmitter } from '../../utils/attendanceEvents';
import { getStudents, getLogs, saveLog } from '../../utils/attendanceStorage';
import { turso } from '../../utils/tursoClient';

export const GET: APIRoute = async () => {
  await archiveExpiredPermissions().catch(() => {});
  const permissions = await getPermissions();
  return new Response(JSON.stringify(permissions), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const DELETE: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const clearAll = url.searchParams.get('all') === 'true';

  if (id) {
    const success = await deletePermission(id);
    if (!success) {
      return new Response(JSON.stringify({ status: 'error', message: 'Data permohonan izin tidak ditemukan' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Hapus juga catatan presensi izin terkait jika pernah disetujui sebelumnya
    try {
      const permLogPrefix = `ATT-IZIN-${id}%`;
      await turso.execute({
        sql: `DELETE FROM attendance_logs WHERE id LIKE ?;`,
        args: [permLogPrefix],
      });
      await turso.execute({
        sql: `DELETE FROM attendance_history WHERE id LIKE ?;`,
        args: [permLogPrefix],
      });
    } catch {}
    attendanceEmitter.emit('attendance', { type: 'permission_updated' });
    return new Response(JSON.stringify({ status: 'success', message: 'Permohonan izin berhasil dibatalkan/dihapus' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (clearAll) {
    await clearPermissions();
    attendanceEmitter.emit('attendance', { type: 'permissions_cleared' });
    return new Response(JSON.stringify({ status: 'success', message: 'Seluruh data izin berhasil dikosongkan.' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ status: 'error', message: 'ID permohonan izin wajib disertakan' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));

    // Aksi 0: Pembersihan Total Terfilter (Hapus Ditolak, Kadaluarsa, dan Arsip Selesai)
    if (body.action === 'cleanup') {
      const result = await cleanupPermissionsTotal();
      attendanceEmitter.emit('attendance', { type: 'permission_updated' });
      const totalCleaned = result.deletedRejected + result.deletedExpired + result.cleanedCompleted + result.archivedApproved;
      return new Response(JSON.stringify({
        status: 'success',
        message: `Pembersihan berhasil: ${totalCleaned} berkas riwayat telah dibersihkan (${result.deletedRejected} ditolak, ${result.cleanedCompleted} arsip selesai, ${result.deletedExpired} kadaluarsa). Tersisa ${result.keptActiveCount} permohonan aktif.`,
        data: result,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Aksi 1: Verifikasi Status oleh Guru/Admin (Disetujui / Ditolak)
    if (body.action === 'update_status' && body.id && body.status) {
      const approvedBy = body.approvedBy ? String(body.approvedBy) : undefined;
      const updated = await updatePermissionStatus(body.id, body.status, approvedBy);
      if (!updated) {
        return new Response(JSON.stringify({ status: 'error', message: 'Data permohonan tidak ditemukan' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const todayWib = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      if (body.status === 'Disetujui') {
        try {
          const students = await getStudents();
          const std = students.find((s) => s.id === updated.studentId || (s.name && updated.name && s.name.toLowerCase() === updated.name.toLowerCase()));
          const studentUid = std?.rfidUid || updated.studentId;
          const studentRole: 'siswa' | 'guru' = (std?.role === 'guru' ? 'guru' : 'siswa');

          // Iterasi seluruh tanggal izin dari startDate s/d endDate
          const dStart = new Date(updated.startDate);
          const dEnd = new Date(updated.endDate || updated.startDate);

          for (let d = new Date(dStart); d <= dEnd; d.setDate(d.getDate() + 1)) {
            const curDateStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
            const permLogId = `ATT-IZIN-${updated.id}-${curDateStr}`;

            if (curDateStr < todayWib) {
              // Persetujuan Susulan untuk Tanggal Lampau:
              // Masukkan atau perbaiki status di attendance_history menjadi 'Izin' (menggugurkan Alpa)
              await turso.execute({
                sql: `
                  INSERT OR REPLACE INTO attendance_history (id, rfid_uid, name, class_name, role, date, time, type, status)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
                `,
                args: [permLogId, studentUid, updated.name, updated.className, studentRole, curDateStr, '07:00:00', 'masuk', 'Izin'],
              });
            } else if (curDateStr === todayWib) {
              // Tanggal Hari Ini: Masukkan ke attendance_logs hari ini
              const currentLogs = await getLogs();
              const alreadyLogged = currentLogs.some((l) => l.date === todayWib && (l.rfidUid === studentUid || l.name === updated.name));
              if (!alreadyLogged) {
                await saveLog({
                  id: permLogId,
                  rfidUid: studentUid,
                  name: updated.name,
                  className: updated.className,
                  role: studentRole,
                  date: todayWib,
                  time: new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta' }),
                  type: 'masuk',
                  status: 'Izin',
                });
              }
            }
          }

          // Jika semua tanggal izin sudah lampau, ubah status izin menjadi 'Selesai' (Arsip Sah)
          if ((updated.endDate || updated.startDate) < todayWib) {
            await updatePermissionStatus(updated.id, 'Selesai');
            updated.status = 'Selesai';
          }
        } catch (e) {
          console.error('Gagal sync izin disetujui ke database presensi:', e);
        }
      } else {
        // Jika Ditolak atau Menunggu: hapus dari log presensi database jika ada entri izin terkait permohonan ini
        try {
          const permLogPrefix = `ATT-IZIN-${updated.id}%`;
          await turso.execute({
            sql: `DELETE FROM attendance_logs WHERE id LIKE ? OR (name = ? AND date = ? AND status = 'Izin');`,
            args: [permLogPrefix, updated.name, todayWib],
          });
          await turso.execute({
            sql: `DELETE FROM attendance_history WHERE id LIKE ?;`,
            args: [permLogPrefix],
          });
        } catch {}
      }

      attendanceEmitter.emit('attendance', { type: 'permission_updated', data: updated });
      return new Response(JSON.stringify({ status: 'success', message: 'Status berhasil diperbarui', data: updated }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Aksi 2: Edit Permohonan Izin yang masih 'Menunggu'
    if (body.action === 'edit' && body.id) {
      const updated = await updatePermission(body.id, {
        category: body.category as ('sakit' | 'dispensasi' | 'keluarga' | undefined),
        categoryLabel: body.categoryLabel,
        title: body.title,
        startDate: body.startDate,
        endDate: body.endDate,
        daysCount: Number(body.daysCount) || 1,
        attachmentNote: body.attachmentNote,
        jurusan: body.jurusan || '',
        photoProof: body.photoProof || '',
      });
      if (!updated) {
        return new Response(JSON.stringify({ status: 'error', message: 'Gagal memperbarui permohonan izin' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      attendanceEmitter.emit('attendance', { type: 'permission_updated', data: updated });
      return new Response(JSON.stringify({ status: 'success', message: 'Permohonan izin berhasil diperbarui', data: updated }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Aksi 3: Buat Permohonan Izin Baru (Status awal: Menunggu Persetujuan)
    if (!body.name || !body.title) {
      return new Response(JSON.stringify({ status: 'error', message: 'Nama dan keterangan alasan permohonan wajib diisi' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const created = await savePermission({
      studentId: body.studentId || '',
      name: body.name,
      className: body.className || 'XII RPL',
      category: (body.category || 'dispensasi') as 'sakit' | 'dispensasi' | 'keluarga',
      categoryLabel: body.categoryLabel || 'Dispensasi',
      title: body.title,
      startDate: body.startDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }),
      endDate: body.endDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }),
      daysCount: Number(body.daysCount) || 1,
      status: 'Menunggu',
      attachmentNote: body.attachmentNote || 'Surat Izin',
      jurusan: body.jurusan || '',
      photoProof: body.photoProof || '',
    });

    attendanceEmitter.emit('attendance', { type: 'permission_updated', data: created });
    return new Response(JSON.stringify({ status: 'success', message: 'Permohonan izin berhasil diajukan! Menunggu persetujuan sekolah.', data: created }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ status: 'error', message: err?.message || 'Gagal memproses data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
