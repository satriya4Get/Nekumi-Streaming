const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./database');
const otakudesu = require('./otakudesu');
const kuramanime = require('./kuramanime');
const mailer = require('./mailer');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'aninonton_super_secret_jwt_key_2026_!@#$';

// Security Hardening & Middleware
app.disable('x-powered-by');
app.use(cors());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Brute Force Defense & Rate Limiter
const loginAttempts = new Map();
const registerAttempts = new Map();

function checkRateLimit(map, key, maxAttempts, windowMs, lockMs) {
  const now = Date.now();
  const record = map.get(key) || { count: 0, firstAttempt: now, lockedUntil: 0 };

  if (record.lockedUntil > now) {
    const waitSec = Math.ceil((record.lockedUntil - now) / 1000);
    return { allowed: false, waitSec };
  }

  if (now - record.firstAttempt > windowMs) {
    record.count = 0;
    record.firstAttempt = now;
    record.lockedUntil = 0;
  }

  return { allowed: true, record };
}

function recordFailure(map, key, maxAttempts, windowMs, lockMs) {
  const now = Date.now();
  const record = map.get(key) || { count: 0, firstAttempt: now, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= maxAttempts) {
    record.lockedUntil = now + lockMs;
  }
  map.set(key, record);
}

function clearAttempts(map, key) {
  map.delete(key);
}

// Cleanup rate limit records every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginAttempts.entries()) {
    if (now - v.firstAttempt > 600000 && v.lockedUntil < now) loginAttempts.delete(k);
  }
  for (const [k, v] of registerAttempts.entries()) {
    if (now - v.firstAttempt > 3600000 && v.lockedUntil < now) registerAttempts.delete(k);
  }
}, 900000);

// -------------------------------------------------------------
// CACHING HELPER (SQLite based, avoids Jikan API rate limits)
// -------------------------------------------------------------
function getCached(key) {
  const row = db.prepare('SELECT value, expires_at FROM api_cache WHERE key = ?').get(key);
  if (row) {
    if (Date.now() < row.expires_at) {
      try {
        return JSON.parse(row.value);
      } catch (e) {
        return null;
      }
    } else {
      db.prepare('DELETE FROM api_cache WHERE key = ?').run(key);
    }
  }
  return null;
}

function setCache(key, value, ttlSeconds = 1800) {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const str = JSON.stringify(value);
  db.prepare(`
    INSERT OR REPLACE INTO api_cache (key, value, expires_at)
    VALUES (?, ?, ?)
  `).run(key, str, expiresAt);
}

// Helper to fetch Jikan with exponential backoff & fallback
async function fetchJikan(endpoint, ttl = 1800) {
  const cacheKey = `jikan_${endpoint}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `https://api.jikan.moe/v4${endpoint}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'AniNontonStream/1.0',
        'Accept': 'application/json'
      }
    });

    if (res.status === 429) {
      console.warn(`[Jikan 429 Rate Limit] on ${endpoint}. Checking stale cache...`);
      const stale = db.prepare('SELECT value FROM api_cache WHERE key = ?').get(cacheKey);
      if (stale) return JSON.parse(stale.value);
      throw new Error('Rate limited by Jikan API. Silakan coba beberapa saat lagi.');
    }

    if (!res.ok) {
      throw new Error(`Jikan API Error: ${res.status}`);
    }

    const data = await res.json();
    setCache(cacheKey, data, ttl);
    return data;
  } catch (err) {
    console.error(`[Fetch error on ${endpoint}]:`, err.message);
    const stale = db.prepare('SELECT value FROM api_cache WHERE key = ?').get(cacheKey);
    if (stale) return JSON.parse(stale.value);
    throw err;
  }
}

// Safe Image Proxy to bypass hotlink protection & CORS on external anime CDNs
app.get('/api/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).send('Missing url parameter');

  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': imageUrl.includes('otakudesu') ? 'https://otakudesu.blog/' : 'https://myanimelist.net/'
      }
    });

    if (!response.ok) {
      return res.redirect(imageUrl);
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
  } catch (err) {
    console.warn('[Proxy Image Fallback]:', err.message);
    res.redirect(imageUrl);
  }
});

// -------------------------------------------------------------
// AUTH MIDDLEWARE
// -------------------------------------------------------------
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Akses ditolak. Token otorisasi tidak ditemukan.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (!decoded || typeof decoded.id !== 'number') {
      return res.status(401).json({ success: false, message: 'Format token otorisasi tidak valid.' });
    }

    const user = db.prepare('SELECT id, username, email, role, avatar, level, xp, episodes_watched, watch_minutes FROM users WHERE id = ?').get(decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Akun pengguna tidak ditemukan atau telah dinonaktifkan.' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Sesi otorisasi telah berakhir atau token tidak valid.' });
  }
}

function requireAdmin(req, res, next) {
  authenticate(req, res, () => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Endpoint ini khusus untuk Administrator.' });
    }
    next();
  });
}

function parseAnimeId(id) {
  if (typeof id === 'number' && !isNaN(id)) return id;
  const num = parseInt(id, 10);
  if (!isNaN(num)) return num;
  if (typeof id === 'string') {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash) + id.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) || 999999;
  }
  return 1;
}

// -------------------------------------------------------------
// AUTH ROUTES (SECURED AGAINST SQL/COMMAND/SCRIPT INJECTION & BRUTE FORCE)
// -------------------------------------------------------------
const FORBIDDEN_USERNAMES = new Set(['admin', 'administrator', 'root', 'system', 'moderator', 'nekumi', 'superuser', 'owner']);

// -------------------------------------------------------------
// CAPTCHA SYSTEM (Anti-Bot Challenge & Response)
// -------------------------------------------------------------
const captchaStore = new Map();

