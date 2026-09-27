# Nekumi - Streaming Anime Subtitle Indonesia 🎬✨

Platform streaming anime modern dengan antarmuka elegan, cepat, dan responsif. Dilengkapi fitur otentikasi user, bookmark/riwayat tontonan, komentar/reaksi komunitas, dan scraper multi-provider (Kuramanime & Otakudesu).

---

## 🚀 Fitur Utama

- **Catalog & Pencarian Anime**: Update anime ongoing, completed, genre filter, jadwal rilis, serta batch download.
- **Video Player**: Pemutar video responsif dengan resolusi 360p, 480p, 720p, hingga 1080p.
- **Sistem Pengguna**:
  - Pendaftaran & Login dengan verifikasi kode OTP via Email (Resend / SMTP Nodemailer).
  - Lupa password & reset password yang aman.
  - Profil pengguna, avatar, dan badge status.
- **Interaksi Komunitas**:
  - Komentar per episode dengan pagination & nested replies.
  - Like, Dislike, dan reaksi emoji interaktif.
- **Bookmark & History**: Simpan anime favorit dan lanjutkan tontonan terakhir.
- **Desain Modern**: Tema gelap (Dark theme) dengan sentuhan glassmorphism, mobile-friendly, dan animasi halus.

---

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: SQLite3 via `better-sqlite3`
- **Scraper / Parsers**: Cheerio, Axios / Fetch
- **Authentication**: JSON Web Token (JWT) & bcryptjs
- **Email Service**: Resend SDK & Nodemailer (SMTP)
- **Frontend**: Vanilla HTML5, CSS3, & Modern JavaScript (ES6+)

---

## 📦 Instalasi & Menjalankan Lokal

1. **Clone repository**:
   ```bash
   git clone https://github.com/satriya4Get/Nekumi.git
   cd Nekumi
   ```

2. **Install dependensi**:
   ```bash
   npm install
   ```

3. **Konfigurasi Environment**:
   Salin `.env.example` menjadi `.env` lalu sesuaikan konfigurasi:
   ```bash
   cp .env.example .env
   ```

4. **Jalankan aplikasi**:
   - Mode Development (watch mode):
     ```bash
     npm run dev
     ```
   - Mode Production:
     ```bash
     npm start
     ```

5. **Buka di browser**:
   Akses `http://localhost:3000`

---

## 📄 Lisensi
ISC License
