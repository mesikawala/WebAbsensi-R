import { turso, initDatabase } from './tursoClient';
import fs from 'node:fs';
import path from 'node:path';

const schedulesPath = path.resolve('src/data/schedules.json');

export interface ScheduleItem {
  id: string;
  title: string;
  category: 'kbm' | 'rapat' | 'lsp' | 'khusus';
  day: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  timeStart: string;
  timeEnd: string;
  room: string;
  classTarget: string;
  instructor: string;
  color?: string;
  visibility?: 'public' | 'guru';
  notifyLeadDays?: number;
}

/**
 * Pembersihan Otomatis: Hapus agenda dari bulan lampau saat kalender berganti bulan
 */
export async function autoCleanupPastMonthSchedules(): Promise<number> {
  await initDatabase();
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const firstDayOfMonth = `${year}-${month}-01`;

  try {
    const res = await turso.execute({
      sql: `DELETE FROM schedules 
            WHERE COALESCE(NULLIF(end_date, ''), date) != '' 
              AND COALESCE(NULLIF(end_date, ''), date) IS NOT NULL 
              AND COALESCE(NULLIF(end_date, ''), date) < ?;`,
      args: [firstDayOfMonth],
    });
    return res.rowsAffected || 0;
  } catch (err) {
    console.error('Turso autoCleanupPastMonthSchedules error:', err);
    return 0;
  }
}

export async function getSchedules(): Promise<ScheduleItem[]> {
  await initDatabase();
  // Pembersihan otomatis agenda bulan lampau
  await autoCleanupPastMonthSchedules().catch(() => {});
  try {
    const res = await turso.execute('SELECT * FROM schedules ORDER BY time_start ASC;');
    return res.rows.map((r: any) => ({
      id: String(r.id),
      title: String(r.title),
      category: r.category as any,
      day: String(r.day),
      date: r.date ? String(r.date) : '',
      startDate: String(r.start_date || r.date || ''),
      endDate: String(r.end_date || r.start_date || r.date || ''),
      timeStart: String(r.time_start),
      timeEnd: String(r.time_end),
      room: String(r.room),
      classTarget: String(r.class_target),
      instructor: String(r.instructor),
      color: String(r.color || 'teal'),
      visibility: (r.visibility === 'guru' ? 'guru' : 'public') as 'public' | 'guru',
      notifyLeadDays: Number(r.notify_lead_days || 0),
    }));
  } catch (err) {
    console.error('Turso getSchedules error, fallback ke local JSON:', err);
    try {
      if (fs.existsSync(schedulesPath)) {
        return JSON.parse(fs.readFileSync(schedulesPath, 'utf-8'));
      }
    } catch {}
    return [];
  }
}

export async function saveSchedule(item: Partial<ScheduleItem>): Promise<ScheduleItem> {
  await initDatabase();
  const id = item.id || `SCH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const title = item.title || 'Agenda Baru';
  const category = item.category || 'kbm';
  const day = item.day || 'Senin';
  const date = item.date || item.startDate || '';
  const startDate = item.startDate || date || '';
  const endDate = item.endDate || startDate || date || '';
  const visibility: 'public' | 'guru' = item.visibility === 'guru' ? 'guru' : 'public';
  const notifyLeadDays = Number(item.notifyLeadDays ?? 0);
  const timeStart = item.timeStart || '08:00';
  const timeEnd = item.timeEnd || '09:30';
  const room = item.room || 'Ruang KBM';
  const classTarget = item.classTarget || 'Semua Kelas';
  const instructor = item.instructor || 'Guru Pengampu';
  
  // Assign color by category if not given
  let color = item.color;
  if (!color) {
    switch (category) {
      case 'kbm': color = 'teal'; break;
      case 'rapat': color = 'pink'; break;
      case 'lsp': color = 'purple'; break;
      default: color = 'amber'; break;
    }
  }

  const fullItem: ScheduleItem = {
    id,
    title,
    category,
    day,
    date,
    startDate,
    endDate,
    timeStart,
    timeEnd,
    room,
    classTarget,
    instructor,
    color,
    visibility,
    notifyLeadDays,
  };

  try {
    await turso.execute({
      sql: `INSERT OR REPLACE INTO schedules (id, title, category, day, date, time_start, time_end, room, class_target, instructor, color, visibility, start_date, end_date, notify_lead_days)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      args: [id, title, category, day, date, timeStart, timeEnd, room, classTarget, instructor, color, visibility, startDate, endDate, notifyLeadDays],
    });

    // Perbarui file acuan schedules.json: ganti item jika sudah ada, tambahkan jika baru
    let list: ScheduleItem[] = [];
    try {
      if (fs.existsSync(schedulesPath)) {
        list = JSON.parse(fs.readFileSync(schedulesPath, 'utf-8'));
      }
    } catch {}
    const existIdx = list.findIndex((s) => s.id === id);
    if (existIdx >= 0) {
      list[existIdx] = fullItem;
    } else {
      list.push(fullItem);
    }
    fs.writeFileSync(schedulesPath, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('Turso saveSchedule error:', err);
  }

  return fullItem;
}

export async function deleteSchedule(id: string): Promise<boolean> {
  await initDatabase();
  try {
    await turso.execute({
      sql: 'DELETE FROM schedules WHERE id = ?;',
      args: [id],
    });

    if (fs.existsSync(schedulesPath)) {
      try {
        const list: ScheduleItem[] = JSON.parse(fs.readFileSync(schedulesPath, 'utf-8'));
        const filtered = list.filter((s) => s.id !== id);
        fs.writeFileSync(schedulesPath, JSON.stringify(filtered, null, 2), 'utf-8');
      } catch {}
    }
  } catch (err) {
    console.error('Turso deleteSchedule error:', err);
  }

  return true;
}

export async function clearAllSchedules(): Promise<boolean> {
  await initDatabase();
  try {
    await turso.execute('DELETE FROM schedules;');
    fs.writeFileSync(schedulesPath, JSON.stringify([], null, 2), 'utf-8');
  } catch (err) {
    console.error('Turso clearAllSchedules error:', err);
  }

  return true;
}