function generateCaptchaChallenge() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // easy to read, no ambiguous 0/O, 1/I
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
  captchaStore.set(id, { code: code.toUpperCase(), expiresAt: Date.now() + 5 * 60 * 1000 });

  // Clean expired captchas
  if (captchaStore.size > 200) {
    const now = Date.now();
    for (const [k, v] of captchaStore.entries()) {
      if (v.expiresAt < now) captchaStore.delete(k);
    }
  }

  const width = 130;
  const height = 40;
  const colors = ['#38bdf8', '#0ea5e9', '#60a5fa', '#38bdf8', '#93c5fd'];
  
  let textElements = '';
  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    const x = 14 + i * 22;
    const y = 26 + (Math.random() * 4 - 2);
    const rot = (Math.random() * 20 - 10);
    const color = colors[i % colors.length];
    textElements += `<text x="${x}" y="${y}" fill="${color}" font-size="20" font-family="'Courier New', monospace" font-weight="900" transform="rotate(${rot}, ${x}, ${y})">${char}</text>`;
  }

  let lines = '';
  for (let i = 0; i < 3; i++) {
    const y1 = Math.random() * height;
    const y2 = Math.random() * height;
    lines += `<line x1="0" y1="${y1}" x2="${width}" y2="${y2}" stroke="rgba(56, 189, 248, 0.4)" stroke-width="1.5" />`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background:#091224; border-radius:8px; border:1px solid rgba(56,189,248,0.3); display:block; user-select:none;">
    ${lines}
    ${textElements}
  </svg>`;

  return { id, svg };
}

// 1. Get Fresh CAPTCHA
app.get('/api/auth/captcha', (req, res) => {
  const challenge = generateCaptchaChallenge();
  res.json({ success: true, id: challenge.id, svg: challenge.svg });
});

// 2. Register Account with CAPTCHA
app.post('/api/auth/register', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const ipLimit = checkRateLimit(registerAttempts, `reg_ip:${ip}`, 10, 3600000, 3600000);
  if (!ipLimit.allowed) {
    return res.status(429).json({ success: false, message: `Terlalu banyak pendaftaran akun dari perangkat Anda. Silakan coba lagi dalam ${ipLimit.waitSec} detik.` });
  }

  const { username, email, password, captcha_id, captcha_code } = req.body;
  
  if (typeof username !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ success: false, message: 'Format input tidak valid. Semua bidang wajib teks string.' });
  }

  // Validate CAPTCHA
  if (!captcha_id || !captcha_code || typeof captcha_code !== 'string') {
    return res.status(400).json({ success: false, message: 'Kode CAPTCHA keamanan wajib diisi.' });
  }

  const storedCaptcha = captchaStore.get(captcha_id);
  if (!storedCaptcha || storedCaptcha.expiresAt < Date.now()) {
    return res.status(400).json({ success: false, message: 'Kode CAPTCHA telah kedaluwarsa. Silakan klik tombol refresh CAPTCHA.' });
  }

  if (storedCaptcha.code !== captcha_code.trim().toUpperCase()) {
    return res.status(400).json({ success: false, message: 'Kode CAPTCHA salah. Silakan coba lagi.' });
  }

  captchaStore.delete(captcha_id); // Single-use challenge

  const cleanUser = username.trim();
  const cleanEmail = email.trim().toLowerCase();

  const usernameRegex = /^[a-zA-Z0-9_]{3,25}$/;
  if (!usernameRegex.test(cleanUser)) {
    return res.status(400).json({ success: false, message: 'Username hanya boleh 3-25 karakter alfanumerik dan garis bawah (_).' });
  }

  if (FORBIDDEN_USERNAMES.has(cleanUser.toLowerCase())) {
    return res.status(400).json({ success: false, message: 'Username tersebut merupakan kata kunci sistem dan tidak dapat digunakan.' });
  }

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(cleanEmail) || cleanEmail.length > 100) {
    return res.status(400).json({ success: false, message: 'Format email tidak valid.' });
  }

  if (password.length < 6 || password.length > 100) {
    return res.status(400).json({ success: false, message: 'Password minimal 6 dan maksimal 100 karakter.' });
  }

  try {
    const hashedPassword = bcrypt.hashSync(password, 10);
    const avatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(cleanUser)}`;

    const result = db.prepare(`
      INSERT INTO users (username, email, password, role, avatar, level, xp)
      VALUES (?, ?, ?, 'user', ?, 1, 0)
    `).run(cleanUser, cleanEmail, hashedPassword, avatar);

    recordFailure(registerAttempts, `reg_ip:${ip}`, 10, 3600000, 3600000);

    const token = jwt.sign({ id: result.lastInsertRowid, role: 'user' }, JWT_SECRET, { expiresIn: '7d', algorithm: 'HS256' });
    const user = {
      id: result.lastInsertRowid,
      username: cleanUser,
      email: cleanEmail,
      role: 'user',
      avatar,
      level: 1,
      xp: 0,
      episodes_watched: 0,
      watch_minutes: 0
    };

    return res.json({ success: true, message: 'Pendaftaran akun berhasil! Selamat datang di Nekumi.', token, user });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ success: false, message: 'Username atau Email sudah terdaftar. Silakan gunakan yang lain.' });
    }
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan sistem saat memproses pendaftaran.' });
  }
});

