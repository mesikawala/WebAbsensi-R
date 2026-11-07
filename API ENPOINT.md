# DOKUMENTASI LENGKAP API ENDPOINT
**SMK Ma'arif 1 Padang Ratu — Sistem Presensi & Disiplin IoT Berbasis RFID**

Dokumen ini memuat seluruh spesifikasi antarmuka pemrograman aplikasi (API Endpoint) yang aktif di dalam sistem.

---

# BAGIAN 1: ENDPOINT YANG LANGSUNG BERHUBUNGAN DENGAN MESIN IOT
*(Digunakan oleh Mikrokontroler ESP32, USB RFID Reader, Scanner Gerbang, dan Papan Informasi Realtime)*

---

### 1. `POST /api/attendance` (Perekam Tap Kartu RFID Mesin IoT)
Endpoint utama tempat mesin mikrokontroler (ESP32/Arduino) mengirimkan data hasil pembacaan kartu fisik siswa atau guru di gerbang sekolah.

* **Fungsi Utama**:
  1. Menerima data *tap* kartu dari alat IoT.
  2. Menjalankan filter otomatis `extractDecimalUid` untuk membuang teks *Hex*, *SAK*, dan tipe kartu sehingga **hanya mengambil 9 digit desimal** nomor kartu fisik.
  3. Mengidentifikasi data siswa dan rombel kelas di database Turso.
  4. Memeriksa jadwal operasional gerbang (Jam Buka, Jam Masuk/Keterlambatan, dan Jam Kepulangan).
  5. Menentukan status kehadiran: **`Hadir`**, **`Terlambat`**, atau **`Pulang`**.
  6. Mengurangi poin kedisiplinan secara otomatis jika siswa datang terlambat.
  7. Mencegah *Double-Tap* (siswa yang menempelkan kartu dua kali dalam sesi yang sama).
  8. Memancarkan event seketika ke seluruh antarmuka web melalui Server-Sent Events (SSE).

* **Format Header**:
  * `Content-Type: application/json` ATAU `Content-Type: text/plain`

* **Contoh Format Data yang Didukung**:

  **A. Kiriman Teks Mentah / Serial Dump dari Mesin Scanner (`text/plain`):**
  ```text
  UID Hex     : AB 12 D7 06
     UID Decimal : 171182156
     UID Size    : 4 byte
     SAK         : 0x08
     Tipe Kartu  : MIFARE 1K
  ```
  *(Sistem otomatis menyaring dan hanya mengambil `171182156`)*.

  **B. Kiriman Format Standar JSON (`application/json`):**
  ```json
  {
    "uid": "171182156"
  }
  ```

* **Contoh Respons Berhasil (Hadir Tepat Waktu):**
  ```json
  {
    "status": "success",
    "message": "Presensi Masuk Tepat Waktu (Muhammad Farhan)",
    "data": {
      "id": "ATT-1793854855302",
      "rfidUid": "171182156",
      "name": "Muhammad Farhan",
      "className": "X RPL",
      "role": "siswa",
      "date": "2026-11-06",
      "time": "06:45:00",
      "type": "masuk",
      "status": "Hadir"
    },
    "points": 100,
    "deduction": null
  }
  ```

* **Contoh Respons Keterlambatan (Poin Berkurang):**
  ```json
  {
    "status": "success",
    "message": "Presensi Masuk Terlambat (Muhammad Farhan) - Telat 12 menit. Poin berkurang -5 (Sisa 95 Poin).",
    "data": {
      "status": "Terlambat"
    },
    "points": 95,
    "deduction": {
      "pointsDeducted": 5,
      "reason": "Terlambat 12 menit pada sesi pagi (Kategori 10 - 20 menit: -5 Poin)"
    }
  }
  ```

* **Contoh Respons Penolakan (Kartu Belum Terdaftar):**
  ```json
  {
    "status": "error",
    "message": "ID/UID 999888777 belum terdaftar di sistem"
  }
  ```

---

