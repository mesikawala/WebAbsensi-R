# 🏫 SI-HADIR: Sistem Presensi & Poin Disiplin Sekolah Berbasis Kartu RFID

> **Solusi absensi pintar dan pencatatan kedisiplinan siswa & guru secara otomatis menggunakan kartu pintar RFID (seperti kartu pelajar atau e-KTP) yang terhubung langsung ke sistem web sekolah.**

---

## 💡 Apa Itu SI-HADIR?

**SI-HADIR** adalah alat absensi digital untuk sekolah. Siswa atau guru cukup menempelkan kartu (seperti kartu pelajar atau kartu khusus) ke kotak scanner di gerbang sekolah. 

Begitu kartu ditempelkan:
1. Layar di alat langsung menyapa nama siswa dan memberi tahu apakah hadir tepat waktu atau terlambat.
2. Alat mengeluarkan bunyi *beep* sebagai tanda kartu sukses terbaca.
3. Data kehadiran dan pengurangan poin (jika terlambat) langsung masuk ke layar komputer sekolah detik itu juga secara otomatis tanpa perlu dicatat manual di kertas.

---

## 🌟 Apa Saja Fitur di Dalamnya?

### 💻 1. Fitur di Aplikasi Web (Layar Komputer Sekolah)

* **Pantauan Langsung (Live Dashboard)**: Setiap kali ada siswa menempelkan kartu di gerbang, foto, nama, kelas, dan jam datangnya langsung muncul di layar tanpa perlu tekan tombol refresh.
* **Pengurangan Poin Disiplin Otomatis**: Setiap siswa memiliki modal 100 poin kedisiplinan. Jika datang terlambat, sistem otomatis menghitung berapa menit keterlambatannya dan memotong poin sesuai peraturan sekolah.
* **Kelola Data Siswa & Guru**: Menu sederhana untuk mendaftarkan nama siswa, kelas, nomor identitas, dan menghubungkannya dengan nomor kartu RFID fisik.
* **Pencatatan Izin & Sakit**: Halaman khusus untuk mencatat siswa yang izin, sakit, atau dispensasi kegiatan lomba/OSIS agar tidak dianggap alpa.
* **Atur Jadwal Gerbang**: Sekolah bisa menentukan jam berapa gerbang mulai dibuka, batas toleransi masuk pagi, dan jam gerbang pulang dibuka.
* **Cetak Laporan Siap Pakai**: Rekap kehadiran bulanan atau harian bisa langsung diunduh menjadi file PDF rapi atau file Excel (CSV) untuk laporan ke kepala sekolah/wali murid.
* **Uji Coba Virtual (Simulasi IoT)**: Ada tombol simulasi di pojok web untuk mencoba menempelkan kartu tanpa harus menyalakan alat scanner fisik terlebih dahulu.
* **Halaman Mandiri Siswa & Guru**: Siswa dan guru bisa login untuk melihat riwayat kehadiran mereka sendiri dan mengecek sisa poin disiplin masing-masing.

---

### 📟 2. Fitur di Alat Scanner (ESP32)

* **Respon Super Cepat**: Membaca kartu dalam hitungan milidetik.
* **Layar Ramah & Teks Berjalan**: 
  * Saat alat sedang diam (menunggu siswa), layar menampilkan animasi wajah mata berkedip yang ramah.
  * Saat kartu ditempelkan, nama siswa akan berjalan (*running text*) di layar LCD jika namanya panjang.
* **Bunyi Pengingat (Buzzer)**: Nada bunyi berbeda untuk setiap kondisi:
  * *1 kali bunyi pendek*: Hadir tepat waktu.
  * *2 kali bunyi*: Terlambat masuk.
  * *3 kali bunyi*: Kartu belum terdaftar / akses ditolak.