// 3. Reset Password with CAPTCHA (Direct & Fast, No Email Waiting)
app.post('/api/auth/reset-password', (req, res) => {
  const { email, new_password, captcha_id, captcha_code } = req.body;
  if (!email || !new_password || !captcha_id || !captcha_code) {
    return res.status(400).json({ success: false, message: 'Harap lengkapi email, password baru, dan kode CAPTCHA.' });
  }

  if (typeof email !== 'string' || typeof new_password !== 'string' || typeof captcha_code !== 'string') {
    return res.status(400).json({ success: false, message: 'Format input tidak valid.' });
  }

  // Validate CAPTCHA
  const storedCaptcha = captchaStore.get(captcha_id);
  if (!storedCaptcha || storedCaptcha.expiresAt < Date.now()) {
    return res.status(400).json({ success: false, message: 'Kode CAPTCHA telah kedaluwarsa. Silakan refresh CAPTCHA.' });
  }

  if (storedCaptcha.code !== captcha_code.trim().toUpperCase()) {
    return res.status(400).json({ success: false, message: 'Kode CAPTCHA salah. Silakan coba lagi.' });
  }

  captchaStore.delete(captcha_id);

  const cleanEmail = email.trim().toLowerCase();
  if (new_password.length < 6 || new_password.length > 100) {
    return res.status(400).json({ success: false, message: 'Password baru minimal 6 dan maksimal 100 karakter.' });
  }

  const user = db.prepare('SELECT id, username FROM users WHERE email = ?').get(cleanEmail);
  if (!user) {
    return res.status(404).json({ success: false, message: 'Email tidak ditemukan dalam sistem Nekumi.' });
  }

  const hashed = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ? WHERE email = ?').run(hashed, cleanEmail);

  return res.json({
    success: true,
    message: 'Kata sandi akun Anda berhasil diperbarui! Silakan masuk dengan kata sandi baru.'
  });
});

// 5. User Login
app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  const { login, password } = req.body;
  if (typeof login !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ success: false, message: 'Format input tidak valid.' });
  }

  // Clean and sanitize login identifier (strip null bytes and control chars)
  const cleanLogin = login.replace(/[\0\x00-\x1F\x7F]/g, '').trim();
  if (cleanLogin.length < 2 || cleanLogin.length > 100 || password.length === 0 || password.length > 100) {
    return res.status(400).json({ success: false, message: 'Username/Email atau Password tidak valid.' });
  }

  // Rate Limiting check per IP and per account (max 5 failed attempts per 10 mins)
  const ipLimit = checkRateLimit(loginAttempts, `ip:${ip}`, 5, 600000, 600000);
  const userLimit = checkRateLimit(loginAttempts, `user:${cleanLogin.toLowerCase()}`, 5, 600000, 600000);
  if (!ipLimit.allowed) {
    return res.status(429).json({ success: false, message: `Terlalu banyak percobaan masuk dari perangkat Anda. Silakan coba lagi dalam ${ipLimit.waitSec} detik demi keamanan.` });
  }
  if (!userLimit.allowed) {
    return res.status(429).json({ success: false, message: `Akun ini terkunci sementara karena terlalu banyak percobaan salah. Silakan coba lagi dalam ${userLimit.waitSec} detik.` });
  }

  // Parameterized query: 100% immune to SQL injection
  const user = db.prepare(`
    SELECT * FROM users WHERE email = ? OR username = ?
  `).get(cleanLogin.toLowerCase(), cleanLogin);

  // Timing attack defense: execute dummy hash compare if user doesn't exist
  const dummyHash = '$2a$10$777777777777777777777.7777777777777777777777777777777';
  const isMatch = user ? bcrypt.compareSync(password, user.password) : bcrypt.compareSync(password, dummyHash);

  if (!user || !isMatch) {
    recordFailure(loginAttempts, `ip:${ip}`, 5, 600000, 600000);
    recordFailure(loginAttempts, `user:${cleanLogin.toLowerCase()}`, 5, 600000, 600000);
    return res.status(401).json({ success: false, message: 'Username/Email atau Password salah.' });
  }

  // Success: clear rate limiter
  clearAttempts(loginAttempts, `ip:${ip}`);
  clearAttempts(loginAttempts, `user:${cleanLogin.toLowerCase()}`);

  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d', algorithm: 'HS256' });
  const userData = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    level: user.level || 1,
    xp: user.xp || 0,
    episodes_watched: user.episodes_watched || 0,
    watch_minutes: user.watch_minutes || 0
  };

  return res.json({ success: true, message: `Selamat datang kembali, ${user.username}!`, token, user: userData });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ success: true, user: req.user });
});