### 2. `GET /api/attendance-stream` (Jalur Real-Time Server-Sent Events / SSE)
Jalur komunikasi satu arah berkecepatan tinggi (*persistent stream*) dari server web ke layar monitor sekolah, dashboard ruang guru, atau display gerbang.

* **Fungsi Utama**:
  * Mengirimkan notifikasi seketika begitu ada kartu yang berhasil di-*tap* pada mesin gerbang.
  * Memungkinkan layar dashboard menampilkan nama dan foto siswa secara *real-time* tanpa perlu me-*refresh* browser.
* **Header**:
  * `Content-Type: text/event-stream`
  * `Cache-Control: no-cache`
* **Format Event Stream**:
  ```text
  event: attendance
  data: {"type":"new_log","log":{"name":"Muhammad Farhan","className":"X RPL","status":"Hadir","time":"06:45:00"}}
  ```

---

================================================================================
================================================================================

---

# BAGIAN 2: KESELURUHAN ENDPOINT FITUR & SISTEM WEB
*(Digunakan untuk Autentikasi Pengguna, Manajemen Siswa/Guru, Perizinan, Poin, Rekapitulasi, dan Jadwal)*

---

### 3. `POST /api/auth/login` (Autentikasi Portal Siswa & Dewan Guru)
Endpoint verifikasi masuk ke portal akademik mandiri.
* **Fungsi**: Memvalidasi identitas pengguna.
* **Aturan Validasi**: Wajib mengisi **Nama Lengkap** DAN **ID Kartu RFID**. Keduanya harus cocok pada satu data siswa yang sama (penggunaan NISN untuk login ditolak).
* **Payload**:
  ```json
  {
    "name": "Muhammad Farhan",
    "rfidUid": "171182156"
  }
  ```
* **Respons**: Mengembalikan data sesi civitas, peran (`siswa`, `guru`, atau `admin`), dan URL pengalihan.

---

### 4. `GET, POST, DELETE /api/students` (Manajemen Master Civitas)
Endpoint pengelolaan data siswa, dewan guru, dan administrator sekolah.
* **`GET /api/students`**: Mengambil daftar seluruh civitas yang aktif terdaftar.
* **`POST /api/students`**: Mendaftarkan siswa mandiri atau menambahkan civitas baru.
  * Validasi: Memastikan NISN dan UID RFID tidak duplikat (Error 409 jika sudah ada).
  * Pemfilteran: Otomatis membersihkan nomor kartu ke format 9 digit desimal.
* **`DELETE /api/students?id=STD-xxx`**: Menghapus data civitas (Akun Administrator utama dilindungi dari penghapusan).

---

### 5. `GET, POST, DELETE /api/points` (Buku Catatan Poin Kedisiplinan)
Endpoint pemantauan dan pengelolaan saldo poin pelanggaran siswa (Saldo awal: 100).
* **`GET /api/points?studentId=...&rfid=...`**: Cek sisa poin siswa, status peringatan (Aman, Kritis < 10, atau Terkunci = 0), serta riwayat pemotongan.
* **`POST /api/points`**: Mencatat sanksi pengurangan poin manual oleh Guru BP/BK.
* **`DELETE /api/points?studentId=...`**: Mereset saldo poin siswa kembali bersih ke 100 poin (setelah pembinaan/persetujuan Waka Kesiswaan).

---

### 6. `GET, POST, DELETE /api/permissions` (Pengajuan Surat Izin & Dispensasi)
Endpoint administrasi perizinan resmi sekolah (Sakit, Dispensasi Dinas, Izin Keluarga).
* **`GET /api/permissions`**: Mengambil seluruh daftar pengajuan izin dan status verifikasinya.
* **`POST /api/permissions`**:
  * Mengajukan izin baru oleh siswa/wali murid (Status awal: `Menunggu`).
  * Verifikasi status oleh guru piket/admin (`Disetujui` atau `Ditolak`).
  * Jika disetujui, sistem otomatis menyuntikkan status hadir `Izin` ke tanggal yang bersangkutan agar siswa tidak dianggap Alpa atau Bolos.
