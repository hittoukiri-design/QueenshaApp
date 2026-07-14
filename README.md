# 🛒 Toko Queensha App

Toko Queensha App adalah aplikasi Kasir dan Point of Sales (POS) cerdas yang dirancang khusus untuk memenuhi kebutuhan manajerial dan transaksi harian toko dengan arsitektur **100% Offline-First**.

Aplikasi ini memastikan operasional toko tidak akan pernah terhenti meskipun koneksi internet terputus, sekaligus menjamin keamanan dan keutuhan data melalui sistem pencadangan otomatis (Auto-Backup) multi-kanal.

## ✨ Fitur Unggulan

- 📶 **Arsitektur Offline-First**: Tetap bisa berjualan, menambah produk, dan mengubah stok tanpa koneksi internet. Semua perubahan disimpan di dalam *cache* pintar dan akan disinkronisasi ke server pusat (Firebase) diam-diam saat internet kembali menyala.
- 🔐 **Multi-Channel Backup**:
  - **Firebase Cloud Sync**: Penyimpanan data secara aman ke server *cloud* Google.
  - **Lokal & Ekspor Excel**: Rekapitulasi laporan transaksi dan produk otomatis menjadi file `.xlsx`.
  - **Google Drive Auto-Backup**: Fitur sinkronisasi latar belakang pintar yang mengamankan keseluruhan data transaksi dan stok toko langsung ke akun Google Drive pemilik secara otomatis.
- 📱 **Sistem Kasir (POS)**: Antarmuka kasir yang responsif dan dirancang untuk transaksi super cepat.
- 📦 **Manajemen Stok Otomatis**: Pemantauan inventaris barang secara cerdas dengan pencatatan riwayat masuk/keluar.

## 🛠️ Teknologi Utama

- **Frontend**: React Native & Expo (Cross-Platform Mobile App)
- **Backend & Autentikasi**: Firebase (Auth, Firestore, Cloud Storage)
- **Sistem Offline**: Custom *Sync Engine* dengan `@react-native-async-storage/async-storage`
- **Integrasi Keamanan**: `@react-native-google-signin/google-signin` (Google Drive OAuth)

## 🚀 Panduan Pengembangan

1. *Clone repository* ini ke komputer lokal Anda.
2. Lakukan instalasi paket dependensi dengan perintah `npm install`.
3. Buat file `.env` di dalam *root* proyek dan masukkan konfigurasi kunci Firebase Anda:
   ```env
   EXPO_PUBLIC_FIREBASE_API_KEY=your_api_key
   EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your_auth_domain
   EXPO_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
   EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=your_storage_bucket
   EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
   EXPO_PUBLIC_FIREBASE_APP_ID=your_app_id
   ```
4. Tambahkan file rahasia `google-services.json` Anda yang diunduh dari Firebase Console.
5. Jalankan `npx expo start` untuk mulai menguji aplikasi di simulator atau perangkat nyata.

---
*Aplikasi ini dikembangkan secara tertutup (*private*) khusus untuk mendukung operasional Toko Queensha secara profesional.*
