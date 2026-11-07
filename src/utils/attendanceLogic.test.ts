import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLateArrival,
  calculateAttendanceRate,
  filterAttendanceRecords,
  calculateResetCountdown,
  AttendanceRecord,
} from './attendanceLogic';

test('isLateArrival correctly determines late threshold of 07:15', () => {
  assert.equal(isLateArrival('06:45', '07:15'), false);
  assert.equal(isLateArrival('07:14', '07:15'), false);
  assert.equal(isLateArrival('07:15', '07:15'), false);
  assert.equal(isLateArrival('07:16', '07:15'), true);
  assert.equal(isLateArrival('07:30', '07:15'), true);
});

test('calculateAttendanceRate computes accurate percentages and counts', () => {
  const sampleRecords: AttendanceRecord[] = [
    {
      id: '1',
      name: 'Alya Putri',
      identifier: '0068472911',
      role: 'siswa',
      category: 'akl',
      className: 'XII AKL 1',
      grade: 'XII',
      status: 'Hadir',
    },
    {
      id: '2',
      name: 'Rizky Fajar',
      identifier: '0059381722',
      role: 'siswa',
      category: 'rpl',
      className: 'XII RPL 1',
      grade: 'XII',
      status: 'Hadir',
    },
    {
      id: '3',
      name: 'Fadli Muhammad',
      identifier: '0061928374',
      role: 'siswa',
      category: 'rpl',
      className: 'XI RPL 2',
      grade: 'XI',
      status: 'Terlambat',
    },
    {
      id: '4',
      name: 'Dewi Sartika',
      identifier: '0071239841',
      role: 'siswa',
      category: 'akl',
      className: 'XI AKL 2',
      grade: 'XI',
      status: 'Izin',
    },
  ];

  const rate = calculateAttendanceRate(sampleRecords);
  assert.equal(rate.total, 4);
  assert.equal(rate.hadirCount, 2);
  assert.equal(rate.terlambatCount, 1);
  assert.equal(rate.izinCount, 1);
  assert.equal(rate.hadirPercentage, 50.0);
});

test('filterAttendanceRecords filters by category and keyword', () => {
  const sampleRecords: AttendanceRecord[] = [
    {
      id: '1',
      name: 'Alya Putri Ramadhani',
      identifier: '0068472911',
      role: 'siswa',
      category: 'akl',
      className: 'XII AKL 1',
      grade: 'XII',
      status: 'Hadir',
    },
    {
      id: '2',
      name: 'Rizky Fajar Pratama',
      identifier: '0059381722',
      role: 'siswa',
      category: 'rpl',
      className: 'XII RPL 1',
      grade: 'XII',
      status: 'Hadir',
    },
    {
      id: '3',
      name: 'Wahyu Hidayat, M.Kom',
      identifier: '198403152009021003',
      role: 'guru',
      category: 'guru',
      className: 'Dewan Guru',
      grade: 'ALL',
      status: 'Hadir',
    },
  ];

  const filteredAkl = filterAttendanceRecords(sampleRecords, { category: 'akl' });
  assert.equal(filteredAkl.length, 1);
  assert.equal(filteredAkl[0].name, 'Alya Putri Ramadhani');

  const filteredKw = filterAttendanceRecords(sampleRecords, { keyword: 'Rizky' });
  assert.equal(filteredKw.length, 1);
  assert.equal(filteredKw[0].name, 'Rizky Fajar Pratama');
});

test('calculateResetCountdown calculates time remaining until 23:00', () => {
  const mockDate = new Date('2024-10-28T12:00:00');
  const countdown = calculateResetCountdown(mockDate);
  assert.equal(countdown.hours, 11);
  assert.equal(countdown.minutes, 0);
});
