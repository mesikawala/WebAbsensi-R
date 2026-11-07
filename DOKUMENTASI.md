# DOKUMENTASI LENGKAP SISTEM PRESENSI & KEDISIPLINAN IOT RFID
**SMK Ma'arif 1 Padang Ratu**  
*Dokumentasi Teknis & Fungsional Komprehensif (Backend, Frontend, API, Database & Arsitektur)*  
*Status Update Terakhir: 30 Oktober 2026*

---

## DAFTAR ISI
1. [Ikhtisar Arsitektur Sistem](#1-ikhtisar-arsitektur-sistem)
2. [Arsitektur Database (Turso LibSQL Cloud)](#2-arsitektur-database-turso-libsql-cloud)
3. [Daftar Lengkap REST API & Endpoint](#3-daftar-lengkap-rest-api--endpoint)
4. [Daftar Fitur yang Telah Selesai Diimplementasikan](#4-daftar-fitur-yang-telah-selesai-diimplementasikan)
5. [Struktur Halaman Frontend (Astro Components)](#5-struktur-halaman-frontend-astro-components)
6. [Mekanisme Realtime & Event-Driven (SSE)](#6-mekanisme-realtime--event-driven-sse)
7. [Status Data & Keamanan Sistem](#7-status-data--keamanan-sistem)
8. [Integrasi Firmware ESP32 & Perangkat Keras Gerbang IoT](#8-integrasi-firmware-esp32--perangkat-keras-gerbang-iot)
9. [Peta Jalan Fitur Lanjutan (Roadmap Mendatang)](#9-peta-jalan-fitur-lanjutan-roadmap-mendatang)

---

## 1. Ikhtisar Arsitektur Sistem

Aplikasi ini dibangun menggunakan arsitektur web modern yang dirancang untuk mendukung perangkat keras gerbang IoT RFID sekolah secara realtime, efisien, dan andal:

```
+-------------------------------------------------------------------------------+
|                      PERANGKAT IOT / SIMULATOR BROWSER                       |
|   (Kartu RFID Siswa & Guru -> ESP32 / RC522 Reader -> HTTP POST /api/attendance)|
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
|                         BACKEND SERVICE (ASTRO SSR)                           |
|  - Validasi ID & Role Civitas (Siswa vs Guru)                                 |
|  - Logika Jam Masuk Dinamis & Pengecekan Keterlambatan                       |
|  - Mesin Kalkulasi Pemotongan Poin Disiplin (ide.txt)                         |
|  - Aturan Khusus Dewan Guru (Selalu Hadir, Bebas Telat, 1x Sehari)           |
|  - Anti Double-Tap Proteksi per Sesi & Per Hari                               |
|  - Auto-Reset Mingguan Riwayat Poin (Senin 00:00 WIB)                         |
+-------------------+-----------------------------------+-----------------------+
                    |                                   |
                    v                                   v
+-----------------------------------+   +---------------------------------------+
|    TURSO LIBSQL CLOUD DATABASE    |   |     SERVER-SENT EVENTS (SSE BUS)      |
|  - students                       |   |  - /api/attendance-stream             |
|  - attendance_logs                |   |  - Broadcast event tap kartu instan   |
|  - point_deductions               |   |  - Push update poin & status          |
|  - permissions                    |   +-------------------+-------------------+
|  - settings                       |                       |
|  - schedules                      |                       v
+-----------------------------------+   +---------------------------------------+
                                        |          FRONTEND CLIENT (UI)         |
                                        |  - Dashboard Utama (index.astro)      |
                                        |  - Profil 6-Section (profil-siswa)    |
                                        |  - Manajemen Civitas (siswa-guru)     |
                                        |  - Rapor & Rekapitulasi               |
                                        +---------------------------------------+
```

---

## 2. Arsitektur Database (Turso LibSQL Cloud)

Sistem menggunakan database **Turso LibSQL Cloud** terintegrasi di edge region Singapore (`aws-ap-southeast-1`) dengan mekanisme **Hybrid Storage** (otomatis fallback ke JSON lokal di `src/data/` jika offline). Inisialisasi dan migrasi tabel dikelola melalui [`src/utils/tursoClient.ts`](file:///home/ubuntu/school-attendance-web/src/utils/tursoClient.ts).

### Tabel-Tabel Database:

### 1. `students` (Tabel Master Civitas)
Menyimpan seluruh data identitas peserta didik dan tenaga pendidik.
- `id` (TEXT, PRIMARY KEY): ID unik civitas (contoh: `STD-001`, `GUR-001`).
- `rfid_uid` (TEXT, UNIQUE): UID kartu RFID fisik (contoh: `A1B2C3D4`, `7A8B9C0D`).
- `name` (TEXT): Nama lengkap civitas.
- `identifier` (TEXT): NISN bagi siswa, NIP/NUPTK bagi guru.
- `role` (TEXT): Hak akses civitas (`siswa` atau `guru`).
- `category` (TEXT): Jurusan atau bidang (`rpl`, `akl`, `guru`).
- `class_name` (TEXT): Rombel/jabatan (contoh: `XII RPL 1`, `Dewan Guru`).

### 2. `attendance_logs` (Tabel Jejak Presensi Gerbang)
Menyimpan transaksi pemindaian kartu RFID di gerbang sekolah secara realtime.
- `id` (TEXT, PRIMARY KEY): ID unik transaksi (contoh: `ATT-1793361550945`).
- `rfid_uid` (TEXT): UID kartu yang di-tap.
- `name` (TEXT): Nama civitas saat tap.
- `class_name` (TEXT): Kelas / unit kerja civitas.
- `role` (TEXT): Role civitas (`siswa` atau `guru`).
- `date` (TEXT): Tanggal presensi format ISO (`YYYY-MM-DD`).
- `time` (TEXT): Jam presensi format WIB (`HH:MM:SS`).
- `type` (TEXT): Sesi presensi (`masuk` pagi atau `pulang` siang).
- `status` (TEXT): Status kehadiran (`Hadir`, `Terlambat`, `Pulang`).

### 3. `attendance_history` (Tabel Arsip Historis Presensi Permanen)
Menyimpan seluruh jejak presensi dari hari-hari sebelumnya yang diarsip otomatis setiap jam 23:00 WIB atau melalui tombol arsip. Data presensi pada tabel ini bersifat permanen dan tidak pernah terhapus saat pergantian hari, memungkinkan filter fleksibel 7 hari, 30 hari, maupun seluruh arsip tahunan.
- `id` (TEXT, PRIMARY KEY), `rfid_uid`, `name`, `class_name`, `role`, `date`, `time`, `type`, `status`.

### 4. `point_deductions` (Tabel Akumulasi Pengurangan Poin Siswa)
Mencatat detail pemotongan poin kedisiplinan akibat keterlambatan sesi pagi maupun pelanggaran bolos kepulangan (-10 poin).
- `id` (TEXT, PRIMARY KEY): ID unik pemotongan (contoh: `DED-1793360245421`, `DED-BOLOS-...`).
- `student_id` (TEXT): ID siswa (`STD-001`).
- `rfid_uid` (TEXT): UID kartu siswa.
- `date` (TEXT): Tanggal pelanggaran (`YYYY-MM-DD`).
- `time` (TEXT): Waktu tepat pelanggaran tercatat.
- `minutes_late` (INTEGER): Jumlah menit keterlambatan (0 jika pelanggaran bolos).
- `points_deducted` (INTEGER): Jumlah poin yang dipotong (-2, -3, -5, -10, -30, -40).
- `reason` (TEXT): Keterangan resmi sebab pemotongan poin (contoh: *Bolos: Tercatat presensi masuk pagi tetapi tidak melakukan presensi kepulangan (pulang)*).

### 4. `permissions` (Tabel Perizinan, Dispensasi & Surat Tugas)
Menyimpan riwayat izin, sakit, dispensasi siswa dan surat dinas guru lengkap dengan verifikasi berkas bukti.
- `id` (TEXT, PRIMARY KEY): ID unik perizinan (`PRM-8849`).
- `student_id` (TEXT): ID siswa / guru pengaju.
- `name` (TEXT): Nama pengaju.
- `class_name` (TEXT): Kelas pengaju.
- `category` (TEXT): Kategori izin (`sakit`, `dispensasi`, `keluarga`).
- `category_label` (TEXT): Label tampilan (`Sakit`, `Dispensasi`, dll).
- `title` (TEXT): Perihal / alasan permohonan.
- `start_date` (TEXT): Tanggal awal izin format ISO (`YYYY-MM-DD`).
- `end_date` (TEXT): Tanggal akhir izin format ISO (`YYYY-MM-DD`).
- `days_count` (INTEGER): Total durasi perizinan (dihitung otomatis).
- `status` (TEXT): Status verifikasi (`Menunggu`, `Disetujui`, `Ditolak`). Default: `Menunggu`.
- `attachment_note` (TEXT): Keterangan surat bukti / berkas lampiran.
- `jurusan` (TEXT): Pilihan jurusan civitas via Check Box (`RPL`, `AKL`, atau keduanya).
- `photo_proof` (TEXT): Lampiran foto surat keterangan dokter / surat dinas (base64 data URL).

### 5. `settings` (Tabel Konfigurasi Sistem Sekolah)
Konfigurasi operasional berbasis key-value.
- `key` (TEXT, PRIMARY KEY): Kunci pengaturan (`jamBuka`, `jamMasuk`, `jamPulang`, dll).
- `value` (TEXT): Nilai konfigurasi (contoh: `"07:00"`, `"15:30"`).

### 6. `schedules` (Tabel Agenda KBM & Jadwal Lab)
Data jadwal pelajaran dan pemakaian laboratorium komputer.
- `id` (TEXT, PRIMARY KEY), `title`, `category`, `day`, `date`, `time_start`, `time_end`, `room`, `class_target`, `instructor`, `color`.

---

## 3. Daftar Lengkap REST API & Endpoint

Semua endpoint API beralamat di `/api/*` dengan mode server SSR (`prerender = false`):

| Endpoint | Method | Fungsi & Peran Teknis | Request / Query Parameter | Format Output |
| :--- | :---: | :--- | :--- | :--- |
| **`/api/attendance`** | `GET` | Mengambil seluruh log presensi gerbang hari ini dari tabel `attendance_logs`. | Tidak ada | `Array<AttendanceLog>` |
| **`/api/attendance`** | `POST` | Endpoint utama pemrosesan tap kartu RFID dari mesin IoT gerbang / simulator. Menjalankan logika anti-double-tap, aturan guru, hitung poin, dan broadcast SSE. | `{"uid": "A1B2C3D4", "simulatedTime": "07:15", "type": "masuk"}` | `{"status": "success", "data": {...}, "points": 95, "deduction": {...}}` |
| **`/api/attendance`** | `DELETE`| Mereset seluruh transaksi log presensi di database dan memancarkan sinyal reset SSE. | Tidak ada | `{"status": "success", "message": "Log presensi berhasil direset"}` |
| **`/api/points`** | `GET` | Mengambil ringkasan saldo poin aktif siswa (100 - akumulasi potongan), status disiplin (`aman`, `peringatan`, `diblokir`), dan array riwayat pemotongan poin. | `?studentId=STD-001&rfid=A1B2C3D4` | `{"totalPoints": 95, "status": "aman", "totalDeducted": 5, "deductions": [...]}` |
| **`/api/points`** | `POST` | Menambahkan catatan pemotongan poin kedisiplinan secara manual / otomatis ke tabel `point_deductions`. | `{"studentId": "...", "rfidUid": "...", "minutesLate": 15, "pointsDeducted": 5, "reason": "..."}` | `{"status": "success", "data": {...}}` |
| **`/api/points`** | `DELETE`| Mereset pemotongan poin siswa kembali ke 100 poin utuh default. | `?studentId=STD-001` (opsional) | `{"status": "success", "message": "Poin berhasil direset ke 100"}` |
| **`/api/permissions`** | `GET` | Mengambil seluruh data pengajuan perizinan dan dispensasi dari tabel `permissions`. | Tidak ada | `Array<PermissionRecord>` |
| **`/api/permissions`** | `POST` | Mendukung 4 mode: (1) Pengajuan baru (`status: 'Menunggu'`), (2) Edit izin mandiri (`action: 'edit'`), (3) Verifikasi status oleh Guru/Admin (`action: 'update_status'`) dengan dukungan **Persetujuan Susulan** (tanggal lampau otomatis disahkan jadi 'Izin' di `attendance_history`), (4) Pembersihan Total Terfilter (`action: 'cleanup'`) yang menghapus total berkas ditolak & kadaluarsa serta mengarsipkan izin sah. | JSON permohonan izin / action payload | `{"status": "success", "data": {...}}` |
| **`/api/permissions`** | `DELETE`| (1) Membatalkan / menghapus izin tertentu (`?id=PRM-xxx`), (2) Mengosongkan data izin jika tanpa id parameter. | `?id=PRM-xxx` (opsional) | `{"status": "success", "message": "..."}` |
| **`/api/students`** | `GET` | Mengambil master civitas sekolah (siswa dan guru) dengan filter pencarian nama, kelas, atau role. | `?role=siswa&q=alya` (opsional) | `Array<StudentCivitas>` |
| **`/api/students`** | `POST` | Mendaftarkan civitas baru atau mengupdate data kartu RFID civitas. | `{"id": "...", "rfidUid": "...", "name": "...", "role": "siswa", ...}` | `{"status": "success", "data": {...}}` |
| **`/api/students`** | `DELETE`| Menghapus civitas dari database. | `?id=STD-001` | `{"status": "success"}` |
| **`/api/settings`** | `GET` | Membaca jam operasional gerbang (`jamBuka`, `jamMasuk`, `jamPulang`) dari database `settings`. | Tidak ada | `{"jamBuka": "06:30", "jamMasuk": "07:00", "jamPulang": "15:30"}` |
| **`/api/settings`** | `POST` | Mengubah jam operasional gerbang sekolah. | `{"jamBuka": "06:00", "jamMasuk": "07:15", "jamPulang": "15:00"}` | `{"status": "success"}` |
| **`/api/attendance/bolos`** | `GET` | Mengecek daftar siswa yang hadir pagi namun belum absen pulang (*pending bolos*) dan yang sudah dihukum bolos. | `?date=YYYY-MM-DD` (opsional) | `{"status": "success", "pendingBolos": [...], "confirmedBolos": [...]}` |
| **`/api/attendance/bolos`** | `POST` | Mengeksekusi penalti bolos: siswa yang tap masuk pagi tapi tidak tap pulang otomatis dikategorikan `Bolos` dan dipotong 10 poin. | `{"date": "YYYY-MM-DD"}` (opsional) | `{"status": "success", "data": {"bolosCount": 1, ...}}` |
| **`/api/attendance/archive`** | `GET` | Mengambil data presensi historis dari tabel gabungan (`attendance_logs` & `attendance_history`) dengan filter fleksibel periode. | `?filter=today|week|month|year|all` | `Array<AttendanceLog>` |
| **`/api/attendance/archive`** | `POST` | Menjalankan otomatisasi jam 23:00 WIB: menghukum bolos (-10 poin), mengarsip seluruh presensi ke `attendance_history`, dan mengosongkan status harian. | `{"date": "YYYY-MM-DD"}` (opsional) | `{"status": "success", "archivedCount": 2, "bolosCount": 1}` |
| **`/api/attendance-stream`** | `GET` | Endpoint Server-Sent Events (SSE). Membuka koneksi stream HTTP realtime satu arah untuk menyiarkan event tap gerbang langsung ke browser. | Header: `Accept: text/event-stream` | Event stream SSE (`event: attendance`, `data: {...}`) |
| **`/api/auth/login`** | `POST` | Endpoint otentikasi login mandiri civitas (Siswa & Guru) berbasis 2 input: Nama Lengkap dan ID Kartu RFID. Peran (Siswa vs Guru) otomatis difilter backend dari tag `role` database. | `{"name": "Alya Putri Ramadhani", "rfidUid": "A1B2C3D4"}` | `{"status": "success", "civitas": {...}, "role": "siswa", "redirectUrl": "..."}` |

---

## 4. Daftar Fitur yang Telah Selesai Diimplementasikan

### 1. Sistem Akumulasi Poin Kedisiplinan Otomatis ([ide.txt](file:///home/ubuntu/school-attendance-web/ide.txt))
- **Default Saldo 100 Poin**: Setiap siswa memiliki batas 100 poin kedisiplinan per periode.
- **Kalkulasi Akurat Berbasis Menit Terlambat Sesi Pagi**:
  - `1 - 5 Menit` terlambat: **-2 Poin** *(Kategori Ringan)*.
  - `6 - 9 Menit` terlambat: **-3 Poin** *(Kategori Sedang Ringan)*.
  - `10 - 20 Menit` terlambat: **-5 Poin** *(Kategori Sedang)*.
  - `20 - 30 Menit` terlambat: **-30 Poin** *(Kategori Berat)*.
  - `> 30 Menit` terlambat berat: **-40 Poin** *(Kategori Sangat Berat)*.
  - `Hadir Tepat Waktu` (sebelum atau sama dengan `jamMasuk`): **0 Poin** (tidak berkurang).
- **Berlaku Khusus Sesi Pagi**: Keterlambatan hanya dihitung saat siswa masuk pagi. Presensi kepulangan siang tidak mengurangi poin.
- **Ambang Peringatan Kritis Gerbang (Threshold LCD)**:
  - **Poin < 10**: Muncul peringatan khusus: *"Anda berhasil absen namun poin anda kurang dari 10 silahkan temui guru terlebih dahulu"*.
  - **Poin = 0**: Akses gerbang otomatis dikunci (**HTTP 403 Forbidden**). Sistem menolak absen hingga siswa mendapatkan persetujuan/reset dari guru piket atau wakasis.
- **Pembersihan Mingguan Otomatis (Auto-Prune)**: Riwayat pemotongan poin sebelum hari Senin (00:00 WIB) dipangkas otomatis pada file [`src/utils/pointsStorage.ts`](file:///home/ubuntu/school-attendance-web/src/utils/pointsStorage.ts) agar tidak memenuhi memori database.

### 2. Aturan Khusus Dewan Guru ([ide.txt Baris 26-27](file:///home/ubuntu/school-attendance-web/ide.txt#L26-L27))
- **Bebas Keterlambatan**: Dewan guru (`role === 'guru'`) tidak memiliki status *Terlambat*. Status kehadiran guru selalu tercatat **`Hadir`**.
- **Tanpa Pengurangan Poin**: Dewan guru tidak dikenakan sistem pengurangan poin siswa (lingkaran poin disembunyikan dan diganti informasi rapor kinerja).
- **Satu Kali Absen per Hari**: Guru hanya perlu melakukan tap kartu 1 kali per hari. Jika melakukan tap kartu kedua pada hari yang sama, sistem memberikan notifikasi pengingat bahwa presensi hari ini sudah tercatat.

### 3. Isolasi Penuh Data Pribadi per Siswa
- Seluruh query data pada API `/api/points`, `/api/attendance`, dan halaman profil menggunakan validasi case-insensitive:  
  `UPPER(student_id) = UPPER(?) OR UPPER(rfid_uid) = UPPER(?)`.
- **Hasil**: Keterlambatan dan pemotongan poin Siswa A (misal Alya) **hanya tampil di profil Siswa A**. Siswa B (misal Rizky) yang tidak terlambat tetap bersih dengan 100 Poin Utuh tanpa kebocoran data.

### 4. Linimasa Presensi Realtime ([`src/pages/profil-siswa.astro`](file:///home/ubuntu/school-attendance-web/src/pages/profil-siswa.astro))
Linimasa presensi siswa tersusun atas 4 simpul linimasa berbasis data real:
- **Simpul 1 - Presensi Gerbang Hari Ini**: Menampilkan status tap hari ini (*Belum Absen*, *Hadir Tepat Waktu*, atau *Terlambat* beserta jam WIB dan ID transaksi gerbang).
- **Simpul 2 - Pemberitahuan Poin Kedisiplinan**: Kartu notifikasi detail jika terjadi pemotongan poin (menampilkan tanggal, jam, menit telat, poin yang berkurang, sisa poin, dan sebab pengurangan). Jika disiplin, menampilkan badge hijau *Catatan Poin Bersih (100 Poin Utuh)*.
- **Simpul 3 - Status Perizinan & Pengajuan Izin**: Menampilkan status izin aktif (*Menunggu Persetujuan*, *Disetujui*, atau *Ditolak*), keterangan surat, dan tombol aksi sekolah.
- **Simpul 4 - Riwayat Jejak Presensi Gerbang**: Riwayat seluruh log transaksi tap kartu RFID siswa dari database. Item dummy *Agenda KBM* telah dihapus total.

### 5. Alur Pengajuan Izin Siswa & Verifikasi Sekolah
- **Modal Pengajuan (`#modal-pengajuan-izin`)**: Formulir permohonan izin dengan kategori *Sakit*, *Dispensasi*, atau *Urusan Keluarga*, tanggal mulai, tanggal selesai, alasan, dan catatan lampiran surat.
- **Verifikasi Sekolah**: Tombol cepat `✓ Terima Izin` dan `✗ Tolak Izin` langsung pada linimasa untuk mengubah status izin secara realtime.

### 6. Desain Profil Modular 6-Bagian
Halaman profil civitas dipecah menjadi tab navigasi modular:
1. **Biodata & Profil**: Foto profil proporsional, nomor kartu, NISN/NIP, kelas, dan status kehadiran hari ini.
2. **Data Kartu & RFID**: Visualisasi kartu digital, chip Mifare, dan tombol simulasi tap kartu.
3. **Linimasa Presensi**: Catatan jejak presensi gerbang, notifikasi poin, izin, dan log tap.
4. **Poin & Pelanggaran**: Nilai angka poin aktif, tabel matematika aturan telat, dan log pelanggaran.
5. **Rapor Kedisiplinan**: Rasio kehadiran dan jumlah hari hadir tepat waktu yang dihitung dinamis dari log real.
6. **Ruang Modul Sistem Baru**: Tempat penambahan ide sistem baru secara terisolasi tanpa mengganggu profil utama.

### 7. Pembersihan Tuntas Data Dummy
- Seluruh data dummy awal pada tabel `attendance_logs`, `point_deductions`, dan `permissions` telah dikosongkan.
- Sistem beroperasi menggunakan data nyata yang bersumber langsung dari pemindaian kartu RFID.

### 8. Deteksi Bolos Kepulangan (-10 Poin) & Otomasi Arsip Jam 23:00 WIB
- **Aturan Deteksi Bolos Real**:
  - Siswa wajib melakukan 2 kali tap: Pagi (sesi masuk) dan Siang (sesi pulang).
  - Ketika siswa absen pagi (`type: 'masuk'`, baik *Hadir* maupun *Terlambat*), namun **TIDAK melakukan absen kepulangan (pulang)**, maka saat evaluasi gerbang sistem otomatis mencatat log kepulangan dengan status **`Bolos`**.
  - Siswa yang terdeteksi bolos langsung dikenakan penalti pemotongan **10 Poin Kedisiplinan** (`pointsDeducted: 10`) dengan alasan resmi:  
    *"Bolos: Tercatat presensi masuk pagi tetapi tidak melakukan presensi kepulangan (pulang)"*.
  - Dewan guru (`role === 'guru'`) dikecualikan dari deteksi bolos karena guru hanya perlu absen 1x sehari.
- **Otomasi Jam 23:00 WIB & Reset Harian**:
  - Sistem mengeksekusi evaluasi bolos secara tuntas bagi seluruh siswa yang hadir pagi namun tidak ada log pulang.
  - Memindahkan seluruh transaksi presensi hari ini dari `attendance_logs` ke tabel arsip historis permanen **`attendance_history`** di Turso LibSQL Cloud.
  - Mengosongkan data presensi aktif hari berjalan sehingga pada esok hari seluruh status siswa otomatis kembali menjadi **`Belum Absen`**.
- **Filter Fleksibel Riwayat & Rekapitulasi Presensi**:
  - Halaman [`src/pages/rekapitulasi.astro`](file:///home/ubuntu/school-attendance-web/src/pages/rekapitulasi.astro) menyediakan tombol filter: **Hari Ini**, **7 Hari Terakhir**, **30 Hari Terakhir**, dan **Semua Arsip**.
  - Dilengkapi tombol kendali manual guru piket: `⚡ Evaluasi Bolos (-10P)` dan `📦 Arsip Jam 23:00` untuk simulasi uji coba langsung.

### 9. Portal Login Mandiri Civitas (Siswa & Guru) & Sinkronisasi Form Database
- **Formulir Login Fleksibel Berbasis ID RFID / REFID**:
  - Form login di [`src/pages/login.astro`](file:///home/ubuntu/school-attendance-web/src/pages/login.astro) mendukung autentikasi menggunakan **ID RFID / REFID** (UID kartu seperti `A1B2C3D4`) baik secara mandiri maupun bersama **Username (Nama Lengkap)**.
  - Backend [`POST /api/auth/login`](file:///home/ubuntu/school-attendance-web/src/pages/api/auth/login.ts) secara cerdas memvalidasi kartu RFID dan membaca peran civitas langsung dari tag `role` database Turso LibSQL Cloud.
- **Tampilan Informasi Lengkap Saat Login Sebagai Guru**:
  - Ketika login sebagai Dewan Guru (`auth_role === 'guru'`), seluruh data civitas ditampilkan **secara lengkap (full profile)** baik ketika meninjau profil guru sendiri maupun ketika meninjau profil siswa.
  - Data yang ditampilkan mencakup: **Nama**, **Alamat / Domisili**, **ID RFID**, **NISN / NIP**, **Email**, **Tanggal Lahir**, **Tanggal Daftar / TMT Tugas**, serta **Kontak WhatsApp**.
  - Dilengkapi tombol aksi WhatsApp (`#btn-wa-action`) untuk komunikasi langsung dengan siswa, wali murid, maupun rekan pendidik.
- **Tampilan Ringkas Khusus Siswa**:
  - Ketika login sebagai Siswa (`auth_role === 'siswa'`), sistem menerapkan prinsip privasi dan simplisitas. Profil siswa **hanya menampilkan 4 data esensial**:
    1. **Nama Lengkap**
    2. **Alamat / Domisili**
    3. **ID RFID** (UID kartu RFID civitas)
    4. **NISN** (Nomor Induk Siswa Nasional)
  - Seluruh informasi administratif ekstra (Email, Tanggal Lahir, Tanggal Daftar, Kontak Wali) serta opsi cetak/hubungi WA otomatis disembunyikan.
- **Sinkronisasi Database & Formulir Tambah/Edit Civitas ([`src/pages/siswa-guru.astro`](file:///home/ubuntu/school-attendance-web/src/pages/siswa-guru.astro))**:
  - Tabel `students` pada database Turso LibSQL Cloud telah diperluas dengan kolom nyata: `address`, `email`, `phone`, `birth_date`, dan `gender`.
  - Formulir penambahan dan edit civitas telah disesuaikan agar memiliki jumlah dan jenis field yang persis sama dengan informasi pada profil:
    - *Identitas*: Nama Lengkap, NISN / NIP, Jenis Kelamin, Tanggal Lahir.
    - *Kontak & Lokasi*: Alamat Domisili, Email Civitas, Nomor WhatsApp Civitas / Wali.
    - *Akademik*: Kompetensi Keahlian (RPL / AKL / Dewan Guru) dan Rombel / Kelas Aktif.
    - *Hardware*: Pairing UID Kartu RFID (scanner ESP32 / Acak UID).

### 5. Modul Pengajuan Izin Mandiri, Tab History & Alur Status Presensi Harian
- **Penggantian Nama Menu & Tab**:
  - Menu 3 Sidebar & Tab diubah menjadi **History** (sebelumnya *Linimasa Presensi*).
  - Menu 6 Sidebar diubah menjadi **Pengajuan Izin** (sebelumnya *Modul Sistem Baru*).
- **Formulir Pengajuan Izin Mandiri ([`src/pages/profil-siswa.astro`](file:///home/ubuntu/school-attendance-web/src/pages/profil-siswa.astro))**:
  - **Siswa**:
    - Nama & Kelas terisi otomatis (*read-only*).
    - Jurusan menggunakan **Check Box** (pilihan `RPL` dan `AKL`).
    - Rentang Waktu (*Mulai Tanggal* s/d *Sampai Tanggal*) dengan kalkulasi durasi hari otomatis.
    - Keterangan / Alasan Permohonan.
    - **Foto Bukti Surat / Keterangan Dokter Wajib** (dengan file input, preview gambar instan, dan opsi batalkan preview).
  - **Dewan Guru**:
    - Pengajuan izin pendidik hanya membutuhkan Keterangan/Alasan dan Rentang Tanggal (tanpa checkbox jurusan dan tanpa kewajiban unggah foto bukti).
- **Status Permohonan & Riwayat Izin**:
  - Status awal setelah izin diajukan: **`Menunggu Persetujuan`** (badge kuning berdenyut).
  - Tertera pada daftar **Riwayat Pengajuan Izin Saya**:
    - Selama berstatus *Menunggu Persetujuan*, izin **bisa diedit** atau **dibatalkan/dihapus** langsung oleh pemohon.
    - Setelah diverifikasi/disetujui oleh pihak sekolah (*Disetujui* / *Ditolak*), data otomatis terkunci (*read-only*).
- **Aturan Alur Presensi Harian**:
  - **Status Izin Seharian Penuh**: Jika siswa atau guru memiliki izin aktif yang telah berstatus *Disetujui* mencakup hari berjalan, maka status presensinya sepanjang hari terkunci sebagai **`Izin`**, tidak akan berubah menjadi "Belum Hadir" saat memasuki jadwal absen siang, dan dikecualikan dari pemotongan poin / evaluasi bolos.
  - **Deteksi Bolos**: Siswa yang tap presensi masuk pagi namun tidak melakukan tap kepulangan siang dikategorikan sebagai **`Bolos`** (-10 Poin).
  - **Status Masuk Jadwal**: Saat jam jadwal presensi dibuka (pagi maupun siang), civitas yang belum tap berstatus **`Belum Hadir`**.
  - **Penutupan Jadwal**: Ketika jadwal absensi ditutup, status tetap menampilkan hasil terakhir yang didapat hari itu (tidak langsung reset). Status baru kembali menjadi `Belum Hadir` saat jadwal pagi hari berikutnya dibuka, **kecuali status `Izin`** yang tetap bertahan hingga rentang hari izin selesai.

---

## 5. Struktur Halaman Frontend (Astro Components)

| File Halaman | Rute URL | Peran & Deskripsi Fungsional |
| :--- | :--- | :--- |
| [`src/pages/index.astro`](file:///home/ubuntu/school-attendance-web/src/pages/index.astro) | `/` | **Dashboard Utama Monitoring Gerbang**: Menampilkan indikator gerbang aktif, ringkasan jumlah hadir/terlambat hari ini, feed live presensi kartu secara realtime via SSE, serta jam operasional gerbang. |
| [`src/pages/login.astro`](file:///home/ubuntu/school-attendance-web/src/pages/login.astro) | `/login` | **Portal Login Mandiri Civitas**: Halaman login modern berbasis layout kartu melengkung biru-putih dengan toggle role Siswa vs Guru, input data unik RFID/NISN/NIP, dan chip coba cepat. |
| [`src/pages/profil-siswa.astro`](file:///home/ubuntu/school-attendance-web/src/pages/profil-siswa.astro) | `/profil-siswa?id=STD-001` | **Portal Detail Civitas (6 Section Modular)**: Menampilkan profil civitas, data kartu RFID, tab **History** presensi harian, status poin disiplin (saldo 100), rapor kedisiplinan, serta modul **Pengajuan Izin** mandiri (dengan upload bukti foto, checkbox jurusan, dan edit/batal). Mendukung Mode Terkunci Siswa. |
| [`src/pages/siswa-guru.astro`](file:///home/ubuntu/school-attendance-web/src/pages/siswa-guru.astro) | `/siswa-guru` | **Manajemen Data Civitas**: Pengelolaan data master siswa dan guru, input nomor RFID UID kartu, cetak kartu civitas, dan pencarian rombel. |
| [`src/pages/izin-dispensasi.astro`](file:///home/ubuntu/school-attendance-web/src/pages/izin-dispensasi.astro) | `/izin-dispensasi` | **Pusat Rekapitulasi Izin Sekolah**: Monitoring seluruh pengajuan surat sakit, perizinan, dan dispensasi dinas. |
| [`src/pages/jadwal.astro`](file:///home/ubuntu/school-attendance-web/src/pages/jadwal.astro) | `/jadwal` | **Manajemen Jadwal KBM & Lab**: Jadwal pelajaran kejuruan RPL, AKL, dan alokasi ruang lab komputer. |
| [`src/pages/pengaturan.astro`](file:///home/ubuntu/school-attendance-web/src/pages/pengaturan.astro) | `/pengaturan` | **Konfigurasi Jam Gerbang**: Form konfigurasi jam buka gerbang, batas jam masuk (keterlambatan), dan jam kepulangan sekolah. |
| [`src/pages/rekapitulasi.astro`](file:///home/ubuntu/school-attendance-web/src/pages/rekapitulasi.astro) | `/rekapitulasi` | **Laporan Presensi Sekolah**: Rekapitulasi presensi harian dengan tabel live dari database Turso Cloud. |
| [`src/layouts/Layout.astro`](file:///home/ubuntu/school-attendance-web/src/layouts/Layout.astro) | Semua halaman | **Layout Induk & Konektivitas Global**: Jam digital WIB presisi, inisialisasi koneksi realtime EventSource SSE `/api/attendance-stream`, sistem toast notification, dan popup simulator IoT RFID. |

---

## 6. Mekanisme Realtime & Event-Driven (SSE)

Sistem menggunakan arsitektur **Server-Sent Events (SSE)** untuk memastikan pembaruan data bersifat instan:

1. Saat halaman dimuat, [`src/layouts/Layout.astro`](file:///home/ubuntu/school-attendance-web/src/layouts/Layout.astro) membuka koneksi streaming ke `/api/attendance-stream`.
2. Ketika mesin gerbang IoT atau simulator mengirim data ke `POST /api/attendance`:
   - Server memproses data presensi dan menyimpan log ke Turso Cloud.
   - Server memancarkan sinyal melalui `attendanceEmitter.emit('attendance', payload)`.
   - Endpoint `/api/attendance-stream` meneruskan event ke seluruh browser yang terhubung.
3. Browser menerima event dan memancarkan CustomEvent JavaScript:  
   `window.dispatchEvent(new CustomEvent('attendance-updated', { detail: result }))`.
4. Halaman yang sedang aktif (seperti `profil-siswa.astro` atau `index.astro`) otomatis me-refresh data tanpa reload seluruh halaman (*zero flicker*).

---

## 7. Status Data & Keamanan Sistem

- **Database Bersih**: Database dalam status *clean state* (0 data dummy).
- **Handling Error & Validasi**:
  - Validasi keberadaan ID/UID civitas (mencegah tap dari kartu yang tidak terdaftar).
  - Validasi jam operasional (menolak tap di luar jadwal 05:00 - 23:00 WIB).
  - Validasi poin 0 (memblokir akses RFID gerbang jika poin siswa habis).
  - Proteksi anti double-tap (mencegah duplikasi data absen pada sesi yang sama).

---

## 8. Integrasi Firmware ESP32 & Perangkat Keras Gerbang IoT

Kode firmware sketch untuk mikrokontroler gerbang RFID terletak pada:  
📁 [arduino/esp32_rfid_attendance.ino](file:///home/ubuntu/school-attendance-web/arduino/esp32_rfid_attendance.ino)  
📄 Panduan perakitan & wiring: [arduino/README.md](file:///home/ubuntu/school-attendance-web/arduino/README.md)

### A. Skema Pinout Hardware (ESP32 DevKit V1 30-Pin)
| Modul | Pin Modul | Pin ESP32 | Keterangan & Catatan Tegangan |
| :--- | :--- | :--- | :--- |
| **RFID RC522** | 3.3V / VCC | **3V3** | **Wajib 3.3V** (Jangan sambungkan ke 5V!) |
| | RST | **D4** (GPIO 4) | Reset pin |
| | GND | **GND** | Ground bersama |
| | MISO | **D19** (GPIO 19) | SPI Master In Slave Out |
| | MOSI | **D23** (GPIO 23) | SPI Master Out Slave In |
| | SCK | **D18** (GPIO 18) | SPI Clock |
| | SDA / SS | **D5** (GPIO 5) | SPI Chip Select |
| **LCD I2C 16x2 / 20x4** | VCC | **VIN / 5V** | Catu daya modul I2C |
| *(Opsional)* | GND | **GND** | Ground bersama |
| | SDA | **D21** (GPIO 21) | I2C Serial Data |
| | SCL | **D22** (GPIO 22) | I2C Serial Clock |
| **Indikator Fisik** | LED Hijau (+) | **D2** (GPIO 2) | Seri resistor 220 Ohm |
| | LED Merah (+) | **D15** (GPIO 15) | Seri resistor 220 Ohm |
| | Active Buzzer (+)| **D13** (GPIO 13) | Buzzer aktif 3.3V/5V |

### B. Pemetaan Respon Firmware ESP32 Sesuai Aturan Sistem
| Skenario Tap Gerbang | HTTP Code | Tampilan Layar LCD 16x2 | Pola Audio Buzzer & LED | Serial Log ESP32 |
| :--- | :---: | :--- | :--- | :--- |
| **Hadir Tepat Waktu (Siswa)** | `200` | L1: `[Nama Siswa]`<br>L2: `Hadir Tepat Waktu` | 1x Beep pendek (120ms) + LED Hijau | `[BERHASIL] Hadir Tepat Waktu (100 Poin)` |
| **Terlambat (Siswa)** | `200` | L1: `[Nama Siswa]`<br>L2: `Telat! Sisa: 95P` | 2x Beep peringatan (100ms) + LED Merah & Hijau | `[TERLAMBAT] Potong poin sesuai menit telat` |
| **Peringatan Poin < 10 (ide.txt)** | `200` | L1: `Poin < 10! ([Sisa])`<br>L2: `Temui Guru!` | 3x Beep cepat + LED Merah kedip | `>> LCD: Anda berhasil absen namun poin anda kurang dari 10 silahkan temui guru terlebih dahulu <<` |
| **Poin = 0 / Terkunci (ide.txt)** | `403` | L1: `AKSES TERKUNCI!`<br>L2: `Poin 0 - Ke Guru` | 4x Beep panjang alarm + LED Merah | `[AKSES TERKUNCI] Poin 0 (Akses Ditolak) Wajib Lapor Guru Piket/Wakasis` |
| **Presensi Dewan Guru** | `200` | L1: `GURU: [Nama]`<br>L2: `Hadir Mengajar` | 1x Beep pendek + LED Hijau | `[GURU HADIR] Selalu status Hadir (Bebas Telat, 1x Sehari)` |
| **Sudah Absen (Double-Tap)** | `200` | L1: `SUDAH ABSEN!`<br>L2: `Pendidik/Siswa` | 2x Beep cepat (60ms) + LED Merah kedip | `[SUDAH ABSEN] Sudah melakukan absen hari ini` |
| **Kartu Belum Terdaftar** | `404` | L1: `KARTU DITOLAK!`<br>L2: `UID Tdk Terdaftar` | 3x Beep nada gagal + LED Merah | `[DITOLAK] UID belum terdaftar di database` |
| **Di Luar Jam Operasional** | `400` | L1: `GERBANG DITUTUP`<br>L2: `Di Luar Jadwal` | 3x Beep nada gagal + LED Merah | `[DITOLAK] Di luar jadwal operasional gerbang` |
| **Server Offline / Gagal WiFi**| `-` | L1: `GAGAL KONEKSI`<br>L2: `Server Offline` | 1x Beep panjang (600ms) + LED Merah | `[GAGAL KONEKSI] Tidak dapat terhubung ke server web` |

---

## 9. Status Pelaksanaan Peta Jalan 4 Fitur Bertahap

Penerapan 4 fitur roadmap lanjutan diimplementasikan **satu per satu secara berurutan**:

### ✅ FITUR 1: Deteksi Bolos Kepulangan (-10 Poin) & Otomasi Jam 23:00 WIB [SELESAI / DONE]
- **Status**: Berhasil diuji dan aktif di database Turso LibSQL Cloud.
- **Logika**: Siswa absen pagi tapi tidak absen siang otomatis dikategorikan `Bolos`, dicatat log kepulangan status `Bolos`, dan poin dipotong 10 poin secara otomatis (`DED-BOLOS-...`).
- **Otomasi 23:00**: Log dipindahkan ke tabel permanen `attendance_history` dan tabel aktif `attendance_logs` direset bersih.
- **UI & Filter**: Tersedia di [`src/pages/rekapitulasi.astro`](file:///home/ubuntu/school-attendance-web/src/pages/rekapitulasi.astro) dengan filter Hari Ini, 7 Hari, 30 Hari, Semua Arsip, dan tombol aksi manual guru.

---

### ✅ FITUR 2: Portal Login Mandiri Siswa & Guru & Wajib Login Saat Pertama Masuk Web [SELESAI / DONE]
- **Status**: Berhasil diimplementasikan pada [`src/pages/login.astro`](file:///home/ubuntu/school-attendance-web/src/pages/login.astro), [`src/layouts/Layout.astro`](file:///home/ubuntu/school-attendance-web/src/layouts/Layout.astro), dan seluruh rute web.
- **Mandatory First Landing (`/login`)**:
  - Saat pengguna pertama kali membuka website (`/`) atau URL internal mana pun tanpa sesi aktif, server dan client-side guard langsung mengalihkan (HTTP 302) seketika ke halaman `/login`.
  - Zero-flash pre-render guard pada `<head>` di [`Layout.astro`](file:///home/ubuntu/school-attendance-web/src/layouts/Layout.astro) menyembunyikan DOM dan mengalihkan seketika jika belum terautentikasi.
- **Pemisahan Peran (Role-Based Access Control)**:
  - **Siswa**: Otomatis diarahkan ke [`/profil-siswa`](file:///home/ubuntu/school-attendance-web/src/pages/profil-siswa.astro) dan dibatasi aksesnya dari dashboard utama (`/`), jadwal, rekapitulasi, maupun data siswa-guru.
  - **Dewan Guru & Admin**: Memiliki hak akses penuh ke dashboard (`/`), pemantauan presensi realtime, jadwal, rekapitulasi, dan manajemen data civitas.
- **Mekanisme Logout Terpadu**:
  - Tombol Logout hijau di kanan atas Navbar dan tombol logout di Sidebar membersihkan seluruh `localStorage`, `sessionStorage`, dan cookie `auth_session`, serta mengembalikan pengguna ke `/login`.

---

### ✅ FITUR 3: Modul Pengajuan Izin Mandiri, Siklus Hidup Izin & Self-Healing Scanner [SELESAI / DONE]
- **Status**: Selesai 100% dan terintegrasi di database Turso LibSQL Cloud.
- **Penggantian Tab**: Tab ke-3 diubah menjadi **History** dan Tab ke-6 diubah menjadi **Pengajuan Izin**.
- **Formulir Permohonan**: 
  - Siswa: Nama & Kelas (*readonly*), Jurusan via Check Box (RPL/AKL), rentang hari (kalkulasi durasi otomatis), keterangan, dan **foto bukti surat wajib** dengan pratinjau instan.
  - Guru: Keterangan dan rentang tanggal (tanpa checkbox jurusan dan tanpa kewajiban unggah foto bukti).
- **Siklus Hidup Perizinan Otomatis (Permission Lifecycle & Archiving)**:
  - **Status `Selesai`**: Saat masa berlaku izin terlewati (`endDate < todayStr`) atau saat jam reset 23:00 WIB, permohonan izin otomatis diarsipkan menjadi berstatus `Selesai`.
  - **Pencatatan ke Rekap Presensi**: Setiap hari dalam rentang izin yang disetujui otomatis dibuatkan catatan presensi resmi di `attendance_history` berstatus `Izin`, sehingga rekapitulasi dinas & rapor cetak PDF tetap lengkap dan sah.
  - **Kembali Bersih**: Pada hari setelah izin berakhir, status siswa di absensi harian otomatis kembali menjadi `Belum Hadir`.
- **Self-Healing Scanner (Anti-Downtime / Server Mati)**:
  - Sistem langsung memindai database saat startup server atau pada request pertama di hari baru: jika ada data log presensi atau izin lampau yang belum diarsipkan karena server mati semalaman, sistem seketika memprosesnya secara instan.
- **Proteksi Izin Seharian Penuh**: Civitas yang memiliki izin aktif yang disetujui pada hari berjalan statusnya terkunci sebagai `Izin` seharian penuh, tidak berubah ke `Belum Hadir` saat jadwal siang dibuka, dan dikecualikan dari sanksi pemotongan poin bolos.

---

### ⏳ FITUR 4: Integrasi WhatsApp Gateway (Fonnte API) [BERIKUTNYA]
- Pengiriman notifikasi WhatsApp otomatis ke nomor orang tua / wali murid:
  - Notifikasi konfirmasi kehadiran saat siswa berhasil tap pagi.
  - Notifikasi peringatan keterlambatan (jumlah menit telat dan sisa poin).
  - Notifikasi peringatan bolos kepulangan (-10 Poin).
  - Notifikasi konfirmasi penerimaan/penolakan perizinan siswa.
  - Notifikasi darurat jika poin siswa mencapai batas kritis (< 10 poin) atau terkunci (0 poin).

---

### ⏳ FITUR 5: Pengawasan Terpadu & Finalisasi Rekapitulasi Berstandar Dinas [TAHAP 5]
- Penyempurnaan ekspor PDF/Excel berstandar dinas dengan kop surat resmi, stempel digital, tanda tangan digital, QR code verifikasi keaslian, dan ringkasan chat WhatsApp guru piket.

---

### 🛡️ 10. Kebijakan & Alur Hak Akses Perizinan (Guru vs Siswa)

1. **Hak Akses Pihak Siswa (Pengaju Izin)**:
   - Siswa dapat melihat riwayat pengajuan izin mereka di [`src/pages/profil-siswa.astro`](file:///home/ubuntu/school-attendance-web/src/pages/profil-siswa.astro).
   - Selama status permohonan masih **`Menunggu`**, siswa memiliki tombol **`Edit`** dan **`Batalkan / Hapus`** untuk memperbarui alasan, tanggal, atau mengganti foto surat bukti dokter.
   - Begitu permohonan diproses oleh guru (*Disetujui*, *Ditolak*, atau *Selesai*), status otomatis terkunci (**`🔒 Status Terkunci`**) sehingga data sah tidak dapat diubah lagi oleh siswa.

2. **Hak Akses Pihak Guru (Peninjau / Verifikator)**:
   - Guru **TIDAK BISA EDIT** data yang telah diisi siswa (kebijakan *Read-Only* ketat untuk integritas bukti fisik).
   - Pada halaman [`src/pages/izin-dispensasi.astro`](file:///home/ubuntu/school-attendance-web/src/pages/izin-dispensasi.astro), guru disediakan tombol **`Foto & Rincian`** pada setiap kartu izin.
   - Pop-up modal **`Rincian & Bukti Izin Siswa`** menampilkan:
     - Foto bukti surat / surat dokter resolusi tinggi dengan opsi pratinjau penuh & unduh.
     - Identitas lengkap siswa (Nama, Kelas, NIS).
     - Rentang tanggal dan durasi hari izin.
     - Alasan / keterangan lengkap yang diketik siswa.
     - Catatan lampiran dokumen pendukung.
     - Tombol aksi verifikasi guru: **`Setujui Izin`** atau **`Tolak`**.
   - Footer diagram dashboard utama ([`src/pages/index.astro`](file:///home/ubuntu/school-attendance-web/src/pages/index.astro)) terhubung langsung ke halaman perizinan untuk mempercepat proses verifikasi wali kelas.

3. **Pembersihan Otomatis Foto Bukti (7 Hari)**:
   - Foto bukti fisik dalam format Base64 dibersihkan otomatis dari database Turso LibSQL Cloud setelah 7 hari untuk mencegah pembengkakan memori, sementara rekap teks dan catatan presensi tetap tersimpan abadi.

4. **Tombol "Bersihkan Permohonan" (Pembersihan Total Terfilter)**:
   - Menghapus tuntas seluruh berkas yang **`Ditolak`** dari database.
   - Menghapus berkas yang **`Menunggu`** tapi sudah lewat tanggalnya (kadaluarsa).
   - Membersihkan berkas yang sudah **`Selesai` (Arsip)** dari daftar aktif (data presensinya tetap sah di `attendance_history`).
   - Menyalin berkas **`Disetujui`** lampau ke `attendance_history` lalu membersihkannya dari daftar aktif.
   - **Mempertahankan** hanya berkas **`Menunggu`** aktif dan **`Disetujui`** aktif yang masih berlaku.

---

### 👑 11. Manajemen Peran 3-Tingkat (Admin vs Guru vs Siswa) & Portal Konfirmasi Izin

1. **Administrator Sekolah (`role: 'admin'`)**:
   - **Personel**: Kepala Sekolah dan Waka Kesiswaan.
   - **Akun Administrator Utama**:
     - **Nama**: `Fahri Ramadan`
     - **Role**: `admin`
     - **REFID / ID RFID Acak**: `FR9X7B2E4A8C`
     - **NIP / Identifier**: `199001012023011001`
     - **Jabatan**: `Administrator Sekolah (Kepala Sekolah / Waka)`
   - **Hak Akses Penuh**: Mengakses Dashboard Utama (`/`), Pengaturan Jadwal KBM & Jam Gerbang (`/jadwal`), Rekapitulasi Presensi & Ekspor PDF (`/rekapitulasi`), Pemantauan Realtime, dan Basis Data Civitas (`/siswa-guru`).
   - **Kendali Reset Poin Kedisiplinan Siswa**: Poin kedisiplinan siswa **TIDAK RESET OTOMATIS BERKALA** mingguan; akumulasi pengurangan poin tersimpan permanen dan hanya dapat direset secara sadar oleh Administrator (Waka Kesiswaan / Kepala Sekolah) melalui tombol reset poin (`DELETE /api/points`).

2. **Pendaftaran Civitas 3-Pilihan Peran ([`src/pages/siswa-guru.astro`](file:///home/ubuntu/school-attendance-web/src/pages/siswa-guru.astro))**:
   - Tombol registrasi di header diperbarui menjadi **`+ Pendaftaran Civitas (Siswa / Guru / Admin)`**.
   - Modal registrasi pada Tahap 1 menyediakan 3 Kartu Peran:
     - **Siswa / Siswi**: Peserta didik reguler, memerlukan NISN, rombel kelas, jurusan (RPL/AKL), dan kontak wali murid.
     - **Dewan Guru**: Tenaga pendidik, memerlukan NIP/NUPTK, tugas mengajar, dan jam presensi.
     - **Administrator Sekolah**: Kepsek, Waka, atau Staf Admin Sistem dengan hak konfigurasi menyeluruh.
   - Tabel civitas dilengkapi Tab Filter khusus: **Semua Civitas**, **Siswa AKL**, **Siswa RPL**, **Dewan Guru**, dan **Admin**.

3. **Dewan Guru (`role: 'guru'`)**:
   - Diarahkan langsung ke portal mandiri di [`src/pages/profil-siswa.astro`](file:///home/ubuntu/school-attendance-web/src/pages/profil-siswa.astro) (tidak dapat mengakses halaman admin maupun mengubah jadwal dan data civitas).
   - Menu sidebar perizinan otomatis berubah menjadi **`Konfirmasi Izin Siswa`** (dengan badge khusus *Guru*).
   - Menampilkan panel **Konfirmasi Permohonan Izin Siswa**:
     - Memuat seluruh pengajuan izin siswa yang masuk secara realtime.
     - Guru dapat meninjau foto bukti surat dokter/dispensasi dan membaca alasan permohonan.
     - Guru memiliki hak aksi cepat: **`✓ Setujui Izin`** atau **`✗ Tolak Izin`**.

4. **Siswa (`role: 'siswa'`)**:
   - Tetap berada di portal siswa [`src/pages/profil-siswa.astro`](file:///home/ubuntu/school-attendance-web/src/pages/profil-siswa.astro).
   - Hanya dapat melihat biodata mandiri, linimasa kehadiran gerbang, poin kedisiplinan, serta mengajukan izin belajar mandiri dengan foto bukti surat.

---

## 12. Daftar Ide & Fitur yang Ditunda / Disimpan untuk Tahap Lanjutan (Pending Backlog)

Dokumen ini mengarsipkan seluruh konsep, arsitektur, dan perancangan teknis untuk fitur yang sengaja ditunda/disimpan terlebih dahulu agar dapat dibuka kembali saat pendekatan integrasi yang paling tepat telah ditentukan:

### 📱 1. Integrasi Notifikasi WhatsApp Gateway Otomatis (Wali Murid & Civitas)
- **Status**: ⏳ *Ditunda / Disimpan (Pending)*
- **Catatan Pertimbangan**: Pendekatan integrasi WhatsApp saat ini disimpan terlebih dahulu karena pendekatan teknisnya masih perlu dimatangkan (apakah menggunakan token pihak ketiga, bot multi-device lokal, atau cloud API resmi).

- **Opsi Pendekatan yang Disimpan**:
  1. **Opsi A - Gateway Pihak Ketiga (Fonnte / Wablas API)**:
     - *Cara Kerja*: Mengirimkan payload JSON via HTTP POST (`https://api.fonnte.com/send`) menggunakan Authorization Bearer Token.
     - *Kelebihan*: Tidak memerlukan server bot terpisah, sangat ringan, dan cepat.
     - *Tantangan*: Memerlukan biaya langganan/kuota token berkala dari pihak ketiga.
  2. **Opsi B - Self-Hosted Multi-Device Engine (Baileys / WA-Web.js)**:
     - *Cara Kerja*: Server Node.js lokal/VPS menjalankan service berbasis socket Baileys yang terhubung langsung ke WhatsApp Web via scan QR Code nomor pengirim sekolah.
     - *Kelebihan*: 100% gratis tanpa biaya per pesan/token.
     - *Tantangan*: Butuh server/VPS yang standby 24 jam dan rentan terputus sesi login jika nomor WhatsApp sering disconnect.
  3. **Opsi C - WhatsApp Business Cloud API Resmi (Meta Graph API)**:
     - *Cara Kerja*: Menggunakan webhook dan API resmi Meta for Developers.
     - *Kelebihan*: Sangat stabil dan resmi (centang hijau).
     - *Tantangan*: Memerlukan verifikasi bisnis dan template pesan harus disetujui Meta.

- **Pemicu Notifikasi (Trigger Events) yang Telah Dirancang**:
  - **Trigger 1 (Masuk Pagi)**: Konfirmasi jam tap hadir tepat waktu ke nomor wali murid.
  - **Trigger 2 (Keterlambatan & Poin)**: Notifikasi menit telat, rincian potongan poin (-2P, -3P, -5P, -30P, -40P), sisa poin kedisiplinan, dan peringatan jika poin < 10.
  - **Trigger 3 (Kepulangan KBM)**: Konfirmasi tap pulang bahwa siswa telah meninggalkan sekolah.
  - **Trigger 4 (Pelanggaran Bolos)**: Peringatan keras saat siswa hadir pagi namun tidak absen pulang (-10 poin).
  - **Trigger 5 (Persetujuan Izin)**: Konfirmasi resmi saat izin belajar siswa disetujui oleh guru/sekolah.

- **Aset & Fondasi yang Sudah Tersedia di Kode Sumber**:
  - Validasi ketat nomor telepon seluler Indonesia (10–13 digit) pada tabel `students`.
  - Struktur konfigurasi template tersimpan di [`src/utils/settingsStorage.ts`](file:///home/ubuntu/school-attendance-web/src/utils/settingsStorage.ts).
  - Modul helper pengiriman di [`src/utils/whatsappNotification.ts`](file:///home/ubuntu/school-attendance-web/src/utils/whatsappNotification.ts).
  - Endpoint pengujian koneksi di [`src/pages/api/whatsapp/test.ts`](file:///home/ubuntu/school-attendance-web/src/pages/api/whatsapp/test.ts).

---

## 13. Implementasi 3 Fitur Utama (Rekap Resmi, Cron Worker 23:00 WIB, & Firmware ESP32)

### 📄 1. Ekspor & Cetak Laporan Presensi Resmi Standar Dinas
- **Lokasi Berkas**: [`src/pages/rekapitulasi.astro`](file:///home/ubuntu/school-attendance-web/src/pages/rekapitulasi.astro)
- **Fitur Baru yang Diterapkan**:
  - **Filter Rombel / Kelas Interaktif**: Dropdown filter dinamis untuk memilih kelas spesifik (*X RPL 1, X RPL 2, XI RPL 1, XI RPL 2, XII RPL 1, XII RPL 2, X AKL 1, X AKL 2, XI AKL 1, XI AKL 2, XII AKL 1, XII AKL 2, Dewan Guru & Staf, atau Semua Rombel*).
  - **Statistik & Pratinjau Terfilter**: Kartu statistik (Hadir, Telat, Bolos, Izin, Pulang, Belum Absen) dan tabel pratinjau otomatis tersaring sesuai rombel kelas yang dipilih.
  - **Identitas Lengkap Civitas**: Kolom tabel web dan dokumen cetak menampilkan **NISN Siswa / NIP Guru** serta **Akumulasi Sisa Poin Disiplin** (misal: 100 Poin, 95 Poin, 0 Poin Terkunci, atau Pendidik).
  - **Dokumen Berita Acara Siap Cetak (`window.print()`)**: Format kop surat resmi SMK Ma'arif 1 Padang Ratu, nomor berita acara otomatis, sasaran rombel, stempel cap digital resmi, dan lembar tanda tangan ganda Kepala Sekolah (*H. Ahmad Fauzi, S.Pd., M.M.*) dan Waka Kesiswaan (*Wahyu Hidayat, M.Kom*).
  - **Ekspor CSV Terfilter**: Penamaan berkas unduh otomatis menyesuaikan rombel dan tanggal: `Rekap_Presensi_SMK_Maarif_[Nama_Kelas]_[Periode]_[Tanggal].csv`.
  - **Ringkasan WhatsApp Cepat**: Format teks salin cepat yang mencantumkan nama rombel terpilih dan ringkasan angka statistik.

### ⏰ 2. Background Cron Worker Mandiri 23:00 WIB
- **Lokasi Berkas**:
  - Engine Worker: [`src/utils/cronWorker.ts`](file:///home/ubuntu/school-attendance-web/src/utils/cronWorker.ts)
  - Lifecycle Inisialisasi: [`src/middleware.ts`](file:///home/ubuntu/school-attendance-web/src/middleware.ts)
  - Endpoint Status & Manual Trigger: [`src/pages/api/attendance/cron-status.ts`](file:///home/ubuntu/school-attendance-web/src/pages/api/attendance/cron-status.ts)
- **Cara Kerja**:
  - Berjalan sebagai singleton background timer in-process yang memantau waktu Indonesia Barat (`Asia/Jakarta`).
  - Setiap pukul 23:00 WIB, worker otomatis mengeksekusi `archiveAndResetDailyLogs()`:
    1. Mendeteksi siswa yang absen pagi namun tidak melakukan tap kepulangan, menandai status sebagai **Bolos**, dan memotong **10 Poin** secara otomatis.
    2. Memindahkan seluruh log harian ke tabel arsip historis (`attendance_history`).
    3. Mengosongkan tabel presensi aktif (`attendance_logs`) agar server siap bersih untuk KBM esok hari.
    4. Mengarsipkan izin yang telah kedaluwarsa.
  - Beroperasi mandiri tanpa perlu ada admin yang membuka peramban web (browser).
  - Status worker dapat dipantau realtime via endpoint `GET /api/attendance/cron-status`.

### ⚡ 3. Firmware Mikrokontroler Fisik ESP32 + RFID RC522 + LCD I2C & Solenoid Relay
- **Lokasi Berkas**:
  - Source Code Arduino/C++: [`arduino/esp32_rfid_attendance.ino`](file:///home/ubuntu/school-attendance-web/arduino/esp32_rfid_attendance.ino)
  - Panduan Wiring & Skema: [`arduino/README.md`](file:///home/ubuntu/school-attendance-web/arduino/README.md)
- **Kemampuan Hardware Terintegrasi**:
  - **Koneksi WiFi & Auto-Reconnect**: Terhubung ke jaringan lokal sekolah dengan proteksi pemulihan otomatis saat sinyal sempat terputus.
  - **Sinkronisasi Jadwal Gerbang**: Sinkron otomatis dengan batas jam operasional gerbang dari endpoint `/api/settings`.
  - **Kontrol Kunci Solenoid Gerbang (Relay GPIO 27)**: Membuka kunci magnetik/solenoid selama 2.5 detik saat presensi valid (Hadir, Telat, Pulang, Guru), dan tetap mengunci gerbang jika poin habis (0), kartu belum terdaftar, atau di luar jam KBM.
  - **Pola Suara Buzzer & LED**:
    - Hadir Tepat Waktu: 1x Beep Pendek (120ms) + LED Hijau.
    - Terlambat: 2x Beep Peringatan (100ms) + LED Merah & Hijau.
    - Poin < 10: 3x Beep Cepat Peringatan + Pesan LCD "Temui Guru".
    - Poin 0 / Ditolak (HTTP 403): 4x Beep Panjang Alarm Kritis + Gerbang Terkunci.
    - Guru: 1x Beep Pendek + Status Bebas Telat (1x sehari).
  - **Tampilan LCD I2C 16x2 / 20x4**: Menampilkan nama civitas, status presensi, sisa poin kedisiplinan, dan instruksi gerbang.



