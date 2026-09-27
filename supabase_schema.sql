-- ========================================================
-- NEKUMI STREAM - SUPABASE DATABASE INITIALIZATION SCHEMA
-- Run this script in your Supabase Dashboard -> SQL Editor
-- ========================================================

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS public.users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  avatar TEXT DEFAULT '',
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  episodes_watched INTEGER DEFAULT 0,
  watch_minutes REAL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. WATCH HISTORY TABLE
CREATE TABLE IF NOT EXISTS public.history (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  anime_id BIGINT NOT NULL,
  anime_title TEXT NOT NULL,
  anime_image TEXT,
  episode_num INTEGER NOT NULL DEFAULT 1,
  episode_title TEXT,
  progress_seconds REAL DEFAULT 0,
  duration_seconds REAL DEFAULT 0,
  percentage REAL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_history_user_anime UNIQUE(user_id, anime_id)
);

-- 3. BOOKMARKS / FAVORITES TABLE
CREATE TABLE IF NOT EXISTS public.bookmarks (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  anime_id BIGINT NOT NULL,
  anime_title TEXT NOT NULL,
  anime_image TEXT,
  anime_type TEXT DEFAULT 'TV',
  anime_score REAL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_bookmarks_user_anime UNIQUE(user_id, anime_id)
);

-- 4. CUSTOM STREAMS TABLE (Admin server management)
CREATE TABLE IF NOT EXISTS public.custom_streams (
  id BIGSERIAL PRIMARY KEY,
  anime_id BIGINT NOT NULL,
  episode_num INTEGER NOT NULL,
  server_name TEXT NOT NULL,
  stream_type TEXT NOT NULL DEFAULT 'embed',
  video_url TEXT NOT NULL,
  quality TEXT DEFAULT '1080p',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. COMMENTS TABLE
CREATE TABLE IF NOT EXISTS public.comments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  anime_id BIGINT NOT NULL,
  episode_num INTEGER DEFAULT 1,
  comment_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. ANNOUNCEMENTS TABLE
CREATE TABLE IF NOT EXISTS public.announcements (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT DEFAULT 'info',
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. API CACHE TABLE
CREATE TABLE IF NOT EXISTS public.api_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);

-- 8. EMAIL VERIFICATIONS & PASSWORD RESETS
CREATE TABLE IF NOT EXISTS public.email_verifications (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.password_resets (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CREATE USEFUL INDEXES
CREATE INDEX IF NOT EXISTS idx_history_user_id ON public.history(user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id ON public.bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_anime_id ON public.comments(anime_id);
CREATE INDEX IF NOT EXISTS idx_custom_streams_anime ON public.custom_streams(anime_id, episode_num);

-- DISABLE RLS FOR INTERNAL NODE BACKEND DIRECT API ACCESS
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.history DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookmarks DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_streams DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_cache DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_verifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_resets DISABLE ROW LEVEL SECURITY;

-- SEED REQUIRED ADMIN ACCOUNT:
-- Username: Satriyaa
-- Password: Satriyaa1990#
-- Role: admin
-- Level: 99
INSERT INTO public.users (username, email, password, role, avatar, level, xp, episodes_watched, watch_minutes)
VALUES (
  'Satriyaa',
  'admin@nekumi.com',
  '$2b$10$Wi.AeZv2mroqm9d/yj.0q.kK/awJVnI5cWDOoaE2h3clQ1MkKEdpe',
  'admin',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Satriyaa',
  99,
  9800,
  150,
  3600
)
ON CONFLICT (username) DO UPDATE SET
  password = EXCLUDED.password,
  role = 'admin',
  level = EXCLUDED.level;

-- SEED DEFAULT ANNOUNCEMENT
INSERT INTO public.announcements (id, title, content, type, is_active)
VALUES (
  1,
  '🐱 Selamat Datang di NekumiStream (Supabase Edition)!',
  'Platform streaming anime subtitle Indonesia gratis terlengkap dengan fitur Level Streamer dan pilihan server terbaik!',
  'info',
  1
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content;
