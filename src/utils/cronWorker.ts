/**
 * @file src/utils/cronWorker.ts
 * @description Background Scheduler Presisi Mandiri (Target-Timer & Event-Driven)
 * Tanpa Polling berulang: Menghitung selisih waktu menuju 17:00 WIB (Deteksi Bolos)
 * dan 23:00 WIB (Arsip Harian), lalu pasang 1 timer tunggal yang tidur hingga jam target.
 * Menerima sinyal 'settings_updated' jika jadwal diubah sewaktu-waktu.
 */

import { archiveAndResetDailyLogs, checkAndApplyBolos, syncDailyAttendanceAndPermissions } from './attendanceStorage';
import { getSchedulerState, saveSchedulerState, type SchedulerState } from './settingsStorage';
import { attendanceEmitter } from './attendanceEvents';

export interface CronWorkerStatus {
  initialized: boolean;
  timezone: string;
  targetSchedule: string;
  currentWibTime: string;
  lastRunDate: string | null;
  lastRunTime: string | null;
  lastBolosDate: string | null;
  lastStatusMessage: string;
  nextRunEstimated: string;
}

let activeTimer: NodeJS.Timeout | null = null;
let isInitialized = false;

function getWibNow() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);
  const second = parseInt(get('second'), 10);
  const timeStr = `${get('hour')}:${get('minute')}:${get('second')}`;
  return { now, dateStr, hour, minute, second, timeStr };
}

function getMsUntilWibTarget(targetDateStr: string, targetHour: number, targetMinute = 0, targetSecond = 0): number {
  const pad = (n: number) => String(n).padStart(2, '0');
  const targetIso = `${targetDateStr}T${pad(targetHour)}:${pad(targetMinute)}:${pad(targetSecond)}+07:00`;
  const targetTimestamp = new Date(targetIso).getTime();
  const nowTimestamp = Date.now();
  return Math.max(1000, targetTimestamp - nowTimestamp);
}

export function scheduleNextTarget() {
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }

  const { dateStr, hour, timeStr } = getWibNow();
  const state = getSchedulerState();

  let nextType: 'bolos' | 'archive' = 'bolos';
  let targetDate = dateStr;
  let targetHour = 17;
  let targetLabel = '17:00:00 WIB (Deteksi Bolos)';

  // 1. Cek apakah evaluasi bolos hari ini (17:00 WIB) belum jalan & waktu masih sebelum jam 17
  if (state.lastBolosDate !== dateStr && hour < 17) {
    nextType = 'bolos';
    targetDate = dateStr;
    targetHour = 17;
    targetLabel = `${dateStr} 17:00:00 WIB (Deteksi Siswa Bolos)`;
  }
  // 2. Cek apakah arsip harian hari ini (23:00 WIB) belum jalan & waktu masih sebelum jam 23
  else if (state.lastArchivedDate !== dateStr && hour < 23) {
    nextType = 'archive';
    targetDate = dateStr;
    targetHour = 23;
    targetLabel = `${dateStr} 23:00:00 WIB (Arsip & Reset Harian)`;
  }
  // 3. Tugas hari ini selesai (atau sudah lewat 23:00), jadwalkan untuk besok jam 17:00 WIB
  else {
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const tomorrowDateStr = tomorrow.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    nextType = 'bolos';
    targetDate = tomorrowDateStr;
    targetHour = 17;
    targetLabel = `${tomorrowDateStr} 17:00:00 WIB (Deteksi Siswa Bolos)`;
  }

  const delayMs = getMsUntilWibTarget(targetDate, targetHour, 0, 0);
  const hoursLeft = (delayMs / (1000 * 3600)).toFixed(2);

  // Perbarui file acuan JSON tanpa memicu kueri database
  saveSchedulerState({
    nextRunType: nextType,
    nextRunTime: targetLabel,
    lastStatusMessage: `Timer aktif: Menunggu jadwal berikutnya dalam ~${hoursLeft} jam (${targetLabel})`,
  });

  console.log(`[SCHEDULER MANDIRI] ⏱️ Timer disetel: Target ${targetLabel} (tidur selama ~${hoursLeft} jam, 0 kueri).`);

  activeTimer = setTimeout(async () => {
    try {
      const curWib = getWibNow();
      console.log(`[SCHEDULER MANDIRI] ⏰ Waktu target tiba (${curWib.timeStr} WIB). Mengeksekusi tugas: ${nextType.toUpperCase()}...`);

      if (nextType === 'bolos') {
        const bolosRes = await checkAndApplyBolos(curWib.dateStr);
        saveSchedulerState({
          lastBolosDate: curWib.dateStr,
          lastStatusMessage: `Sukses Evaluasi Bolos: ${bolosRes.bolosCount} siswa bolos dipotong 10 poin.`,
        });
        console.log(`[SCHEDULER MANDIRI] ✅ Evaluasi bolos selesai: ${bolosRes.bolosCount} siswa ditindaklanjuti.`);
      } else {
        const archiveRes = await archiveAndResetDailyLogs(curWib.dateStr);
        saveSchedulerState({
          lastArchivedDate: curWib.dateStr,
          lastStatusMessage: `Sukses Arsip: ${archiveRes.message} (${archiveRes.archivedCount} log, ${archiveRes.bolosCount} bolos).`,
        });
        console.log(`[SCHEDULER MANDIRI] ✅ Arsip harian selesai: ${archiveRes.archivedCount} log tersimpan di arsip permanen.`);
      }
    } catch (err: any) {
      console.error('[SCHEDULER MANDIRI] ❌ Kesalahan eksekusi timer target:', err);
      saveSchedulerState({
        lastStatusMessage: `Gagal eksekusi: ${err?.message || err}`,
      });
    } finally {
      // Otomatis pasang timer untuk jam target berikutnya
      scheduleNextTarget();
    }
  }, delayMs);
}

