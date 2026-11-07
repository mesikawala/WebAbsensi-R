import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.TURSO_DATABASE_URL || 'libsql://absensi-smk-maarif-padang-ratu-fahriramadan.aws-ap-southeast-1.turso.io';
const authToken = process.env.TURSO_AUTH_TOKEN || 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTMzNTA3NjMsImlkIjoiMDFhMThjMDUtZjcwMS03ZWNkLWE5YzgtYThjYzNkMjg5NDU1Iiwia2lkIjoidlk2ZVpJczJKYjhlU2ZyS2xBTG94UlVGWmFxS2dlSEplTmlYSFJ2clVSOCIsInJpZCI6ImFjOTFmNWUxLWZmNTctNGZiZS05MzEzLTAzYjNjN2ZmOGJiYyJ9.VRRwcmxeHtXjgH2nJJTG9sfqLw8bFBYTPf9qvt8tYA44Bn2DWwz66EcSzlHnOUANtoV4MlFdnnGqaJ8fAPG9Bg';

export const turso = createClient({
  url,
  authToken,
});

let initialized = false;

export async function initDatabase(): Promise<void> {
  if (initialized) return;

  // 1. Table Students
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      rfid_uid TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      identifier TEXT,
      role TEXT DEFAULT 'siswa',
      category TEXT DEFAULT 'rpl',
      class_name TEXT NOT NULL,
      address TEXT DEFAULT 'Padang Ratu, Lampung',
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      birth_date TEXT DEFAULT '',
      gender TEXT DEFAULT 'L',
      tag TEXT DEFAULT ''
    );
  `);

  // Migrasi kolom jika tabel lama sudah ada sebelumnya
  try { await turso.execute(`ALTER TABLE students ADD COLUMN address TEXT DEFAULT 'Padang Ratu, Lampung';`); } catch {}
  try { await turso.execute(`ALTER TABLE students ADD COLUMN email TEXT DEFAULT '';`); } catch {}
  try { await turso.execute(`ALTER TABLE students ADD COLUMN phone TEXT DEFAULT '';`); } catch {}
  try { await turso.execute(`ALTER TABLE students ADD COLUMN birth_date TEXT DEFAULT '';`); } catch {}
  try { await turso.execute(`ALTER TABLE students ADD COLUMN gender TEXT DEFAULT 'L';`); } catch {}
  try { await turso.execute(`ALTER TABLE students ADD COLUMN tag TEXT DEFAULT '';`); } catch {}

  // 2. Table Attendance Logs
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS attendance_logs (
      id TEXT PRIMARY KEY,
      rfid_uid TEXT NOT NULL,
      name TEXT NOT NULL,
      class_name TEXT NOT NULL,
      role TEXT DEFAULT 'siswa',
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `);

  // 3. Table Settings
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // 4. Table Permissions
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      name TEXT NOT NULL,
      class_name TEXT NOT NULL,
      category TEXT NOT NULL,
      category_label TEXT,
      title TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      days_count INTEGER DEFAULT 1,
      status TEXT DEFAULT 'Menunggu',
      attachment_note TEXT,
      jurusan TEXT DEFAULT '',
      photo_proof TEXT DEFAULT ''
    );
  `);

  try { await turso.execute(`ALTER TABLE permissions ADD COLUMN jurusan TEXT DEFAULT '';`); } catch {}
  try { await turso.execute(`ALTER TABLE permissions ADD COLUMN photo_proof TEXT DEFAULT '';`); } catch {}
  try { await turso.execute(`ALTER TABLE permissions ADD COLUMN approved_by TEXT DEFAULT '';`); } catch {}
  try { await turso.execute(`ALTER TABLE permissions ADD COLUMN approved_at TEXT DEFAULT '';`); } catch {}

  // 5. Table Schedules / Agenda
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      day TEXT NOT NULL,
      date TEXT,
      time_start TEXT NOT NULL,
      time_end TEXT NOT NULL,
      room TEXT NOT NULL,
      class_target TEXT NOT NULL,
      instructor TEXT NOT NULL,
      color TEXT
    );
  `);
  try { await turso.execute(`ALTER TABLE schedules ADD COLUMN visibility TEXT DEFAULT 'public';`); } catch {}
  try { await turso.execute(`ALTER TABLE schedules ADD COLUMN start_date TEXT;`); } catch {}
  try { await turso.execute(`ALTER TABLE schedules ADD COLUMN end_date TEXT;`); } catch {}
  try { await turso.execute(`ALTER TABLE schedules ADD COLUMN notify_lead_days INTEGER DEFAULT 0;`); } catch {}

  // 6. Table Point Deductions (Akumulasi Poin Kedisiplinan)
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS point_deductions (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      rfid_uid TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      minutes_late INTEGER NOT NULL,
      points_deducted INTEGER NOT NULL,
      reason TEXT NOT NULL
    );
  `);

  // 7. Table Attendance History Archive (Arsip Rekap Permanen)
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS attendance_history (
      id TEXT PRIMARY KEY,
      rfid_uid TEXT NOT NULL,
      name TEXT NOT NULL,
      class_name TEXT NOT NULL,
      role TEXT DEFAULT 'siswa',
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `);

  // Migrasi otomatis data awal dari JSON jika tabel masih kosong
  await migrateInitialDataIfEmpty();

  initialized = true;
}

async function migrateInitialDataIfEmpty() {
  try {
    // Cek settings sistem (jam operasional gerbang & konfigurasi)
    const setCount = await turso.execute('SELECT COUNT(*) as count FROM settings;');
    if (Number(setCount.rows[0].count) === 0) {
      const setPath = path.resolve('src/data/settings.json');
      if (fs.existsSync(setPath)) {
        const settings = JSON.parse(fs.readFileSync(setPath, 'utf-8'));
        for (const [k, v] of Object.entries(settings)) {
          await turso.execute({
            sql: `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);`,
            args: [k, String(v)],
          });
        }
      }
    }

    // Pastikan Pejabat Waka Kesiswaan (Wahyu Hidayat, M.Kom) memiliki tag 'waka'
    try {
      await turso.execute(`
        UPDATE students 
        SET tag = 'waka', name = 'Wahyu Hidayat, M.Kom', class_name = 'Dewan Guru (Waka Kesiswaan)'
        WHERE id = 'GUR-001' OR name LIKE '%Wahyu Hidayat%';
      `);
    } catch {}

    // Pastikan Kepala Sekolah (H. Ahmad Fauzi, S.Pd., M.M.) terdaftar dengan tag 'kepsek'
    try {
      const kepsekCheck = await turso.execute(`SELECT id FROM students WHERE tag = 'kepsek' OR name LIKE '%Ahmad Fauzi%';`);
      if (!kepsekCheck.rows.length) {
        await turso.execute({
          sql: `
            INSERT INTO students (id, rfid_uid, name, identifier, role, category, class_name, address, email, phone, birth_date, gender, tag)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
          `,
          args: [
            'GUR-002',
            '8B9C0D1E',
            'H. Ahmad Fauzi, S.Pd., M.M.',
            '197805122005011008',
            'guru',
            'guru',
            'Kepala Sekolah',
            'Padang Ratu, Lampung Tengah',
            'ahmad.fauzi@smkmaarif.sch.id',
            '+62 812-7799-8800',
            '12 Mei 1978',
            'L',
            'kepsek'
          ]
        });
      }
    } catch {}
  } catch (err) {
    console.error('Error saat inisialisasi settings/pejabat Turso:', err);
  }
}