* **Anti-Macet**: Jika antrean gerbang sangat ramai, siswa berikutnya bisa langsung menempelkan kartu tanpa harus menunggu tampilan nama siswa sebelumnya selesai.
* **Sistem Cadangan Cerdas (Fallback)**: Alat bisa diatur untuk mengirim data ke server internet (cloud/Vercel). Jika internet sekolah sedang mati, alat otomatis mengalihkan pengiriman ke komputer lokal sekolah.

---

## 🛠️ Bahan-Bahan yang Dibutuhkan

Untuk membuat proyek ini, Anda membutuhkan bahan perangkat keras (hardware) dan program pendukung (software):

### 1. Komponen Perangkat Keras (Hardware)
| Komponen | Penjelasan Sederhana |
| **ESP32 DevKit V1** : Otak pemroses utama mesin yang sudah dilengkapi modul WiFi. |
| **RFID Reader RC522** : Sensor pemindai kartu RFID frekuensi 13.56 MHz. |
| **Kartu RFID / Gantungan Kunci RFID** : Kartu Mifare 1K atau kartu pelajar ber-RFID untuk dipegang siswa. |
| **Layar LCD 1602 + Modul I2C** : Layar kecil 2 baris untuk menampilkan nama siswa dan status absensi. |
| **Buzzer** : Pengeluar bunyi tanda absensi berhasil atau ditolak. |
| **Kabel Jumper (Dupont)** : Kabel-kabel kecil untuk menyambungkan antar komponen. |
| **Kabel Micro USB & Charger HP** : Untuk mengisi daya dan memasukkan program ke ESP32. |

### 2. Program Komputer (Software)
* **Node.js** (Versi 22 ke atas): Untuk menjalankan aplikasi web di komputer/laptop.
* **Arduino IDE** (Versi 2.x): Aplikasi gratis untuk memasukkan kode ke dalam chip ESP32.
* **Turso Database**: Tempat penyimpanan data siswa dan absensi berbasis cloud yang gratis dan ringan.

---

## 📚 Teknologi & Pustaka yang Digunakan

Tidak perlu bingung dengan istilah-istilah di bawah ini, ini adalah alat-alat yang dipakai pembuat program untuk membangun sistem ini:

* **Untuk Website:**
  * **Astro**: Kerangka web utama yang membuat tampilan sangat cepat dan ringan saat dibuka.
  * **Tailwind CSS**: Pengatur desain tampilan agar bersih, rapi, dan nyaman dilihat di HP maupun laptop.
  * **LibSQL (Turso)**: Tempat penyimpanan database siswa dan catatan absensi.
  * **jsPDF & AutoTable**: Pembuat file PDF otomatis untuk mencetak laporan.
  * **Server-Sent Events (SSE)**: Teknologi pengirim data kilat dari alat gerbang ke layar komputer.

* **Untuk Alat Scanner (ESP32):**
  * **MFRC522 Library**: Pustaka khusus pembaca modul RFID.
  * **LiquidCrystal I2C**: Pustaka untuk menampilkan tulisan pada layar LCD.
  * **WiFi & HTTPClient**: Fitur bawaan ESP32 untuk berkirim data lewat sinyal WiFi.

---

## 🔌 Cara Menyambungkan Kabel Komponen ke ESP32

Sebelum menyalakan alat, hubungkan kaki-kaki komponen ke ESP32 sesuai panduan berikut:

### 1. Sensor RFID RC522 $\rightarrow$ ESP32
* **3.3V (VCC)** $\rightarrow$ Pin **3V3** *(PERHATIAN: Wajib ke 3.3V, jangan ke 5V agar sensor tidak rusak)*
* **GND** $\rightarrow$ Pin **GND**
* **RST** $\rightarrow$ Pin **D22** *(atau D4 tergantung konfigurasi)*
* **SDA (SS)** $\rightarrow$ Pin **D5**
* **SCK** $\rightarrow$ Pin **D18**
* **MOSI** $\rightarrow$ Pin **D23**
* **MISO** $\rightarrow$ Pin **D19**

