export const prerender = false;
import type { APIRoute } from 'astro';
import { getStudents } from '../../../utils/attendanceStorage';

// Helper pemfilter UID: Mengekstrak UID Decimal 9 digit dari input RFID
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
    const body = await request.json().catch(() => ({}));
    const rawName = (body.name || body.username || '').trim();
    const rawRfid = extractDecimalUid(body.rfidUid || body.rfid || body.refid || '');

    // 1. Cek Kata Kunci Admin (Bypass dev/admin)
    const isAdminKeyword = (val: string) => /^(admin|administrator|piket)$/i.test(val.trim());
    if (isAdminKeyword(rawName) || isAdminKeyword(rawRfid)) {
      const students = await getStudents();
      const adminCivitas = students.find((s) => s.role === 'admin') || {
        id: 'ADM-001',
        name: 'Administrator Sekolah',
        role: 'admin',
        className: 'Administrator Sekolah',
        category: 'admin',
      };
      return new Response(
        JSON.stringify({
          status: 'success',
          message: `Verifikasi Berhasil! Selamat datang, ${adminCivitas.name} (Administrator Sekolah).`,
          civitas: adminCivitas,
          role: 'admin',
          roleLabel: 'Administrator Sekolah (Kepsek/Waka)',
          redirectUrl: '/',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': `auth_session=admin; Path=/; SameSite=Lax; Max-Age=86400`,
          },
        }
      );
    }

    // 2. Validasi Wajib untuk Siswa: Kedua field (Nama Lengkap & ID RFID) wajib diisi
    console.log('\n==================================================');
    console.log('🔐 [LOGIN API] Percobaan Masuk Portal:');
    console.log('--------------------------------------------------');
    console.log('Nama Input   : ' + (rawName || '(kosong)'));
    console.log('RFID Input   : ' + (body.rfidUid || '(kosong)'));
    console.log('Filter UID   : [' + rawRfid + ']');
    console.log('==================================================');

    if (!rawName || !rawRfid) {
      console.log('❌ [LOGIN] Ditolak: Salah satu atau kedua field kosong.\n');
      return new Response(
        JSON.stringify({
          status: 'error',
          message: 'Nama Lengkap dan ID Kartu RFID wajib diisi.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const students = await getStudents();

    // Helper pencocokan data (HANYA Nama Lengkap & ID RFID murni, NISN tidak diizinkan untuk login)
    const cleanStr = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    const matchRfid = (s: any, input: string) => {
      if (!input) return false;
      const upperInput = input.trim().toUpperCase();
      if (s.rfidUid && s.rfidUid.trim().toUpperCase() === upperInput) return true;
      if (s.id && s.id.trim().toUpperCase() === upperInput) return true;
      return false;
    };

    const matchName = (s: any, input: string) => {
      if (!input) return false;
      const cInput = cleanStr(input);
      if (s.name) {
        const cName = cleanStr(s.name);
        if (cName === cInput) return true;
        if (cInput.length >= 3 && (cName.includes(cInput) || cInput.includes(cName))) return true;
      }
      return false;
    };

    // Siswa/civitas WAJIB mencocokkan KEDUA DATA (Nama Lengkap dan ID RFID) pada satu siswa yang sama
    const found = students.find((s) => matchRfid(s, rawRfid) && matchName(s, rawName));

    if (!found) {
      console.log(`❌ [LOGIN] Gagal: Data tidak cocok atau belum terdaftar.\n`);
      return new Response(
        JSON.stringify({
          status: 'error',
          message: 'Data tidak sesuai atau belum terdaftar. Pastikan Nama Lengkap dan ID Kartu RFID sudah benar.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`✅ [LOGIN] Berhasil: ${found.name} (${found.role})\n`);

    // Filter Peran & Redirect
    const isAdmin = found.role === 'admin';
    const isGuru = found.role === 'guru';
    const roleLabel = isAdmin ? 'Administrator Sekolah (Kepsek/Waka)' : (isGuru ? 'Dewan Guru' : 'Peserta Didik (Siswa)');
    const redirectUrl = isAdmin ? '/' : `/profil-siswa?id=${found.id}&auth=true`;

    return new Response(
      JSON.stringify({
        status: 'success',
        message: `Verifikasi Berhasil! Selamat datang, ${found.name} (${roleLabel}).`,
        civitas: found,
        role: found.role,
        roleLabel,
        redirectUrl,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': `auth_session=${encodeURIComponent(found.role)}; Path=/; SameSite=Lax; Max-Age=86400`,
        },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ status: 'error', message: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
