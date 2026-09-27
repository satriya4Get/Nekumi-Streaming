const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, 'aninonton.db');
const db = new Database(dbPath);

// Enable WAL mode for high performance
db.pragma('journal_mode = WAL');

// Initialize tables
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      avatar TEXT DEFAULT '',
      level INTEGER DEFAULT 1,
      xp INTEGER DEFAULT 0,
      episodes_watched INTEGER DEFAULT 0,
      watch_minutes REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      anime_id INTEGER NOT NULL,
      anime_title TEXT NOT NULL,
      anime_image TEXT,
      episode_num INTEGER NOT NULL DEFAULT 1,
      episode_title TEXT,
      progress_seconds REAL DEFAULT 0,
      duration_seconds REAL DEFAULT 0,
      percentage REAL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, anime_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      anime_id INTEGER NOT NULL,
      anime_title TEXT NOT NULL,
      anime_image TEXT,
      anime_type TEXT DEFAULT 'TV',
      anime_score REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, anime_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS custom_streams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anime_id INTEGER NOT NULL,
      episode_num INTEGER NOT NULL,
      server_name TEXT NOT NULL,
      stream_type TEXT NOT NULL DEFAULT 'embed', -- 'embed', 'hls', 'mp4'
      video_url TEXT NOT NULL,
      quality TEXT DEFAULT '1080p',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      anime_id INTEGER NOT NULL,
      episode_num INTEGER DEFAULT 1,
      comment_text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'info',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS api_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS email_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Safe migrations for existing SQLite tables
  const userColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!userColumns.includes('level')) {
    db.exec("ALTER TABLE users ADD COLUMN level INTEGER DEFAULT 1;");
  }
  if (!userColumns.includes('xp')) {
    db.exec("ALTER TABLE users ADD COLUMN xp INTEGER DEFAULT 0;");
  }
  if (!userColumns.includes('episodes_watched')) {
    db.exec("ALTER TABLE users ADD COLUMN episodes_watched INTEGER DEFAULT 0;");
  }
  if (!userColumns.includes('watch_minutes')) {
    db.exec("ALTER TABLE users ADD COLUMN watch_minutes REAL DEFAULT 0;");
  }

  // Ensure Admin nekumi exists
  const nekumiAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@nekumi.com');
  if (!nekumiAdmin) {
    const adminPass = bcrypt.hashSync('admin123', 10);
    db.prepare(`
      INSERT INTO users (username, email, password, role, avatar, level, xp)
      VALUES (?, ?, ?, 'admin', 'https://api.dicebear.com/7.x/bottts/svg?seed=NekumiAdmin', 99, 99999)
    `).run('Admin Nekumi', 'admin@nekumi.com', adminPass);
    console.log('[DB] Seeded Nekumi admin (admin@nekumi.com / admin123)');
  }

  // Seed default admin and user if not exists
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCount.count <= 1) {
    const userPass = bcrypt.hashSync('user123', 10);

    const insertUser = db.prepare(`
      INSERT OR IGNORE INTO users (username, email, password, role, avatar, level, xp)
      VALUES (?, ?, ?, ?, ?, 1, 0)
    `);

    insertUser.run('Otaku Streamer', 'user@nekumi.com', userPass, 'user', 'https://api.dicebear.com/7.x/bottts/svg?seed=NekumiUser');

    console.log('[DB] Seeded default user (user@nekumi.com / user123)');

    // Seed default announcement
    db.prepare(`
      INSERT OR REPLACE INTO announcements (id, title, content, type, is_active)
      VALUES (1, ?, ?, ?, 1)
    `).run(
      '🐱 Selamat Datang di Nekumi!',
      'Platform streaming anime subtitle Indonesia gratis terlengkap dengan fitur Level Streamer dan pilihan server terbaik!',
      'info'
    );

  }
}

initDatabase();

module.exports = db;
