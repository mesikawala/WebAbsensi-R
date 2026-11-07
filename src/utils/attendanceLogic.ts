/**
 * @file src/utils/attendanceLogic.ts
 * @description Logika murni untuk perhitungan statistik kehadiran dan validasi absensi sekolah
 */

export interface AttendanceRecord {
  id: string;
  name: string;
  identifier: string; // NISN or NIP
  role: 'siswa' | 'guru';
  category: 'akl' | 'rpl' | 'tkj' | 'dkv' | 'tm' | 'guru';
  className: string;
  grade: 'X' | 'XI' | 'XII' | 'ALL';
  status: 'Hadir' | 'Terlambat' | 'Izin' | 'Tugas Luar' | 'Alpa';
  arrivalTime?: string; // "HH:MM"
}

/**
 * Memeriksa apakah kedatangan melebihi batas jam toleransi piket (07:15)
 */
export function isLateArrival(timeStr: string, limitStr = '07:15'): boolean {
  const [h, m] = timeStr.split(':').map(Number);
  const [limH, limM] = limitStr.split(':').map(Number);
  const arrivalMinutes = h * 60 + m;
  const limitMinutes = limH * 60 + limM;
  return arrivalMinutes > limitMinutes;
}

/**
 * Menghitung persentase kehadiran tepat waktu dari daftar catatan
 */
export function calculateAttendanceRate(records: AttendanceRecord[]): {
  total: number;
  hadirCount: number;
  terlambatCount: number;
  izinCount: number;
  alpaCount: number;
  hadirPercentage: number;
} {
  const total = records.length;
  if (total === 0) {
    return {
      total: 0,
      hadirCount: 0,
      terlambatCount: 0,
      izinCount: 0,
      alpaCount: 0,
      hadirPercentage: 0,
    };
  }

  let hadirCount = 0;
  let terlambatCount = 0;
  let izinCount = 0;
  let alpaCount = 0;

  for (const r of records) {
    if (r.status === 'Hadir' || r.status === 'Tugas Luar') hadirCount++;
    else if (r.status === 'Terlambat') terlambatCount++;
    else if (r.status === 'Izin') izinCount++;
    else if (r.status === 'Alpa') alpaCount++;
  }

  const hadirPercentage = Number(((hadirCount / total) * 100).toFixed(1));

  return {
    total,
    hadirCount,
    terlambatCount,
    izinCount,
    alpaCount,
    hadirPercentage,
  };
}

/**
 * Filter catatan presensi berdasarkan pencarian keyword, kategori jurusan, tingkat, dan status
 */
export function filterAttendanceRecords(
  records: AttendanceRecord[],
  query: {
    keyword?: string;
    category?: string;
    grade?: string;
    status?: string;
  }
): AttendanceRecord[] {
  const kw = (query.keyword || '').toLowerCase().trim();
  const cat = query.category || 'all';
  const gr = query.grade || 'ALL';
  const st = query.status || 'ALL';

  return records.filter((item) => {
    const matchKw =
      !kw ||
      item.name.toLowerCase().includes(kw) ||
      item.identifier.toLowerCase().includes(kw) ||
      item.className.toLowerCase().includes(kw);

    const matchCat = cat === 'all' || item.category === cat;
    const matchGrade = gr === 'ALL' || item.grade === gr || item.grade === 'ALL';
    const matchStatus = st === 'ALL' || item.status === st;

    return matchKw && matchCat && matchGrade && matchStatus;
  });
}

/**
 * Menghitung sisa jam dan menit menuju reset pukul 23:00 WIB
 */
export function calculateResetCountdown(currentDate: Date): { hours: number; minutes: number } {
  const currentHour = currentDate.getHours();
  const currentMinute = currentDate.getMinutes();
  let hoursLeft = 23 - currentHour;
  let minutesLeft = 60 - currentMinute;

  if (minutesLeft === 60) {
    minutesLeft = 0;
  } else {
    hoursLeft -= 1;
  }

  if (hoursLeft < 0) {
    hoursLeft = 0;
    minutesLeft = 0;
  }

  return { hours: hoursLeft, minutes: minutesLeft };
}