export function initCronWorker() {
  if (typeof globalThis === 'undefined' || isInitialized) return;
  isInitialized = true;

  console.log('[SCHEDULER MANDIRI] 🚀 Menginisialisasi scheduler hemat resource berbasis acuan JSON & target timer.');

  // Startup Self-Healing 1 Kali Saja:
  // Jika kemarin ada presensi yang belum diarsip (misal server mati semalaman), selesaikan 1 kali
  const { dateStr } = getWibNow();
  const state = getSchedulerState();

  if (state.lastArchivedDate && state.lastArchivedDate < dateStr) {
    console.log(`[STARTUP SELF-HEALING] Memeriksa & merapikan arsip tanggal lampau (${state.lastArchivedDate})...`);
    syncDailyAttendanceAndPermissions().catch((e) => console.error('[STARTUP SELF-HEALING ERROR]:', e));
  }

  // Pasang timer target pertama
  scheduleNextTarget();

  // Dengarkan sinyal jika pengaturan jadwal diubah dari UI web
  attendanceEmitter.on('settings_updated', (newSettings) => {
    console.log('[SCHEDULER MANDIRI] ⚡ Sinyal perubahan jadwal diterima! Menyetel ulang timer target...');
    scheduleNextTarget();
  });
}

export function getCronStatus(): CronWorkerStatus {
  const { dateStr, timeStr } = getWibNow();
  const state = getSchedulerState();

  return {
    initialized: isInitialized,
    timezone: 'Asia/Jakarta (WIB)',
    targetSchedule: '17:00 WIB (Deteksi Bolos) & 23:00 WIB (Arsip Harian)',
    currentWibTime: `${dateStr} ${timeStr} WIB`,
    lastRunDate: state.lastArchivedDate,
    lastRunTime: state.lastArchivedDate ? '23:00:00 WIB' : null,
    lastBolosDate: state.lastBolosDate,
    lastStatusMessage: state.lastStatusMessage || 'Sistem siap',
    nextRunEstimated: state.nextRunTime || 'Menghitung...',
  };
}

export async function runCronNow(targetDate?: string) {
  const dateStr = targetDate || getWibNow().dateStr;
  const result = await archiveAndResetDailyLogs(dateStr);
  saveSchedulerState({
    lastArchivedDate: dateStr,
    lastStatusMessage: `Trigger Manual Sukses: ${result.message} (${result.archivedCount} log, ${result.bolosCount} bolos)`,
  });
  scheduleNextTarget();
  return result;
}