app.put('/api/auth/profile', authenticate, (req, res) => {
  const { username, avatar } = req.body;

  if (username !== undefined) {
    if (typeof username !== 'string') {
      return res.status(400).json({ success: false, message: 'Format username tidak valid.' });
    }
    const cleanUser = username.trim();
    const usernameRegex = /^[a-zA-Z0-9_]{3,25}$/;
    if (!usernameRegex.test(cleanUser)) {
      return res.status(400).json({ success: false, message: 'Username hanya boleh 3-25 karakter alfanumerik dan garis bawah (_).' });
    }
    if (FORBIDDEN_USERNAMES.has(cleanUser.toLowerCase()) && req.user.username.toLowerCase() !== cleanUser.toLowerCase()) {
      return res.status(400).json({ success: false, message: 'Username tersebut tidak diizinkan.' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(cleanUser, req.user.id);
    if (existing) {
      return res.status(400).json({ success: false, message: 'Username sudah digunakan pengguna lain.' });
    }
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(cleanUser, req.user.id);
  }

  if (avatar !== undefined) {
    if (typeof avatar !== 'string') {
      return res.status(400).json({ success: false, message: 'Format avatar tidak valid.' });
    }
    const cleanAvatar = avatar.trim();
    // Validate avatar URL: prevent javascript: and dangerous XSS schemes, support up to 1000 characters
    const isSafeUrl = cleanAvatar.startsWith('https://') || cleanAvatar.startsWith('http://') || cleanAvatar.startsWith('/images/') || cleanAvatar.startsWith('data:image/');
    if (cleanAvatar.length > 1000 || (!isSafeUrl && cleanAvatar.length > 0)) {
      return res.status(400).json({ success: false, message: 'URL avatar tidak aman atau terlalu panjang (maksimal 1000 karakter).' });
    }
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(cleanAvatar, req.user.id);
  }

  const updated = db.prepare('SELECT id, username, email, role, avatar, level, xp, episodes_watched, watch_minutes FROM users WHERE id = ?').get(req.user.id);
  res.json({ success: true, message: 'Profil Nekumi berhasil diperbarui!', user: updated });
});

// -------------------------------------------------------------
// ANIME CATALOG & FREE API ENDPOINTS
// -------------------------------------------------------------

// Curated Spotlight & Popular Fallback Anime (HD Verified Posters)
const spotlights = [
  {
    mal_id: 52991,
    title: "Sousou no Frieren",
    title_english: "Frieren: Beyond Journey's End",
    synopsis: "Petualangan penyihir elf Frieren setelah mengalahkan Raja Iblis, menyelami arti waktu, persahabatan, dan kenangan bersama rekan-rekannya di dunia fantasi yang memukau.",
    score: 9.32,
    episodes: 28,
    status: "Tamat",
    genres: [{ name: "Adventure" }, { name: "Fantasy" }, { name: "Drama" }],
    images: {
      webp: {
        large_image_url: "https://cdn.myanimelist.net/images/anime/1015/138006l.webp",
        image_url: "https://cdn.myanimelist.net/images/anime/1015/138006l.webp"
      },
      jpg: {
        large_image_url: "https://cdn.myanimelist.net/images/anime/1015/138006l.jpg",
        image_url: "https://cdn.myanimelist.net/images/anime/1015/138006.jpg"
      }
    }
  },
  {
    mal_id: 52299,
    title: "Solo Leveling (Ore dake Level Up na Ken)",
    title_english: "Solo Leveling",
    synopsis: "Sung Jin-woo, hunter peringkat terlemah E-rank, menemukan rahasia Dungeon misterius yang memberikannya kemampuan untuk 'level up' tanpa batas melampaui seluruh manusia.",
    score: 8.52,
    episodes: 12,
    status: "Tamat",
    genres: [{ name: "Action" }, { name: "Fantasy" }, { name: "Super Power" }],
    images: {
      webp: {
        large_image_url: "https://cdn.myanimelist.net/images/anime/1801/142390l.webp",
        image_url: "https://cdn.myanimelist.net/images/anime/1801/142390l.webp"
      },
      jpg: {
        large_image_url: "https://cdn.myanimelist.net/images/anime/1801/142390l.jpg",
        image_url: "https://cdn.myanimelist.net/images/anime/1801/142390.jpg"
      }
    }
  },
  {
    mal_id: 51009,
    title: "Jujutsu Kaisen Season 2 (Shibuya Incident)",
    title_english: "Jujutsu Kaisen 2nd Season",
    synopsis: "Pertempuran epik para penyihir Jujutsu melawan kutukan tingkat khusus di Shibuya pada malam Halloween. Taruhan nyawa, keadilan, dan masa depan dunia kutukan.",
    score: 8.81,
    episodes: 23,
    status: "Tamat",
    genres: [{ name: "Action" }, { name: "Supernatural" }, { name: "Dark Fantasy" }],
    images: {
      webp: {
        large_image_url: "https://cdn.myanimelist.net/images/anime/1792/138022l.webp",
        image_url: "https://cdn.myanimelist.net/images/anime/1792/138022l.webp"
      },
      jpg: {
        large_image_url: "https://cdn.myanimelist.net/images/anime/1792/138022l.jpg",
        image_url: "https://cdn.myanimelist.net/images/anime/1792/138022.jpg"
      }
    }
  },
  {
    mal_id: 57334,
    title: "Dandadan",
    title_english: "DAN DA DAN",
    synopsis: "Momo Ayase yang mempercayai hantu dan Okarun yang mempercayai alien terjebak dalam pusaran supernatural berbahaya penuh aksi komedi romantis beroktan tinggi.",
    score: 8.64,
    episodes: 12,
    status: "Tamat",
    genres: [{ name: "Action" }, { name: "Comedy" }, { name: "Supernatural" }],
    images: {
      webp: {
        large_image_url: "https://cdn.myanimelist.net/images/anime/1584/143719l.webp",
        image_url: "https://cdn.myanimelist.net/images/anime/1584/143719l.webp"
      },
      jpg: {
        large_image_url: "https://cdn.myanimelist.net/images/anime/1584/143719l.jpg",
        image_url: "https://cdn.myanimelist.net/images/anime/1584/143719.jpg"
      }
    }
  },
  {
    mal_id: 48736,
    title: "Sono Bisque Doll wa Koi wo Suru",
    title_english: "My Dress-Up Darling",
    synopsis: "Wakana Gojo bercita-cita menjadi pengrajin boneka Hina tradisional. Kehidupannya berubah drastis setelah bertemu Marin Kitagawa, siswi periang yang mengajaknya menjelajahi dunia cosplay.",
    score: 8.45,
    episodes: 12,
    status: "Tamat",
    genres: [{ name: "Romance" }, { name: "School" }, { name: "Slice of Life" }],
    images: {
      webp: {
        large_image_url: "https://cdn.myanimelist.net/images/anime/1179/119897l.webp",
        image_url: "https://cdn.myanimelist.net/images/anime/1179/119897l.webp"
      },
      jpg: {
        large_image_url: "https://cdn.myanimelist.net/images/anime/1179/119897l.jpg",
        image_url: "https://cdn.myanimelist.net/images/anime/1179/119897.jpg"
      }
    }
  }
];

// 1. Anime Baru Rilis (Season Now & Airing)
app.get('/api/anime/latest', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const data = await fetchJikan(`/seasons/now?page=${page}&limit=24`, 1800);
    res.json({ success: true, data: data.data, pagination: data.pagination });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal mengambil anime baru rilis.', error: err.message });
  }
});

// 2. Anime Populer / Trending
app.get('/api/anime/popular', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const data = await fetchJikan(`/top/anime?filter=bypopularity&page=${page}&limit=24`, 3600);
    res.json({ success: true, data: data.data, pagination: data.pagination });
  } catch (err) {
    console.warn('[Popular Anime Jikan Fallback]: Returning spotlights fallback list');
    res.json({ success: true, data: spotlights, pagination: { has_next_page: false, current_page: 1 } });
  }
});