### 2. Layar LCD 1602 (Modul I2C) $\rightarrow$ ESP32
* **GND** $\rightarrow$ Pin **GND**
* **VCC** $\rightarrow$ Pin **VIN / 5V**
* **SDA** $\rightarrow$ Pin **D21**
* **SCL** $\rightarrow$ Pin **D27** *(atau D22)*

### 3. Buzzer $\rightarrow$ ESP32
* **Pin GND (-)** $\rightarrow$ Pin **GND**
* **Pin I/O (S)** $\rightarrow$ Pin **D4** *(atau D13)*

---

## 🚀 Langkah Pertama Menggunakan Proyek Ini

Ikuti langkah-langkah mudah di bawah ini untuk mulai menjalankan sistem:

### Langkah 1: Nyalakan Program Web di Laptop / Komputer
1. Buka folder proyek ini di laptop.
2. Buka terminal atau Command Prompt (CMD), lalu unduh semua kebutuhan web dengan mengetik:
   ```bash
   npm install
   ```
3. Siapkan file kunci database `.env` (berisi link database Turso dan token akses).
4. Nyalakan server web:
   ```bash
   npm run dev
   ```
5. Buka browser (Google Chrome) dan ketik alamat: `http://localhost:4321`. Web sudah siap digunakan!

---

### Langkah 2: Memasukkan Kode ke Alat Scanner ESP32
1. Buka aplikasi **Arduino IDE** di laptop.
2. Pasang library wajib melalui menu **Tools** $\rightarrow$ **Manage Libraries...**:
   * Cari **MFRC522** lalu klik **Install**.
   * Cari **LiquidCrystal I2C** lalu klik **Install**.
3. Buka file program alat di: [`arduino/esp32_rfid_attendance/esp32_rfid_attendance.ino`](arduino/esp32_rfid_attendance/esp32_rfid_attendance.ino).
4. Sesuaikan nama WiFi dan alamat server laptop Anda di bagian atas kode:
   ```cpp
   const char* WIFI_SSID     = "NAMA_WIFI_KAMU";
   const char* WIFI_PASSWORD = "PASSWORD_WIFI_KAMU";
   const String SERVER_URL   = "http://IP_LAPTOP_KAMU:4321/api/attendance";
   ```
5. Colokkan ESP32 ke laptop menggunakan kabel USB, pilih port COM yang sesuai, lalu klik tombol **Upload** (tanda panah ke kanan).

---

### Langkah 3: Mendaftarkan Kartu Siswa Pertama Kali
1. Tempelkan kartu RFID baru Anda ke sensor.
2. Di layar LCD alat atau di Serial Monitor Arduino akan muncul nomor kartu unik (contoh: `119849847`).
3. Buka halaman web di laptop pada menu **Siswa & Guru**.
4. Klik tombol **Tambah Siswa**, isi nama lengkap, kelas, dan tempelkan nomor kartu tersebut pada kolom **Nomor Kartu RFID**.
5. Simpan. Sekarang kartu tersebut sudah resmi milik siswa tersebut!

---

## 🏃 Cara Penggunaan Alat Sehari-Hari

1. Letakkan alat presensi di meja piket atau gerbang sekolah.
2. Sambungkan alat ke sumber listrik menggunakan charger HP atau powerbank.
3. Tunggu hingga layar menampilkan animasi mata tersenyum (artinya alat sudah terhubung ke WiFi dan siap pakai).
4. **Siswa cukup menempelkan kartu mereka**:
   * Alat berbunyi *beep*.
   * Layar LCD menyebutkan nama siswa dan status jam hadirnya.
   * Guru piket bisa langsung melihat daftar yang hadir melalui layar monitor di ruang piket.

---

<p align="center">
  Dibuat untuk mempermudah digitalisasi sekolah, meningkatkan disiplin siswa, dan menghemat penggunaan kertas laporan presensi.
</p>
