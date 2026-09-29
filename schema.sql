-- 今天是个好日子啊 · D1 表结构
-- 用法：Cloudflare 后台 → 存储和数据库 → D1 → 选中数据库 → 控制台，
--       下面每条 SQL 各粘贴执行一次（一条一条来）。
--
-- ⚠️ 重要：不要在分号之前写 -- 行内注释。
--    D1 控制台会把粘贴的内容压成一行，-- 之后的东西会被整段当注释吞掉，
--    结果语句缺结尾的 ) 而报 "incomplete input"。所有注释都独立成行写在语句上方。

-- ---------- 1. 截图投稿表 ----------
CREATE TABLE IF NOT EXISTS photos (id INTEGER PRIMARY KEY AUTOINCREMENT, pack_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', uploader TEXT NOT NULL DEFAULT '', r2_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', featured INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')));
-- pack_id 对应 gallery 页 MODPACKS 的 id；status = pending/approved/rejected；featured=1 表示主页精选

CREATE INDEX IF NOT EXISTS idx_photos_status ON photos (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_photos_pack ON photos (pack_id, status, created_at DESC);

-- ---------- 2. 群公告表（主页「群公告」栏目） ----------
CREATE TABLE IF NOT EXISTS announcements (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')));

-- ---------- 3. 已经建过 photos 表、后来才补 featured 列时用这一句 ----------
-- 把下一行开头的 "-- " 去掉再执行一次即可（重复执行报 duplicate column name 属正常）
-- ALTER TABLE photos ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;
