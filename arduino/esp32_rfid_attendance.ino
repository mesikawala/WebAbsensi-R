/*
 * ============================================================================
 * SI-HADIR IoT - Firmware Mesin Presensi Mandiri Siswa & Dewan Guru
 * SMK Ma'arif 1 Padang Ratu
 * ============================================================================
 * 
 * KOMPONEN PERANGKAT KERAS (HARDWARE):
 * 1. Mikrokontroler : ESP32-WROOM-32 (DevKit V1 30-Pin / 38-Pin)
 * 2. RFID Scanner   : MFRC-522 (RC522) 13.56 MHz
 * 3. Buzzer Aktif   : KY-012 (Active Buzzer Module)
 * 4. Display Layar  : LCD 1602 HD44780 (16 Karakter x 2 Baris)
 * 5. Adaptor LCD    : Modul I2C / IIC Backpack (PCF8574)
 * 
 * ============================================================================
 * DAFTAR LIBRARY YANG DIBUTUHKAN (Install lewat Arduino IDE Library Manager):
 * ============================================================================
 * 1. "MFRC522" by GithubCommunity
 *    -> Buka Arduino IDE -> Sketch -> Include Library -> Manage Libraries...
 *    -> Cari "MFRC522" lalu klik Install.
 * 
 * 2. "LiquidCrystal I2C" by Frank de Brabander / Marco Schwartz
 *    -> Cari "LiquidCrystal I2C" lalu klik Install.
 * 
 * 3. Library Bawaan ESP32 Core (Tidak perlu install manual):
 *    -> <WiFi.h>
 *    -> <HTTPClient.h>
 *    -> <SPI.h>
 *    -> <Wire.h>
 * 
 * ============================================================================
 * SKEMA WIRING / SAMBUNGAN KABEL:
 * ============================================================================
 * [1] MFRC522 RFID READER -> ESP32-WROOM-32
 *     - 3.3V    -> Pin 3V3 (PERINGATAN: WAJIB 3.3V, JANGAN KE 5V!)
 *     - GND     -> Pin GND
 *     - RST     -> GPIO 4  (D4)
 *     - SDA/SS  -> GPIO 5  (D5)
 *     - SCK     -> GPIO 18 (D18)
 *     - MISO    -> GPIO 19 (D19)
 *     - MOSI    -> GPIO 23 (D23)
 * 
 * [2] LCD 1602 DENGAN MODUL I2C -> ESP32-WROOM-32
 *     - VCC     -> Pin VIN / 5V
 *     - GND     -> Pin GND
 *     - SDA     -> GPIO 21 (D21 - Default I2C SDA ESP32)
 *     - SCL     -> GPIO 22 (D22 - Default I2C SCL ESP32)
 * 
 * [3] ACTIVE BUZZER KY-012 -> ESP32-WROOM-32
 *     - Pin S (Signal) -> GPIO 13 (D13)
 *     - Pin - (GND)    -> Pin GND
 * 
 * ============================================================================
 * FITUR UTAMA DALAM KODE INI:
 * ============================================================================
 * 1. STEP 1 (TAP KARTU) : Kartu ditempelkan -> UID RFID terbaca seketika.
 * 2. STEP 2 (DIPROSES)  : Layar menampilkan "MEMPROSES DATA..." & "Mohon Tunggu...".
 * 3. STEP 3 (SUKSES)    : 
 *    - Baris 1: NAMA SISWA bergerak (*Running Text*) jika lebih dari 16 huruf.
 *    - Baris 2: KETERANGAN STATUS (*Static*), contoh: "HADIR [06:45]" atau "TELAT 12m (-5P)".
 * 4. STEP 4 (ANTI-MACET): Menggunakan NON-BLOCKING millis() (Tanpa delay()). 
 *    Jika ada siswa baru menempelkan kartu saat nama siswa lama belum selesai,
 *    layar LANGSUNG MENIMPA dengan proses siswa yang baru!
 * 5. STEP 5 (STANDBY)   : Saat tidak ada yang absen, LCD memunculkan animasi mata
 *    lirik kanan-kiri dan wajah senyum ramah.
 * ============================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ============================================================================
// PANDUAN CEPAT UNTUK PENGEMBANG / TEMAN:
// ============================================================================
// Ada 3 HAL UTAMA yang biasanya WAJIB disesuaikan sebelum sketch di-upload:
// 1. WIFI_SSID & WIFI_PASSWORD : Nama hotspot WiFi dan password tempat mesin dipasang.
// 2. SERVER_URL                : Alamat IP Komputer/Server web aplikasi SI-HADIR.
// 3. LCD_ADDR                  : Alamat modul I2C LCD (Standar: 0x27, beberapa modul: 0x3F).
//
// CATATAN TROUBLESHOOTING LAYAR LCD:
// - Jika layar menyala biru/hijau tapi teks TIDAK MUNCUL sama sekali (atau hanya kotak hitam):
//   1. Putar baut potensiometer/trimpot kecil berwarna biru di belakang modul I2C LCD menggunakan obeng kecil untuk mengatur ketajaman/kontras.
//   2. Jika kontras sudah diputar tapi teks tetap tidak ada, ubah LCD_ADDR dari 0x27 menjadi 0x3F di baris konfigurasi bawah.
//
// LIBRARY YANG HARUS DI-DOWNLOAD (Arduino IDE -> Manage Libraries):
// - "MFRC522" by GithubCommunity
// - "LiquidCrystal I2C" by Frank de Brabander atau Marco Schwartz
// ============================================================================

// ============================================================================
// 1. PENGATURAN KONEKSI WIFI & ALAMAT SERVER [SESUAIKAN DI SINI]
// ============================================================================
// [1A] Ganti dengan nama WiFi (SSID) dan Password hotspot HP / router sekolah:
const char* WIFI_SSID     = "Mess";
const char* WIFI_PASSWORD = "kosekkosek";

// [1B] Alamat Endpoint API Presensi SI-HADIR:
// LOCALHOST hanya untuk aplikasi yang berjalan di laptop itu sendiri.
// ESP32 tidak bisa memakai localhost untuk mengakses laptop.
const String LOCALHOST_URL = "http://localhost:4321/api/attendance";

// Alamat IP LAN laptop/server. ESP32 dan laptop harus berada di jaringan yang sama.
const String NETWORK_URL = "http://192.168.1.5:4321/api/attendance";

// Alamat server online (ganti dengan domain Vercel milikmu).
const String VERCEL_URL = "https://nama-project-kamu.vercel.app/api/attendance";

// Pilih metode pengiriman:
// SEND_NETWORK  = server lokal melalui IP LAN
// SEND_VERCEL   = server online Vercel
// SEND_FALLBACK = coba Vercel, jika gagal lanjut ke server LAN
enum SendMethod {
  SEND_NETWORK,
  SEND_VERCEL,
  SEND_FALLBACK
};

//Ganti Metode nya disini
const SendMethod ACTIVE_SEND_METHOD = SEND_NETWORK;

// ============================================================================
// 2. KONFIGURASI PIN & ALAMAT HARDWARE [SESUAIKAN JIKA PERLU]
// ============================================================================
#define SS_PIN       5    // Pin SDA / SS pada Modul MFRC522
#define RST_PIN      22   // Pin RST pada Modul MFRC522
#define BUZZER_PIN   4    // Pin sinyal buzzer

// [2A] Alamat I2C Layar LCD 1602:
// Alamat default pabrik untuk chip PCF8574T adalah 0x27
#define LCD_ADDR     0x27 
// CATATAN: Jika LCD tetap tidak muncul tulisan (setelah trimpot kontras diputar),
// matikan tanda komentar di bawah ini dan ubah ke 0x3F (untuk chip PCF8574AT):
// #define LCD_ADDR     0x3F 

#define LCD_COLS     16   // Jumlah kolom LCD (16 karakter)
#define LCD_ROWS     2    // Jumlah baris LCD (2 baris)

LiquidCrystal_I2C lcd(LCD_ADDR, LCD_COLS, LCD_ROWS);
MFRC522 rfid(SS_PIN, RST_PIN);

// ============================================================================
// 3. PIKSEL KARAKTER KHUSUS (CUSTOM GLYPHS UNTUK ANIMASI MATA & SENYUM)
// ============================================================================
// Mata Lirik Tengah (•)
byte glyphEyeCenter[8] = {
  B00000,
  B01110,
  B10001,
  B10101,
  B10001,
  B01110,
  B00000,
  B00000
};

// Mata Lirik Kiri (• )
byte glyphEyeLeft[8] = {
  B00000,
  B01110,
  B11001,
  B11001,
  B10001,
  B01110,
  B00000,
  B00000
};

// Mata Lirik Kanan ( •)
byte glyphEyeRight[8] = {
  B00000,
  B01110,
  B10011,
  B10011,
  B10001,
  B01110,
  B00000,
  B00000
};

// Mata Senyum (^)
byte glyphEyeSmile[8] = {
  B00000,
  B00100,
  B01010,
  B10001,
  B00000,
  B00000,
  B00000,
  B00000
};

// Mulut Senyum (Smile)
byte glyphMouthSmile[8] = {
  B00000,
  B00000,
  B00000,
  B10001,
  B10001,
  B01110,
  B00000,
  B00000
};

// ============================================================================
// 4. VARIABEL KONTROL STATE MACHINE (NON-BLOCKING DENGAN millis())
// ============================================================================
enum MachineState {
  STATE_STANDBY,     // Mode standby menampilkan animasi mata & senyum
  STATE_PROCESSING,  // Sedang kirim HTTP ke server
  STATE_DISPLAY_NAME // Menampilkan nama siswa (running text) & status hadir/telat
};

MachineState currentState = STATE_STANDBY;

// Data hasil absensi siswa saat ini
String currentStudentName = "";
String currentStatusLine  = "";

// Timer untuk animasi running text (teks berjalan)
unsigned long lastScrollMillis = 0;
const unsigned long SCROLL_INTERVAL = 280; // Geser per 280 milidetik
int scrollIndex = 0;

// Timer untuk kembali ke Standby setelah selesai absensi
unsigned long displayDoneStartMillis = 0;
const unsigned long DISPLAY_HOLD_TIME = 4500; // Tampilkan nama selama 4.5 detik jika tidak ada yang tap

// Timer untuk animasi mata standby
unsigned long lastIdleAnimMillis = 0;
const unsigned long IDLE_ANIM_INTERVAL = 1400; // Ganti lirikan setiap 1.4 detik
int idleFrame = 0;

// Proteksi anti-dobel baca kartu yang sama persis
String lastScannedUID = "";
unsigned long lastScanMillis = 0;
const unsigned long COOLDOWN_SAME_CARD = 2500; // Cooldown 2.5 detik untuk kartu yang sama

// ============================================================================
// 5. HELPER NADA BUZZER KY-012 (BEEP NOTIFIKASI)
// ============================================================================
void beepBeep(int count, int onTime, int offTime) {
  for (int i = 0; i < count; i++) {
    digitalWrite(BUZZER_PIN, LOW);   // Buzzer ON (active-low), sesuai kode acuan
    delay(onTime);
    digitalWrite(BUZZER_PIN, HIGH);  // Buzzer OFF
    if (i < count - 1) delay(offTime);
  }
}

// ============================================================================
// 6. HELPER PARSING JSON RINGAN (Tanpa butuh library JSON berat di ESP32)
// ============================================================================
String extractJsonValue(String json, String key) {
  String searchKey = "\"" + key + "\":\"";
  int startIdx = json.indexOf(searchKey);
  if (startIdx != -1) {
    startIdx += searchKey.length();
    int endIdx = json.indexOf("\"", startIdx);
    if (endIdx != -1) return json.substring(startIdx, endIdx);
  }
  // Cek jika nilainya angka / tanpa kutip
  searchKey = "\"" + key + "\":";
  startIdx = json.indexOf(searchKey);
  if (startIdx != -1) {
    startIdx += searchKey.length();
    int endIdx = json.indexOf(",", startIdx);
    if (endIdx == -1) endIdx = json.indexOf("}", startIdx);
    if (endIdx != -1) {
      String val = json.substring(startIdx, endIdx);
      val.trim();
      return val;
    }
  }
  return "";
}

// ============================================================================
// 7. FUNGSI TAMPILAN LCD: ANIMASI STANDBY (MATA LIRIK & SENYUM)
// ============================================================================
void drawIdleFace(int frame) {
  lcd.clear();
  
  // Baris 1: Posisi Mata di tengah kolom (Kolom 4 s/d 11)
  lcd.setCursor(4, 0);
  lcd.print("(");
  
  if (frame == 0) {
    // Mata Lirik Kiri
    lcd.write(1); // Eye Left
    lcd.print("   ");
    lcd.write(1);
    lcd.print(")");
    lcd.setCursor(7, 1);
    lcd.write(4); // Mulut Senyum
  } 
  else if (frame == 1) {
    // Mata Tengah
    lcd.write(0); // Eye Center
    lcd.print("   ");
    lcd.write(0);
    lcd.print(")");
    lcd.setCursor(7, 1);
    lcd.write(4);
  } 
  else if (frame == 2) {
    // Mata Lirik Kanan
    lcd.write(2); // Eye Right
    lcd.print("   ");
    lcd.write(2);
    lcd.print(")");
    lcd.setCursor(7, 1);
    lcd.write(4);
  } 
  else {
    // Mata Senyum Ramah (Happy)
    lcd.write(3); // Eye Smile (^)
    lcd.print("   ");
    lcd.write(3);
    lcd.print(")");
    lcd.setCursor(0, 1);
    lcd.print("SMK MA'ARIF 1 PR");
  }
}

// ============================================================================
// 8. FUNGSI RUNNING TEXT NAMA SISWA (BARIS 1) & STATUS (BARIS 2)
// ============================================================================
void updateRunningText() {
  // Jika nama siswa 16 huruf atau kurang: Tampilkan langsung tanpa digeser
  if (currentStudentName.length() <= LCD_COLS) {
    lcd.setCursor(0, 0);
    String line = currentStudentName;
    while (line.length() < LCD_COLS) line += " ";
    lcd.print(line);
  } 
  // Jika nama siswa panjang (> 16 karakter): Geser teks per karakter
  else {
    String paddedName = currentStudentName + "    *    " + currentStudentName;
    int maxIndex = currentStudentName.length() + 9;
    
    String visibleText = paddedName.substring(scrollIndex, scrollIndex + LCD_COLS);
    lcd.setCursor(0, 0);
    lcd.print(visibleText);
    
    scrollIndex++;
    if (scrollIndex >= maxIndex) {
      scrollIndex = 0;
    }
  }

  // Baris 2 selalu menampilkan status kehadiran tetap (Static)
  lcd.setCursor(0, 1);
  String line2 = currentStatusLine;
  while (line2.length() < LCD_COLS) line2 += " ";
  lcd.print(line2);
}

// Deklarasi awal fungsi pengiriman (implementasi berada setelah processCardAttendance).
bool sendToLocalhost(String uid, String &responseBody);
bool sendToVercel(String uid, String &responseBody);
bool sendWithFallback(String uid, String &responseBody);
bool sendAttendanceData(String uid, String &responseBody);

// ============================================================================
// 9. PROSES TRANSAKSI KE SERVER API (/api/attendance)
// ============================================================================
void processCardAttendance(String uid) {
  // Set state langsung ke PROCESSING
  currentState = STATE_PROCESSING;
  
  // Tampilkan feedback seketika di LCD
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("MEMPROSES KARTU.");
  lcd.setCursor(0, 1);
  lcd.print("ID: " + uid.substring(0, 9));

  // Cek koneksi WiFi
  if (WiFi.status() != WL_CONNECTED) {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WIFI TERPUTUS!");
    lcd.setCursor(0, 1);
    lcd.print("Menghubungkan...");
    beepBeep(3, 100, 100);
    WiFi.reconnect();
    currentState = STATE_STANDBY;
    return;
  }

  // Kirim UID menggunakan metode yang dipilih pada ACTIVE_SEND_METHOD.
  // Response body tetap disimpan untuk diproses dan ditampilkan pada LCD.
  String response = "";
  bool sendSuccess = sendAttendanceData(uid, response);

  if (sendSuccess) {
    Serial.println("[HTTP BODY]: " + response);

    String status = extractJsonValue(response, "status");
    String name   = extractJsonValue(response, "name");
    String timeStr   = extractJsonValue(response, "time");
    String message   = extractJsonValue(response, "message");
    String pointsStr = extractJsonValue(response, "points");
    int points = pointsStr.length() > 0 ? pointsStr.toInt() : 100;

    // Bersihkan nama jika kosong
    if (name.length() == 0) {
      name = "Siswa Civitas";
    }

    // ====================================================
    // KASUS A: SUKSES (HTTP 200)
    // ====================================================
    if (status == "success") {
      currentStudentName = name;
      scrollIndex = 0;

      // Status 1: TEPAT WAKTU (HADIR)
      if (response.indexOf("\"status\":\"Hadir\"") != -1 || response.indexOf("Tepat Waktu") != -1) {
        currentStatusLine = "HADIR [" + (timeStr.length() >= 5 ? timeStr.substring(0, 5) : "07:00") + "]";
        beepBeep(1, 150, 0); // 1x Beep Berhasil
      }
      // Status 2: TERLAMBAT
      else if (response.indexOf("\"status\":\"Terlambat\"") != -1 || response.indexOf("Terlambat") != -1) {
        currentStatusLine = "TELAT: Sisa " + String(points) + "P";
        beepBeep(2, 120, 80); // 2x Beep Peringatan Telat
      }
      // Status 3: PULANG
      else {
        currentStatusLine = "PULANG [" + (timeStr.length() >= 5 ? timeStr.substring(0, 5) : "13:30") + "]";
        beepBeep(1, 200, 0);
      }

      // Alihkan state ke DISPLAY_NAME untuk memulai teks berjalan
      currentState = STATE_DISPLAY_NAME;
      displayDoneStartMillis = millis();
      lastScrollMillis = millis();
      lcd.clear();
      updateRunningText();
    }
    // ====================================================
    // KASUS B: WARNING (Double-Tap)
    // ====================================================
    else if (status == "warning") {
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print(name.substring(0, LCD_COLS));
      lcd.setCursor(0, 1);
      lcd.print("SUDAH ABSEN HARI INI");
      beepBeep(2, 100, 80);
      
      currentStudentName = name;
      currentStatusLine  = "SDH ABSEN HARI INI";
      currentState = STATE_DISPLAY_NAME;
      displayDoneStartMillis = millis();
    }
    // ====================================================
    // KASUS C: ERROR / DITOLAK (Kartu belum terdaftar / Gerbang Tutup)
    // ====================================================
    else {
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("AKSES DITOLAK!");
      lcd.setCursor(0, 1);
      
      if (message.indexOf("belum terdaftar") != -1) {
        lcd.print("Kartu Tdk Dikenal");
      } else if (message.indexOf("belum dibuka") != -1) {
        lcd.print("Gerbang Belum Buka");
      } else if (message.indexOf("Poin 0") != -1) {
        lcd.print("POIN 0! TEMUI GURU");
      } else {
        lcd.print("Data Tidak Cocok");
      }

      beepBeep(3, 200, 100); // 3x Beep Nada Gagal
      currentState = STATE_DISPLAY_NAME;
      displayDoneStartMillis = millis() - 1500; // Tampilkan pesan error lebih cepat
    }
  } else {
    // Gagal kirim ke server (Koneksi putus / Server Down)
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("SERVER ERROR!");
    lcd.setCursor(0, 1);
    lcd.print("Periksa Jaringan");
    beepBeep(4, 80, 60);
    currentState = STATE_STANDBY;
  }

}

// ============================================================================
// MODUL FUNGSI PENGIRIMAN MULTI-SERVER
// ============================================================================

// Nama fungsi dipertahankan mengikuti file acuan.
// Fungsi ini mengirim ke server lokal melalui IP LAN (NETWORK_URL).
// Jangan gunakan LOCALHOST_URL dari ESP32: "localhost" menunjuk ke ESP32 itu sendiri.
bool sendToLocalhost(String uid, String &responseBody) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[LOCAL] WiFi belum terhubung!");
    return false;
  }

  HTTPClient http;
  http.begin(NETWORK_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(4500);

  String payload = "{\"uid\":\"" + uid + "\"}";
  Serial.println("\n[LOCAL] Mengirim ke server LAN: " + NETWORK_URL);

  int httpCode = http.POST(payload);
  Serial.printf("[LOCAL] Status Code: %d\n", httpCode);

  bool success = (httpCode >= 200 && httpCode < 300);
  if (httpCode > 0) {
    responseBody = http.getString();
    Serial.println("[LOCAL] Response Body: " + responseBody);
  } else {
    Serial.printf("[LOCAL] Gagal terhubung: %s\n",
                  http.errorToString(httpCode).c_str());
  }

  http.end();
  return success;
}

// Mengirim ke server online Vercel melalui HTTPS.
bool sendToVercel(String uid, String &responseBody) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[VERCEL] WiFi belum terhubung!");
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Untuk pengujian; validasi sertifikat lebih aman untuk produksi.

  HTTPClient http;
  http.begin(client, VERCEL_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(6000);

  String payload = "{\"uid\":\"" + uid + "\"}";
  Serial.println("\n[VERCEL] Mengirim ke: " + VERCEL_URL);

  int httpCode = http.POST(payload);
  Serial.printf("[VERCEL] Status Code: %d\n", httpCode);

  bool success = (httpCode >= 200 && httpCode < 300);
  if (httpCode > 0) {
    responseBody = http.getString();
    Serial.println("[VERCEL] Response Body: " + responseBody);
  } else {
    Serial.printf("[VERCEL] Gagal terhubung: %s\n",
                  http.errorToString(httpCode).c_str());
  }

  http.end();
  return success;
}

// Fallback: coba Vercel terlebih dahulu, lalu server LAN jika Vercel gagal.
bool sendWithFallback(String uid, String &responseBody) {
  Serial.println("\n[SYNC] Memulai pengiriman dengan sistem Fallback...");

  Serial.println("[SYNC] [1/2] Mencoba Vercel...");
  if (sendToVercel(uid, responseBody)) {
    Serial.println("[SYNC] Sukses melalui Vercel.");
    return true;
  }

  Serial.println("[SYNC] Vercel gagal. Mencoba server LAN...");
  responseBody = "";
  if (sendToLocalhost(uid, responseBody)) {
    Serial.println("[SYNC] Sukses melalui server LAN.");
    return true;
  }

  Serial.println("[SYNC] ERROR: Vercel dan server LAN gagal dihubungi.");
  return false;
}

// Satu pintu pengiriman data. Ubah ACTIVE_SEND_METHOD di konfigurasi
// untuk mengganti metode tanpa mengubah processCardAttendance().
bool sendAttendanceData(String uid, String &responseBody) {
  responseBody = "";

  switch (ACTIVE_SEND_METHOD) {
    case SEND_NETWORK:
      Serial.println("[MODE] NETWORK / SERVER LAN");
      return sendToLocalhost(uid, responseBody);

    case SEND_VERCEL:
      Serial.println("[MODE] VERCEL");
      return sendToVercel(uid, responseBody);

    case SEND_FALLBACK:
      Serial.println("[MODE] FALLBACK (VERCEL -> NETWORK)");
      return sendWithFallback(uid, responseBody);

    default:
      Serial.println("[MODE] Metode pengiriman tidak dikenal!");
      return false;
  }
}

// ============================================================================
// 10. SETUP INISIALISASI PERANGKAT KERAS
// ============================================================================
void setup() {
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, HIGH); // Buzzer default MATI (active-low)

  // Inisialisasi SPI & RFID Reader RC522 (urutan mengikuti kode acuan yang berhasil)
  SPI.begin(18, 19, 23, 5); // SCK, MISO, MOSI, SS
  delay(50);
  rfid.PCD_Init();
  delay(50);
  rfid.PCD_AntennaOn();
  Serial.println("[RC522] Inisialisasi selesai. Versi firmware reader:");
  rfid.PCD_DumpVersionToSerial();

  // Inisialisasi I2C & Layar LCD 1602
  Wire.begin(21, 27); // SDA = GPIO 21, SCL = GPIO 27
  lcd.init();
  lcd.backlight();

  // Daftarkan Custom Characters ke Memori HD44780
  lcd.createChar(0, glyphEyeCenter);
  lcd.createChar(1, glyphEyeLeft);
  lcd.createChar(2, glyphEyeRight);
  lcd.createChar(3, glyphEyeSmile);
  lcd.createChar(4, glyphMouthSmile);

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("SMK MA'ARIF 1 PR");
  lcd.setCursor(0, 1);
  lcd.print("Inisialisasi IoT");
  beepBeep(1, 100, 0);
  delay(1200);

  // Koneksi ke Jaringan WiFi
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Menghubungkan...");
  lcd.setCursor(0, 1);
  lcd.print(String(WIFI_SSID).substring(0, LCD_COLS));

  int retry = 0;
  while (WiFi.status() != WL_CONNECTED && retry < 25) {
    delay(400);
    Serial.print(".");
    retry++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Terhubung! IP: " + WiFi.localIP().toString());
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WIFI TERHUBUNG!");
    lcd.setCursor(0, 1);
    lcd.print(WiFi.localIP().toString());
    beepBeep(2, 80, 80);
    delay(1500);
  } else {
    Serial.println("\nWiFi Gagal! Periksa Password/SSID.");
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WIFI GAGAL!");
    lcd.setCursor(0, 1);
    lcd.print("Cek Pengaturan");
    beepBeep(3, 150, 100);
    delay(2000);
  }

  // Siap Masuk ke Mode Standby Pertama Kali
  currentState = STATE_STANDBY;
  drawIdleFace(1);
}

// ============================================================================
// 11. LOOP UTAMA: NON-BLOCKING (ANTI-MACET & BISA LANGSUNG MENIMPA SISWA BARU)
// ============================================================================
void loop() {
  unsigned long now = millis();

  // --------------------------------------------------------------------------
  // BAGIAN A: SCANNER RFID (Selalu dipindai di setiap milidetik)
  // --------------------------------------------------------------------------
  // KUNCI FITUR NOMOR 4:
  // Walaupun nama siswa sebelumnya belum selesai bergeser di layar, jika ada
  // kartu siswa baru yang menempel, pembacaan ini LANGSUNG BERHASIL dan
  // LANGSUNG MEMUTUS animasi siswa lama untuk memproses siswa baru!
  // --------------------------------------------------------------------------
  if (rfid.PICC_IsNewCardPresent()) {
    Serial.println("[RC522] Kartu terdeteksi, membaca UID...");

    if (!rfid.PICC_ReadCardSerial()) {
      Serial.println("[RC522] Gagal membaca UID. Coba posisikan ulang kartu.");
      return;
    }
    
    // Baca UID Kartu ke Format Heksadesimal Bersih
    String rawUid = "";
    for (byte i = 0; i < rfid.uid.size; i++) {
      if (rfid.uid.uidByte[i] < 0x10) rawUid += "0";
      rawUid += String(rfid.uid.uidByte[i], HEX);
    }
    rawUid.toUpperCase();

    // Hitung juga UID Desimal Kartu (Mifare 4 Byte)
    unsigned long uidDec = 0;
    for (byte i = 0; i < rfid.uid.size; i++) {
      uidDec = (uidDec << 8) | rfid.uid.uidByte[i];
    }
    String decimalUidStr = String(uidDec);

    String sakHex = String(rfid.uid.sak, HEX);
    if (sakHex.length() < 2) sakHex = "0" + sakHex;
    sakHex.toUpperCase();

    MFRC522::PICC_Type piccType = rfid.PICC_GetType(rfid.uid.sak);
    String typeName = rfid.PICC_GetTypeName(piccType);

    Serial.println("\\n-------------------------------------------");
    Serial.println(">> KARTU DITEMPELKAN!");
    Serial.println("UID Hex     : " + rawUid);
    Serial.println("UID Decimal : " + decimalUidStr);
    Serial.print  ("UID Size    : ");
    Serial.print(rfid.uid.size);
    Serial.println(" byte");
    Serial.println("SAK         : 0x" + sakHex);
    Serial.println("Tipe Kartu  : " + typeName);
    Serial.println("-------------------------------------------");

    // Proteksi cooldown untuk kartu yang sama (mencegah spam terbaca berkali-kali)
    if (decimalUidStr == lastScannedUID && (now - lastScanMillis) < COOLDOWN_SAME_CARD) {
      Serial.println(">> Cooldown: Kartu yang sama baru saja di-tap.");
    } else {
      lastScannedUID = decimalUidStr;
      lastScanMillis = now;

      // LANGSUNG PROSES SISWA INI (Teks lama otomatis terputus!)
      processCardAttendance(decimalUidStr);
    }

    // Selesai transaksi kartu ini pada sensor
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    return;
  }

  // --------------------------------------------------------------------------
  // BAGIAN B: LOGIKA TAMPILAN LCD SESUAI STATE (NON-BLOCKING)
  // --------------------------------------------------------------------------

  // STATE 1: SEDANG MENAMPILKAN NAMA SISWA (RUNNING TEXT)
  if (currentState == STATE_DISPLAY_NAME) {
    // Geser teks berjalan setiap interval SCROLL_INTERVAL
    if (now - lastScrollMillis >= SCROLL_INTERVAL) {
      lastScrollMillis = now;
      updateRunningText();
    }

    // Jika waktu tayang sudah habis (4.5 detik) dan tidak ada siswa baru:
    // Kembalikan layar ke mode animasi Standby
    if (now - displayDoneStartMillis >= DISPLAY_HOLD_TIME) {
      currentState = STATE_STANDBY;
      idleFrame = 0;
      drawIdleFace(idleFrame);
      lastIdleAnimMillis = now;
    }
  }

  // STATE 2: MODE STANDBY (ANIMASI MATA LIRIK & SENYUM)
  else if (currentState == STATE_STANDBY) {
    // Ganti lirikan mata setiap IDLE_ANIM_INTERVAL (1.4 detik)
    if (now - lastIdleAnimMillis >= IDLE_ANIM_INTERVAL) {
      lastIdleAnimMillis = now;
      idleFrame = (idleFrame + 1) % 4; // Berputar 0 -> 1 -> 2 -> 3 -> 0
      drawIdleFace(idleFrame);
    }
  }
}