* **`DELETE /api/permissions?id=PRM-xxx`**: Membatalkan atau menghapus surat izin sekaligus membersihkan rekaman presensi terkait.

---

### 7. `GET, POST /api/attendance/bolos` (Evaluasi Siswa Bolos Otomatis)
Endpoint pemantau integritas kepulangan siswa.
* **`GET /api/attendance/bolos`**: Menampilkan daftar siswa yang absen masuk pagi tetapi belum melakukan absen pulang.
* **`POST /api/attendance/bolos`**: Mengeksekusi sanksi otomatis status **`Bolos`** dan pemotongan **-10 Poin** bagi siswa yang terbukti tidak presensi pulang tanpa izin sah.

---

### 8. `GET, POST, DELETE /api/attendance/archive` (Arsip Presensi Permanen)
Endpoint pengarsipan laporan historis presensi sekolah.
* **`GET /api/attendance/archive?filter=today|week|month|year|all`**: Mengambil riwayat arsip permanen untuk dicetak ke PDF/CSV pada menu Rekapitulasi.
* **`POST /api/attendance/archive`**: Menjalankan proses tutup buku harian dan memindahkan log harian ke tabel arsip permanen.
* **`DELETE /api/attendance/archive`**: Mengosongkan data arsip lama.

---

### 9. `GET, POST /api/attendance/cron-status` (Status Scheduler Background)
Endpoint pemantau otomasi timer sistem.
* **`GET /api/attendance/cron-status`**: Menampilkan status scheduler mandiri (target jam 17:00 WIB untuk evaluasi bolos dan jam 23:00 WIB untuk arsip harian).
* **`POST /api/attendance/cron-status`**: Menjalankan simulasi trigger manual jadwal tanpa menunggu jam target.

---

### 10. `GET, POST, DELETE /api/schedules` (Agenda Sekolah & Jadwal KBM)
Endpoint manajemen kalender akademik dan laboratorium komputer.
* **`GET /api/schedules?day=...&category=...`**: Mengambil daftar mata pelajaran kejuruan RPL, AKL, dan agenda kegiatan sekolah.
* **`POST /api/schedules`**: Menambahkan agenda baru dengan filter visibilitas (`public` untuk siswa & umum, atau `guru` untuk internal rapat guru).
* **`DELETE /api/schedules?id=...`**: Menghapus mata pelajaran atau agenda.

---

### 11. `GET, POST, DELETE /api/settings` (Konfigurasi Jam Gerbang & Sistem)
Endpoint konfigurasi parameter dinamis sekolah di database Turso.
* **`GET /api/settings`**: Mengambil konfigurasi aktif (`jamBuka`, `jamMasuk`, `jamToleransi`, `jamPulang`, serta format pesan WhatsApp).
* **`POST /api/settings`**: Memperbarui jam buka gerbang atau jam kepulangan secara instan.
* **`DELETE /api/settings`**: Mengembalikan konfigurasi jam sekolah ke pengaturan awal (*default*).

---

*Dokumentasi ini disusun dan diperbarui secara resmi untuk SMK Ma'arif 1 Padang Ratu.*

# fungsi yang harus ada di lcd

1. tab pertama id kebaca

2. kemudian di lanjut dengan text di proses

3. jikalau sudah berhsail absen maka tulisan nya adaalah yang di atas nama siswa nya dengan text bergerak, dan di bawah ada keterangan sudah absen, dan juga muncul status nya entah terlambat atau hadir

4. jikalau tulisan sudah keluar tapi tulisan di akhir belum selesai, maka ketika ada siswa absen lagi tulisan yang terahir atau yang di munculin siswa yang absen sebelum nya maka akan langsung di timpa denga text baru yaitu id siswa yang baru yang mau absen dan kalua gak ada yang absen maka lcd akan memunculkan kek mata gitu mata yang lirik kanan kiri dan muka senyum di bawah nya 

