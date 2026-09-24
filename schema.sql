-- 今天是个好日子啊 · 截图投稿 D1 表结构
-- 用法：Cloudflare 后台 → 存储和数据库 → D1 → 选中数据库 → 控制台，把下面整段粘贴执行

CREATE TABLE IF NOT EXISTS photos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    pack_id    TEXT    NOT NULL,                 -- 整合包 id，对应 gallery 页里的 MODPACKS
    title      TEXT    NOT NULL DEFAULT '',      -- 截图说明
    uploader   TEXT    NOT NULL DEFAULT '',      -- 投稿人昵称
    r2_key     TEXT    NOT NULL,                 -- R2 里的对象名
    status     TEXT    NOT NULL DEFAULT 'pending', -- pending / approved / rejected
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- 画廊只按 status='approved' 拉取，待审走审核面板
CREATE INDEX IF NOT EXISTS idx_photos_status ON photos (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_pack   ON photos (pack_id, status, created_at DESC);
