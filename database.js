require('dotenv').config();
const { createAdminClient } = require('@supabase/server/core');
const bcrypt = require('bcryptjs');
const path = require('path');
const Database = require('better-sqlite3');

// 1. Initialize Supabase Admin Client
let supabase = null;
let isSupabaseReady = false;

try {
  if (process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY)) {
    supabase = createAdminClient();
    console.log('[Supabase] Client initialized for:', process.env.SUPABASE_URL);
  }
} catch (err) {
  console.warn('[Supabase Warning] Failed to initialize Supabase client:', err.message);
}

// 2. Initialize Local SQLite as fallback & local cache
let localDb = null;
const isVercel = !!process.env.VERCEL;

function initLocalDatabase(dbInstance) {
  if (!dbInstance) return;
  try {
    dbInstance.exec(`
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
        stream_type TEXT NOT NULL DEFAULT 'embed',
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
  } catch (e) {
    console.warn('[DB Init Warning]:', e.message);
  }
}

try {
  if (!isVercel) {
    const dbPath = path.join(__dirname, 'aninonton.db');
    localDb = new Database(dbPath);
    localDb.pragma('journal_mode = WAL');
    initLocalDatabase(localDb);
  } else {
    localDb = new Database(':memory:');
    initLocalDatabase(localDb);
    console.log('[DB] Vercel Serverless environment detected: in-memory DB ready.');
  }
} catch (err) {
  console.warn('[DB Warning] Local SQLite initialization skipped:', err.message);
}

// 3. Admin Account Seeding helper (Ensures Satriyaa / Satriyaa1990# exists)
const ADMIN_USERNAME = 'Satriyaa';
const ADMIN_PASS_PLAIN = 'Satriyaa1990#';
const ADMIN_EMAIL = 'admin@nekumi.com';
const ADMIN_HASH = bcrypt.hashSync(ADMIN_PASS_PLAIN, 10);

async function seedAdminAccount() {
  // A. Seed into Local SQLite
  try {
    const existing = localDb.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(ADMIN_USERNAME, ADMIN_EMAIL);
    if (!existing) {
      localDb.prepare(`
        INSERT INTO users (username, email, password, role, avatar, level, xp)
        VALUES (?, ?, ?, 'admin', 'https://api.dicebear.com/7.x/bottts/svg?seed=Satriyaa', 99, 99999)
      `).run(ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_HASH);
      console.log(`[DB] Admin account created in local DB: ${ADMIN_USERNAME} / ${ADMIN_PASS_PLAIN}`);
    } else {
      localDb.prepare(`
        UPDATE users SET password = ?, role = 'admin', username = ? WHERE id = ?
      `).run(ADMIN_HASH, ADMIN_USERNAME, existing.id);
      console.log(`[DB] Admin account updated in local DB: ${ADMIN_USERNAME} / ${ADMIN_PASS_PLAIN}`);
    }
  } catch (err) {
    console.error('[DB Local Seed Error]:', err.message);
  }

  // B. Seed into Supabase if connected
  if (supabase) {
    try {
      const { data: existingUser, error: checkErr } = await supabase
        .from('users')
        .select('id')
        .or(`username.eq.${ADMIN_USERNAME},email.eq.${ADMIN_EMAIL}`)
        .maybeSingle();

      if (!checkErr) {
        if (!existingUser) {
          const { error: insErr } = await supabase.from('users').insert([{
            username: ADMIN_USERNAME,
            email: ADMIN_EMAIL,
            password: ADMIN_HASH,
            role: 'admin',
            avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=Satriyaa',
            level: 99,
            xp: 99999
          }]);
          if (!insErr) {
            console.log(`[Supabase] Seeded admin user: ${ADMIN_USERNAME}`);
            isSupabaseReady = true;
          }
        } else {
          await supabase.from('users').update({
            password: ADMIN_HASH,
            role: 'admin',
            username: ADMIN_USERNAME
          }).eq('id', existingUser.id);
          console.log(`[Supabase] Admin user password & role synced: ${ADMIN_USERNAME}`);
          isSupabaseReady = true;
        }
      } else {
        if (checkErr.code === 'PGRST205') {
          console.log('[Supabase Notice] Tables not yet created in Supabase project. Run `supabase_schema.sql` in Supabase SQL Editor.');
        }
      }
    } catch (e) {
      console.warn('[Supabase Connection Notice]:', e.message);
    }
  }
}

// Check Supabase readiness asynchronously
(async () => {
  if (supabase) {
    try {
      const { error } = await supabase.from('users').select('id').limit(1);
      if (!error) {
        isSupabaseReady = true;
        console.log('[Supabase] Connected and operational!');
      }
    } catch (_) {}
  }
  await seedAdminAccount();
})();

// 4. Unified Asynchronous Database API Layer
const db = {
  supabase,
  isSupabaseReady() {
    return isSupabaseReady && supabase !== null;
  },

  // USERS
  async getUserById(id) {
    if (this.isSupabaseReady()) {
      try {
        const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
        if (!error && data) return data;
      } catch (_) {}
    }
    return localDb.prepare('SELECT id, username, email, role, avatar, level, xp, episodes_watched, watch_minutes FROM users WHERE id = ?').get(id);
  },

  async getUserByEmailOrUsername(identifier) {
    const cleanId = String(identifier).trim();
    if (this.isSupabaseReady()) {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('*')
          .or(`email.eq.${cleanId.toLowerCase()},username.eq.${cleanId}`)
          .maybeSingle();
        if (!error && data) return data;
      } catch (_) {}
    }
    return localDb.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(cleanId.toLowerCase(), cleanId);
  },

  async getUserByEmail(email) {
    const cleanEmail = String(email).trim().toLowerCase();
    if (this.isSupabaseReady()) {
      try {
        const { data, error } = await supabase.from('users').select('*').eq('email', cleanEmail).maybeSingle();
        if (!error && data) return data;
      } catch (_) {}
    }
    return localDb.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
  },

  async getUserByUsername(username) {
    const cleanUser = String(username).trim();
    if (this.isSupabaseReady()) {
      try {
        const { data, error } = await supabase.from('users').select('*').eq('username', cleanUser).maybeSingle();
        if (!error && data) return data;
      } catch (_) {}
    }
    return localDb.prepare('SELECT * FROM users WHERE username = ?').get(cleanUser);
  },

  async createUser(userData) {
    if (this.isSupabaseReady()) {
      try {
        const { data, error } = await supabase.from('users').insert([userData]).select().single();
        if (!error && data) {
          // Also sync to local
          try {
            localDb.prepare(`
              INSERT OR REPLACE INTO users (id, username, email, password, role, avatar, level, xp)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(data.id, data.username, data.email, data.password, data.role, data.avatar, data.level, data.xp);
          } catch (_) {}
          return data;
        }
      } catch (_) {}
    }

    const result = localDb.prepare(`
      INSERT INTO users (username, email, password, role, avatar, level, xp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      userData.username,
      userData.email,
      userData.password,
      userData.role || 'user',
      userData.avatar || '',
      userData.level || 1,
      userData.xp || 0
    );

    return { id: result.lastInsertRowid, ...userData };
  },

  async updateUserPassword(email, hashedPassword) {
    const cleanEmail = String(email).trim().toLowerCase();
    if (this.isSupabaseReady()) {
      try {
        await supabase.from('users').update({ password: hashedPassword }).eq('email', cleanEmail);
      } catch (_) {}
    }
    localDb.prepare('UPDATE users SET password = ? WHERE email = ?').run(hashedPassword, cleanEmail);
    return true;
  },

  async updateUserProfile(id, updates) {
    if (this.isSupabaseReady()) {
      try {
        await supabase.from('users').update(updates).eq('id', id);
      } catch (_) {}
    }
    if (updates.username) {
      localDb.prepare('UPDATE users SET username = ? WHERE id = ?').run(updates.username, id);
    }
    if (updates.avatar) {
      localDb.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(updates.avatar, id);
    }
    return this.getUserById(id);
  },

  async updateUserRole(id, role) {
    if (this.isSupabaseReady()) {
      try {
        await supabase.from('users').update({ role }).eq('id', id);
      } catch (_) {}
    }
    localDb.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    return true;
  },

  // ADMIN FEATURE: SET USER LEVEL & XP
  async updateUserLevel(id, level, xp) {
    const parsedLevel = Math.max(1, parseInt(level) || 1);
    const calculatedXp = (xp !== undefined && !isNaN(xp)) ? parseInt(xp) : (parsedLevel - 1) * 100;

    if (this.isSupabaseReady()) {
      try {
        await supabase.from('users').update({ level: parsedLevel, xp: calculatedXp }).eq('id', id);
      } catch (_) {}
    }
    localDb.prepare('UPDATE users SET level = ?, xp = ? WHERE id = ?').run(parsedLevel, calculatedXp, id);
    return { level: parsedLevel, xp: calculatedXp };
  },

  async updateUserStats(id, { xp, level, episodes_watched, watch_minutes }) {
    if (this.isSupabaseReady()) {
      try {
        await supabase.from('users').update({
          xp,
          level,
          episodes_watched,
          watch_minutes
        }).eq('id', id);
      } catch (_) {}
    }
    localDb.prepare(`
      UPDATE users SET
        xp = ?,
        level = ?,
        episodes_watched = ?,
        watch_minutes = ?
      WHERE id = ?
    `).run(xp, level, episodes_watched, watch_minutes, id);
    return true;
  },

  async deleteUser(id) {
    if (this.isSupabaseReady()) {
      try {
        await supabase.from('users').delete().eq('id', id);
      } catch (_) {}
    }
    localDb.prepare('DELETE FROM users WHERE id = ?').run(id);
    return true;
  },

  async getAllUsers() {
    if (this.isSupabaseReady()) {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('id, username, email, role, avatar, level, xp, created_at')
          .order('created_at', { ascending: false });
        if (!error && data) return data;
      } catch (_) {}
    }
    return localDb.prepare('SELECT id, username, email, role, avatar, level, xp, created_at FROM users ORDER BY created_at DESC').all();
  },

  async countAdmins() {
    if (this.isSupabaseReady()) {
      try {
        const { count, error } = await supabase
          .from('users')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'admin');
        if (!error && typeof count === 'number') return count;
      } catch (_) {}
    }
    return localDb.prepare('SELECT COUNT(*) as count FROM users WHERE role = "admin"').get().count;
  },

  async getAdminStats() {
    if (this.isSupabaseReady()) {
      try {
        const [u, h, b, s, c] = await Promise.all([
          supabase.from('users').select('id', { count: 'exact', head: true }),
          supabase.from('history').select('id', { count: 'exact', head: true }),
          supabase.from('bookmarks').select('id', { count: 'exact', head: true }),
          supabase.from('custom_streams').select('id', { count: 'exact', head: true }),
          supabase.from('comments').select('id', { count: 'exact', head: true })
        ]);
        return {
          users: u.count || 0,
          history: h.count || 0,
          bookmarks: b.count || 0,
          customStreams: s.count || 0,
          comments: c.count || 0
        };
      } catch (_) {}
    }

    return {
      users: localDb.prepare('SELECT COUNT(*) as count FROM users').get().count,
      history: localDb.prepare('SELECT COUNT(*) as count FROM history').get().count,
      bookmarks: localDb.prepare('SELECT COUNT(*) as count FROM bookmarks').get().count,
      customStreams: localDb.prepare('SELECT COUNT(*) as count FROM custom_streams').get().count,
      comments: localDb.prepare('SELECT COUNT(*) as count FROM comments').get().count
    };
  },

  // HISTORY
  async getHistory(userId) {
    if (this.isSupabaseReady()) {
      try {
        const { data, error } = await supabase
          .from('history')
          .select('*')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false });
        if (!error && data) return data;
      } catch (_) {}
    }
    return localDb.prepare('SELECT * FROM history WHERE user_id = ? ORDER BY updated_at DESC').all(userId);
  },

  async saveHistory(userId, data) {
    if (this.isSupabaseReady()) {
      try {
        await supabase.from('history').upsert({
          user_id: userId,
          anime_id: data.anime_id,
          anime_title: data.anime_title,
          anime_image: data.anime_image || '',
          episode_num: data.episode_num || 1,
          episode_title: data.episode_title || `Episode ${data.episode_num || 1}`,
          progress_seconds: data.progress_seconds || 0,
          duration_seconds: data.duration_seconds || 0,
          percentage: data.percentage || 0,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,anime_id' });
      } catch (_) {}
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
    localDb.prepare(query).run(
      userId,
      data.anime_id,
      data.anime_title,
      data.anime_image || '',
      data.episode_num || 1,
      data.episode_title || `Episode ${data.episode_num || 1}`,
      data.progress_seconds || 0,
      data.duration_seconds || 0,
      data.percentage || 0
    );
  },

  async deleteHistory(userId, animeId) {
    if (this.isSupabaseReady()) {
      try {
        await supabase.from('history').delete().match({ user_id: userId, anime_id: animeId });
      } catch (_) {}
    }
    localDb.prepare('DELETE FROM history WHERE user_id = ? AND anime_id = ?').run(userId, animeId);
  },

  async clearHistory(userId) {
    if (this.isSupabaseReady()) {
      try {
        await supabase.from('history').delete().eq('user_id', userId);
      } catch (_) {}
    }
    localDb.prepare('DELETE FROM history WHERE user_id = ?').run(userId);
  },

  // BOOKMARKS
  async getBookmarks(userId) {
    if (this.isSupabaseReady()) {
      try {
        const { data, error } = await supabase
          .from('bookmarks')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });
        if (!error && data) return data;
      } catch (_) {}
    }
    return localDb.prepare('SELECT * FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  },

  async addBookmark(userId, item) {
    if (this.isSupabaseReady()) {
      try {
        await supabase.from('bookmarks').upsert({
          user_id: userId,
          anime_id: item.anime_id,
          anime_title: item.anime_title,
          anime_image: item.anime_image || '',
          anime_type: item.anime_type || 'TV',
          anime_score: item.anime_score || 0
        }, { onConflict: 'user_id,anime_id' });
      } catch (_) {}
    }

    try {
      localDb.prepare(`
        INSERT INTO bookmarks (user_id, anime_id, anime_title, anime_image, anime_type, anime_score)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, item.anime_id, item.anime_title, item.anime_image || '', item.anime_type || 'TV', item.anime_score || 0);
    } catch (_) {}
  },

  async deleteBookmark(userId, animeId) {
    if (this.isSupabaseReady()) {
      try {
        await supabase.from('bookmarks').delete().match({ user_id: userId, anime_id: animeId });
      } catch (_) {}
    }
    localDb.prepare('DELETE FROM bookmarks WHERE user_id = ? AND anime_id = ?').run(userId, animeId);
  },

  // COMMENTS
  async getComments(animeId, limit = 100) {
    if (this.isSupabaseReady()) {
      try {
        const { data, error } = await supabase
          .from('comments')
          .select(`
            id, anime_id, episode_num, comment_text, created_at, user_id,
            users (id, username, role, avatar)
          `)
          .eq('anime_id', animeId)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (!error && data) {
          return data.map(c => ({
            id: c.id,
            anime_id: c.anime_id,
            episode_num: c.episode_num,
            comment_text: c.comment_text,
            created_at: c.created_at,
            user_id: c.users?.id || c.user_id,
            username: c.users?.username || 'Pengguna',
            role: c.users?.role || 'user',
            avatar: c.users?.avatar || ''
          }));
        }
      } catch (_) {}
    }

    return localDb.prepare(`
      SELECT c.id, c.anime_id, c.episode_num, c.comment_text, c.created_at,
             u.id as user_id, u.username, u.role, u.avatar
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.anime_id = ?
      ORDER BY c.created_at DESC
      LIMIT ?
    `).all(animeId, limit);
  },

  async addComment(userId, animeId, episodeNum, commentText) {
    let newId = null;
    if (this.isSupabaseReady()) {
      try {
        const { data, error } = await supabase.from('comments').insert([{
          user_id: userId,
          anime_id: animeId,
          episode_num: episodeNum || 1,
          comment_text: commentText
        }]).select('id').single();
        if (!error && data) newId = data.id;
      } catch (_) {}
    }

    const res = localDb.prepare(`
      INSERT INTO comments (user_id, anime_id, episode_num, comment_text)
      VALUES (?, ?, ?, ?)
    `).run(userId, animeId, episodeNum || 1, commentText);

    return newId || res.lastInsertRowid;
  },

  async getCommentById(id) {
    if (this.isSupabaseReady()) {
      try {
        const { data, error } = await supabase.from('comments').select('*').eq('id', id).maybeSingle();
        if (!error && data) return data;
      } catch (_) {}
    }
    return localDb.prepare('SELECT * FROM comments WHERE id = ?').get(id);
  },

  async deleteComment(id) {
    if (this.isSupabaseReady()) {
      try {
        await supabase.from('comments').delete().eq('id', id);
      } catch (_) {}
    }
    localDb.prepare('DELETE FROM comments WHERE id = ?').run(id);
  },

  // ANNOUNCEMENTS
  async getActiveAnnouncement() {
    if (this.isSupabaseReady()) {
      try {
        const { data, error } = await supabase
          .from('announcements')
          .select('*')
          .eq('is_active', 1)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!error && data) return data;
      } catch (_) {}
    }
    return localDb.prepare('SELECT * FROM announcements WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1').get() || null;
  },

  async getAllAnnouncements() {
    if (this.isSupabaseReady()) {
      try {
        const { data, error } = await supabase.from('announcements').select('*').order('created_at', { ascending: false });
        if (!error && data) return data;
      } catch (_) {}
    }
    return localDb.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all();
  },

  async createAnnouncement({ title, content, type, is_active }) {
    if (is_active) {
      if (this.isSupabaseReady()) {
        try {
          await supabase.from('announcements').update({ is_active: 0 }).neq('id', 0);
        } catch (_) {}
      }
      localDb.prepare('UPDATE announcements SET is_active = 0').run();
    }

    let insertId = null;
    if (this.isSupabaseReady()) {
      try {
        const { data, error } = await supabase.from('announcements').insert([{
          title,
          content,
          type: type || 'info',
          is_active: is_active ? 1 : 0
        }]).select('id').single();
        if (!error && data) insertId = data.id;
      } catch (_) {}
    }

    const res = localDb.prepare(`
      INSERT INTO announcements (title, content, type, is_active)
      VALUES (?, ?, ?, ?)
    `).run(title, content, type || 'info', is_active ? 1 : 0);

    return insertId || res.lastInsertRowid;
  },

  async deleteAnnouncement(id) {
    if (this.isSupabaseReady()) {
      try {
        await supabase.from('announcements').delete().eq('id', id);
      } catch (_) {}
    }
    localDb.prepare('DELETE FROM announcements WHERE id = ?').run(id);
  },

  // CUSTOM STREAMS
  async getCustomStreams(animeId = null, episodeNum = null) {
    if (this.isSupabaseReady()) {
      try {
        let q = supabase.from('custom_streams').select('*');
        if (animeId !== null) q = q.eq('anime_id', animeId);
        if (episodeNum !== null) q = q.eq('episode_num', episodeNum);
        const { data, error } = await q.order('created_at', { ascending: false });
        if (!error && data) return data;
      } catch (_) {}
    }

    if (animeId !== null && episodeNum !== null) {
      return localDb.prepare('SELECT * FROM custom_streams WHERE anime_id = ? AND episode_num = ? ORDER BY created_at DESC').all(animeId, episodeNum);
    }
    return localDb.prepare('SELECT * FROM custom_streams ORDER BY created_at DESC').all();
  },

  async addCustomStream(streamData) {
    let id = null;
    if (this.isSupabaseReady()) {
      try {
        const { data, error } = await supabase.from('custom_streams').insert([streamData]).select('id').single();
        if (!error && data) id = data.id;
      } catch (_) {}
    }

    const res = localDb.prepare(`
      INSERT INTO custom_streams (anime_id, episode_num, server_name, stream_type, video_url, quality)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      streamData.anime_id,
      streamData.episode_num,
      streamData.server_name,
      streamData.stream_type || 'embed',
      streamData.video_url,
      streamData.quality || '1080p'
    );

    return id || res.lastInsertRowid;
  },

  async deleteCustomStream(id) {
    if (this.isSupabaseReady()) {
      try {
        await supabase.from('custom_streams').delete().eq('id', id);
      } catch (_) {}
    }
    localDb.prepare('DELETE FROM custom_streams WHERE id = ?').run(id);
  },

  // CACHE (Fast local / sqlite)
  getCache(key) {
    const row = localDb.prepare('SELECT value, expires_at FROM api_cache WHERE key = ?').get(key);
    if (!row) return null;
    if (Date.now() > row.expires_at) {
      localDb.prepare('DELETE FROM api_cache WHERE key = ?').run(key);
      return null;
    }
    try {
      return JSON.parse(row.value);
    } catch (_) {
      return null;
    }
  },

  getStaleCache(key) {
    const row = localDb.prepare('SELECT value FROM api_cache WHERE key = ?').get(key);
    if (!row) return null;
    try {
      return JSON.parse(row.value);
    } catch (_) {
      return null;
    }
  },

  setCache(key, value, ttlSeconds = 300) {
    const expiresAt = Date.now() + (ttlSeconds * 1000);
    localDb.prepare(`
      INSERT INTO api_cache (key, value, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        expires_at = excluded.expires_at
    `).run(key, JSON.stringify(value), expiresAt);
  },

  clearCache() {
    localDb.prepare('DELETE FROM api_cache').run();
  },

  // Raw helper for custom queries
  localDb
};

module.exports = db;