// 3. Anime Top Airing (Sedang Tayang dengan Rating Tertinggi)
app.get('/api/anime/top-airing', async (req, res) => {
  try {
    const data = await fetchJikan('/top/anime?filter=airing&limit=12', 1800);
    res.json({ success: true, data: data.data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal mengambil top airing anime.', error: err.message });
  }
});

// 4. Anime Upcoming (Akan Datang)
app.get('/api/anime/upcoming', async (req, res) => {
  try {
    const data = await fetchJikan('/seasons/upcoming?limit=12', 3600);
    res.json({ success: true, data: data.data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal mengambil anime upcoming.', error: err.message });
  }
});

// Hero Spotlight Anime (Popular HD Hits for Top Carousel)
app.get('/api/anime/hero-spotlight', (req, res) => {
  res.json({ success: true, data: spotlights });
});

// 5. Cari Anime & Filter Genre (with Otakudesu fallback)
app.get('/api/anime/search', async (req, res) => {
  try {
    const q = req.query.q ? req.query.q.trim() : '';
    const genres = req.query.genres ? req.query.genres.trim() : '';
    const genre_name = (req.query.genre_name || req.query.slug || '').toLowerCase().trim();
    const page = parseInt(req.query.page) || 1;
    const order_by = req.query.order_by || 'popularity';

    // If genre filter is requested, try Jikan first, fallback directly to Otakudesu genre scraping
    if (genres || genre_name) {
      const genreMap = {
        '1': 'action',
        '2': 'adventure',
        '4': 'comedy',
        '8': 'drama',
        '10': 'fantasy',
        '22': 'romance',
        '24': 'sci-fi',
        '36': 'slice-of-life',
        '37': 'supernatural',
        '7': 'mystery',
        '14': 'horror',
        '30': 'sports',
        '62': 'isekai'
      };
      const slug = genre_name || genreMap[genres] || 'action';

      try {
        const jikanRes = await fetchJikan(`/anime?page=${page}&limit=24&order_by=popularity&sort=desc&sfw=true&genres=${genres || ''}`, 1200);
        if (jikanRes && jikanRes.data && jikanRes.data.length > 0) {
          return res.json({ success: true, data: jikanRes.data, pagination: jikanRes.pagination });
        }
      } catch (jikanErr) {
        console.warn(`[Genre Jikan Fallback to Otakudesu]: ${slug} (${jikanErr.message})`);
      }

      // Fast, reliable Otakudesu genre scraper
      const otakuList = await otakudesu.getAnimeByGenre(slug, page);
      if (otakuList && otakuList.length > 0) {
        return res.json({
          success: true,
          data: otakuList,
          pagination: { current_page: page, has_next_page: otakuList.length >= 12 },
          source: 'otakudesu'
        });
      }
    }

    // Normal text query search
    let endpoint = `/anime?page=${page}&limit=24&order_by=${order_by}&sort=desc&sfw=true`;
    if (q) endpoint += `&q=${encodeURIComponent(q)}`;

    try {
      const data = await fetchJikan(endpoint, 900);
      res.json({ success: true, data: data.data, pagination: data.pagination });
    } catch (jikanErr) {
      if (q) {
        const otakuResults = await otakudesu.search(q);
        const mapped = otakuResults.map(item => ({
          mal_id: `otaku_${item.slug}`,
          title: item.title,
          images: {
            webp: { image_url: item.thumb, large_image_url: item.thumb },
            jpg: { image_url: item.thumb, large_image_url: item.thumb }
          },
          score: 8.0,
          status: 'Sub Indo',
          subIndo: true
        }));
        return res.json({ success: true, data: mapped, pagination: { current_page: 1, has_next_page: false }, source: 'otakudesu' });
      }
      throw jikanErr;
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal mencari anime.', error: err.message });
  }
});

// 6. Detail Anime
app.get('/api/anime/:id', async (req, res) => {
  try {
    const rawId = req.params.id;
    if (typeof rawId === 'string' && rawId.startsWith('otaku_')) {
      const slug = rawId.replace('otaku_', '');
      const detail = await otakudesu.getAnimeDetail(slug);
      if (detail) {
        return res.json({
          success: true,
          data: {
            mal_id: rawId,
            title: detail.title,
            synopsis: detail.synopsis,
            images: {
              webp: { image_url: detail.thumb, large_image_url: detail.thumb },
              jpg: { image_url: detail.thumb, large_image_url: detail.thumb }
            },
            score: parseFloat(detail.score) || 8.2,
            episodes: detail.totalEpisodes || detail.episodes?.length || 12,
            status: detail.status,
            genres: (detail.genres || []).map(g => ({ name: g })),
            subIndo: true,
            otakudesuEpisodes: detail.episodes || []
          }
        });
      }
    }

    const id = parseInt(rawId);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'ID Anime tidak valid.' });
    }
    const data = await fetchJikan(`/anime/${id}/full`, 7200);
    res.json({ success: true, data: data.data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal mengambil detail anime.', error: err.message });
  }
});

// 7. Daftar Episode Anime
app.get('/api/anime/:id/episodes', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const page = parseInt(req.query.page) || 1;
    const data = await fetchJikan(`/anime/${id}/episodes?page=${page}`, 3600);
    res.json({ success: true, data: data.data, pagination: data.pagination });
  } catch (err) {
    // If episodes endpoint is empty or rate limited, return empty gracefully
    res.json({ success: true, data: [], pagination: { has_next_page: false } });
  }
});

// 8. Stream Sources untuk Episode Tertentu (Multi-Server Player Engine with Otakudesu Sub Indo)
app.get('/api/anime/:id/streams/:ep', async (req, res) => {
  const animeId = req.params.id;
  const ep = parseInt(req.params.ep) || 1;
  const animeTitle = req.query.title || '';

  const servers = [];

  // 1. Check custom streams added by Admin in SQLite
  const numericId = parseInt(animeId);
  if (!isNaN(numericId)) {
    const customStreams = db.prepare(`
      SELECT id, server_name, stream_type, video_url, quality
      FROM custom_streams
      WHERE anime_id = ? AND episode_num = ?
    `).all(numericId, ep);

    customStreams.forEach(cs => {
      servers.push({
        id: `custom_${cs.id}`,
        name: `${cs.server_name} (${cs.quality})`,
        type: cs.stream_type,
        url: cs.video_url,
        isCustom: true
      });
    });
  }

  // 2. Resolve Otakudesu (Sub Indo) Stream Sources
  try {
    let titleToSearch = animeTitle;
    if (!titleToSearch && !isNaN(numericId)) {
      // Lookup title from cached anime
      const cached = getCached(`jikan_/anime/${numericId}/full`);
      if (cached && cached.data) {
        titleToSearch = cached.data.title;
      }
    }

    if (titleToSearch) {
      console.log(`[StreamEngine] Resolving Otakudesu stream for: "${titleToSearch}" Ep ${ep}...`);
      const otakuStreams = await otakudesu.findStreamsByTitleAndEpisode(titleToSearch, ep);
      if (otakuStreams && otakuStreams.length > 0) {
        otakuStreams.forEach(os => {
          servers.push({
            id: os.id,
            name: os.name,
            type: os.type,
            url: os.url,
            isOtakudesu: true
          });
        });
      }
    }
  } catch (oErr) {
    console.warn('[StreamEngine] Otakudesu stream lookup warning:', oErr.message);
  }

  // 3. Resolve Kuramanime (Sub Indo) Stream Sources
  try {
    let titleToSearch = animeTitle;
    if (!titleToSearch && !isNaN(numericId)) {
      const cached = getCached(`jikan_/anime/${numericId}/full`);
      if (cached && cached.data) {
        titleToSearch = cached.data.title;
      }
    }

    if (titleToSearch) {
      console.log(`[StreamEngine] Resolving Kuramanime stream for: "${titleToSearch}" Ep ${ep}...`);
      const kuramaStream = await kuramanime.findStreamForAnime(titleToSearch, ep);
      if (kuramaStream && kuramaStream.url) {
        servers.push({
          id: `kurama_${ep}`,
          name: `Server Kuramanime (Sub Indo 1080p)`,
          type: 'embed',
          url: kuramaStream.url,
          isKurama: true
        });
      }
    }
  } catch (kErr) {
    console.warn('[StreamEngine] Kuramanime stream lookup warning:', kErr.message);
  }

  res.json({
    success: true,
    animeId,
    episode: ep,
    servers
  });
});

// -------------------------------------------------------------
// DEDICATED OTAKUDESU API ROUTES (Sub Indo Streaming & Catalog)
// -------------------------------------------------------------
app.get('/api/otakudesu/ongoing', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const items = await otakudesu.getOngoing(page);
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/otakudesu/complete', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const items = await otakudesu.getComplete(page);
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/otakudesu/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const results = await otakudesu.search(q);
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/otakudesu/anime/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    const detail = await otakudesu.getAnimeDetail(slug);
    if (!detail) return res.status(404).json({ success: false, message: 'Anime tidak ditemukan.' });
    res.json({ success: true, data: detail });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/otakudesu/episode/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    const streamData = await otakudesu.getEpisodeStream(slug);
    res.json({ success: true, data: streamData });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// -------------------------------------------------------------
// DEDICATED KURAMANIME API ROUTES (Sub Indo Catalog & Streams)
// -------------------------------------------------------------
app.get('/api/kuramanime/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const results = await kuramanime.search(q);
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/kuramanime/anime/:id/:slug', async (req, res) => {
  try {
    const { id, slug } = req.params;
    const detail = await kuramanime.getAnimeDetail(id, slug);
    if (!detail) return res.status(404).json({ success: false, message: 'Anime Kuramanime tidak ditemukan.' });
    res.json({ success: true, data: detail });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// -------------------------------------------------------------
// WATCH HISTORY ROUTES (Menyimpan History Nonton)
// -------------------------------------------------------------

// Ambil riwayat nonton pengguna
app.get('/api/history', authenticate, (req, res) => {
  const history = db.prepare(`
    SELECT * FROM history
    WHERE user_id = ?
    ORDER BY updated_at DESC
  `).all(req.user.id);

  res.json({ success: true, data: history });
});

// Simpan atau perbarui riwayat nonton
app.post('/api/history', authenticate, (req, res) => {
  const {
    anime_id,
    anime_title,
    anime_image,
    episode_num,
    episode_title,
    progress_seconds,
    duration_seconds,
    percentage
  } = req.body;

  if (!anime_id || !anime_title) {
    return res.status(400).json({ success: false, message: 'ID dan Judul anime wajib ada.' });
  }

  const query = `
    INSERT INTO history (
      user_id, anime_id, anime_title, anime_image,
      episode_num, episode_title, progress_seconds, duration_seconds, percentage, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, anime_id) DO UPDATE SET
      anime_title = excluded.anime_title,
      anime_image = excluded.anime_image,
      episode_num = excluded.episode_num,
      episode_title = excluded.episode_title,
      progress_seconds = excluded.progress_seconds,
      duration_seconds = excluded.duration_seconds,
      percentage = excluded.percentage,
      updated_at = CURRENT_TIMESTAMP
  `;

  db.prepare(query).run(
    req.user.id,
    parseAnimeId(anime_id),
    anime_title,
    anime_image || '',
    parseInt(episode_num) || 1,
    episode_title || `Episode ${episode_num || 1}`,
    parseFloat(progress_seconds) || 0,
    parseFloat(duration_seconds) || 0,
    parseFloat(percentage) || 0
  );

  // Award Stream XP and Level progression
  const xpReward = 35;
  const currentStats = db.prepare('SELECT level, xp, episodes_watched, watch_minutes FROM users WHERE id = ?').get(req.user.id) || {};
  const oldLevel = currentStats.level || 1;
  const newXp = (currentStats.xp || 0) + xpReward;
  const newLevel = Math.max(1, Math.floor(newXp / 100) + 1);
  const newMinutes = Math.round(((currentStats.watch_minutes || 0) + 0.5) * 10) / 10;
  const newEpisodes = (currentStats.episodes_watched || 0) + 1;

  db.prepare(`
    UPDATE users SET
      xp = ?,
      level = ?,
      episodes_watched = ?,
      watch_minutes = ?
    WHERE id = ?
  `).run(newXp, newLevel, newEpisodes, newMinutes, req.user.id);

  const leveledUp = newLevel > oldLevel;

  res.json({
    success: true,
    message: 'Riwayat berhasil disimpan.',
    stats: {
      level: newLevel,
      xp: newXp,
      xpGained: xpReward,
      leveledUp
    }
  });
});

// Hapus satu riwayat
app.delete('/api/history/:anime_id', authenticate, (req, res) => {
  const animeId = parseAnimeId(req.params.anime_id);
  db.prepare('DELETE FROM history WHERE user_id = ? AND anime_id = ?').run(req.user.id, animeId);
  res.json({ success: true, message: 'Riwayat berhasil dihapus.' });
});

// Bersihkan semua riwayat
app.delete('/api/history', authenticate, (req, res) => {
  db.prepare('DELETE FROM history WHERE user_id = ?').run(req.user.id);
  res.json({ success: true, message: 'Semua riwayat berhasil dibersihkan.' });
});

// -------------------------------------------------------------
// BOOKMARKS / FAVORIT WATCHLIST
// -------------------------------------------------------------
app.get('/api/bookmarks', authenticate, (req, res) => {
  const bookmarks = db.prepare(`
    SELECT * FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC
  `).all(req.user.id);
  res.json({ success: true, data: bookmarks });
});

app.post('/api/bookmarks', authenticate, (req, res) => {
  const { anime_id, anime_title, anime_image, anime_type, anime_score } = req.body;
  if (!anime_id || !anime_title) {
    return res.status(400).json({ success: false, message: 'Data anime tidak lengkap.' });
  }

  try {
    db.prepare(`
      INSERT INTO bookmarks (user_id, anime_id, anime_title, anime_image, anime_type, anime_score)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user.id, parseAnimeId(anime_id), anime_title, anime_image || '', anime_type || 'TV', anime_score || 0);

    res.json({ success: true, message: 'Berhasil ditambahkan ke Favorit!' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.json({ success: true, message: 'Anime sudah ada di Favorit.' });
    }
    res.status(500).json({ success: false, message: 'Gagal menambahkan favorit.' });
  }
});

app.delete('/api/bookmarks/:anime_id', authenticate, (req, res) => {
  const animeId = parseAnimeId(req.params.anime_id);
  db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND anime_id = ?').run(req.user.id, animeId);
  res.json({ success: true, message: 'Dihapus dari Favorit.' });
});

// -------------------------------------------------------------
// COMMENTS / DISKUSI ANIME
// -------------------------------------------------------------
app.get('/api/comments/:anime_id', (req, res) => {
  const animeId = parseAnimeId(req.params.anime_id);
  const comments = db.prepare(`
    SELECT c.id, c.anime_id, c.episode_num, c.comment_text, c.created_at,
           u.id as user_id, u.username, u.role, u.avatar
    FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.anime_id = ?
    ORDER BY c.created_at DESC
    LIMIT 100
  `).all(animeId);

  res.json({ success: true, data: comments });
});

app.post('/api/comments/:anime_id', authenticate, (req, res) => {
  const animeId = parseAnimeId(req.params.anime_id);
  const { comment_text, episode_num } = req.body;

  if (typeof comment_text !== 'string' || comment_text.trim().length === 0) {
    return res.status(400).json({ success: false, message: 'Komentar tidak boleh kosong.' });
  }

  // Prevent Stored XSS by escaping HTML entities and limiting length
  const cleanComment = comment_text.trim().slice(0, 500)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const result = db.prepare(`
    INSERT INTO comments (user_id, anime_id, episode_num, comment_text)
    VALUES (?, ?, ?, ?)
  `).run(req.user.id, animeId, parseInt(episode_num) || 1, cleanComment);

  res.json({ success: true, message: 'Komentar berhasil dikirim!', commentId: result.lastInsertRowid });
});

app.delete('/api/comments/:id', authenticate, (req, res) => {
  const commentId = parseInt(req.params.id);
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
  if (!comment) {
    return res.status(404).json({ success: false, message: 'Komentar tidak ditemukan.' });
  }

  if (req.user.role !== 'admin' && comment.user_id !== req.user.id) {
    return res.status(403).json({ success: false, message: 'Anda tidak memiliki hak untuk menghapus komentar ini.' });
  }

  db.prepare('DELETE FROM comments WHERE id = ?').run(commentId);
  res.json({ success: true, message: 'Komentar berhasil dihapus.' });
});

// -------------------------------------------------------------
// ANNOUNCEMENTS BANNER
// -------------------------------------------------------------
app.get('/api/announcements/active', (req, res) => {
  const announcement = db.prepare(`
    SELECT * FROM announcements WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1
  `).get();
  res.json({ success: true, data: announcement || null });
});

// -------------------------------------------------------------
// ADMIN ROLE MANAGEMENT ENDPOINTS
// -------------------------------------------------------------

// Dashboard Stats
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const historyCount = db.prepare('SELECT COUNT(*) as count FROM history').get().count;
  const bookmarkCount = db.prepare('SELECT COUNT(*) as count FROM bookmarks').get().count;
  const streamCount = db.prepare('SELECT COUNT(*) as count FROM custom_streams').get().count;
  const commentCount = db.prepare('SELECT COUNT(*) as count FROM comments').get().count;

  res.json({
    success: true,
    stats: {
      users: userCount,
      history: historyCount,
      bookmarks: bookmarkCount,
      customStreams: streamCount,
      comments: commentCount
    }
  });
});

// User Management: List all users
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT id, username, email, role, avatar, created_at FROM users ORDER BY created_at DESC
  `).all();
  res.json({ success: true, data: users });
});

// User Management: Change role (admin <-> user)
app.put('/api/admin/users/:id/role', requireAdmin, (req, res) => {
  const targetId = parseInt(req.params.id);
  const { role } = req.body;

  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ success: false, message: 'Role hanya boleh "admin" atau "user".' });
  }

  // Prevent admin from demoting self if they are the only admin
  if (targetId === req.user.id && role !== 'admin') {
    const adminCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = "admin"').get().count;
    if (adminCount <= 1) {
      return res.status(400).json({ success: false, message: 'Tidak dapat mencabut hak admin untuk akun Anda sendiri karena Anda adalah satu-satunya admin.' });
    }
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, targetId);
  res.json({ success: true, message: `Role pengguna berhasil diubah menjadi ${role}.` });
});

// User Management: Delete user
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const targetId = parseInt(req.params.id);
  if (targetId === req.user.id) {
    return res.status(400).json({ success: false, message: 'Anda tidak dapat menghapus akun Anda sendiri.' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  res.json({ success: true, message: 'Pengguna berhasil dihapus.' });
});

// Custom Streams Management: List all custom streams
app.get('/api/admin/streams', requireAdmin, (req, res) => {
  const streams = db.prepare('SELECT * FROM custom_streams ORDER BY created_at DESC').all();
  res.json({ success: true, data: streams });
});

// Custom Streams Management: Add custom stream URL
app.post('/api/admin/streams', requireAdmin, (req, res) => {
  const { anime_id, episode_num, server_name, stream_type, video_url, quality } = req.body;

  if (!anime_id || !episode_num || !server_name || !video_url) {
    return res.status(400).json({ success: false, message: 'Harap lengkapi Anime ID, Episode, Nama Server, dan URL Video.' });
  }

  const result = db.prepare(`
    INSERT INTO custom_streams (anime_id, episode_num, server_name, stream_type, video_url, quality)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    parseAnimeId(anime_id),
    parseInt(episode_num),
    server_name.trim(),
    stream_type || 'embed',
    video_url.trim(),
    quality || '1080p'
  );

  res.json({ success: true, message: 'Server streaming kustom berhasil ditambahkan!', id: result.lastInsertRowid });
});

// Custom Streams Management: Delete stream
app.delete('/api/admin/streams/:id', requireAdmin, (req, res) => {
  const streamId = parseInt(req.params.id);
  db.prepare('DELETE FROM custom_streams WHERE id = ?').run(streamId);
  res.json({ success: true, message: 'Server streaming berhasil dihapus.' });
});

// Announcements Management
app.get('/api/admin/announcements', requireAdmin, (req, res) => {
  const announcements = db.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all();
  res.json({ success: true, data: announcements });
});

app.post('/api/admin/announcements', requireAdmin, (req, res) => {
  const { title, content, type, is_active } = req.body;
  if (!title || !content) {
    return res.status(400).json({ success: false, message: 'Judul dan konten pengumuman wajib diisi.' });
  }

  // Deactivate others if this is set to active
  if (is_active) {
    db.prepare('UPDATE announcements SET is_active = 0').run();
  }

  const result = db.prepare(`
    INSERT INTO announcements (title, content, type, is_active)
    VALUES (?, ?, ?, ?)
  `).run(title.trim(), content.trim(), type || 'info', is_active ? 1 : 0);

  res.json({ success: true, message: 'Pengumuman berhasil dipublikasikan!', id: result.lastInsertRowid });
});

app.delete('/api/admin/announcements/:id', requireAdmin, (req, res) => {
  const annId = parseInt(req.params.id);
  db.prepare('DELETE FROM announcements WHERE id = ?').run(annId);
  res.json({ success: true, message: 'Pengumuman berhasil dihapus.' });
});

// Clear Cache
app.post('/api/admin/clear-cache', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM api_cache').run();
  res.json({ success: true, message: 'Cache API berhasil dibersihkan.' });
});

// Catch-all for API 404 vs SPA client routing (Express 5 compatible)
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'Endpoint API tidak ditemukan.' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
const server = app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 AniNonton Server running at http://localhost:${PORT}`);
  console.log(`👤 Admin: admin@aninonton.com | Pass: admin123`);
  console.log(`👤 User: user@aninonton.com  | Pass: user123`);
  console.log(`====================================================`);
});

server.on('error', (err) => {
  console.error('[Server Error]:', err.message);
});

// Keep event loop active
setInterval(() => { }, 30000);

module.exports = app;
