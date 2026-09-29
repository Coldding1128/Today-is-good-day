# 项目长期笔记 · 今天是个好日子啊 服务器网站

## 架构
- Cloudflare Pages（静态站）+ Pages Functions（`functions/`）+ D1 数据库 + R2 存储（桶 `goodday-shots`）。
- 前端：单文件 HTML + Tailwind CDN，零构建。
- 页面：`index.html`（主页）、`gallery/`（画廊 + 腐竹审核台）、`packs/`（下载 + 腐竹上传台）。

## ⚠️ 约定：整合包 id 必须三处同步
新增/切换周目时，下面三处的 id 必须同时更新，否则会出现「选了整合包却存成通用」「投稿被拒 bad_pack」等静默失败：
1. 服务端白名单 `functions/_lib.js` → `PACK_IDS`
2. 画廊 `gallery/index.html` → `MODPACKS`
3. 主页 `index.html` → `PACK_NAMES`（主页精选截图用）
（当前周目：`tfc` = 群峦重生2 冲向月球）

## 鉴权
- 审核码 = 环境变量 `ADMIN_CODE`（缺失时退化 `UPLOAD_CODE`）。
- 前端把码存 localStorage `gd_admin_code`；画廊审核台、下载上传台、主页群公告**共用同一个码**。

## 部署 & 数据库
- 部署脚本 `update.bat`：`git add .` → `commit` → `push`。
- 改动 `functions/` 或 D1 表结构后必须重新部署才生效。
- D1 表结构见 `schema.sql`。**每条 SQL 单独执行**，不要把 `--` 行内注释和语句写在同一行粘贴（D1 控制台会压成一行，`--` 会吞掉后面内容，报 `incomplete input`）。

## 数据表
- `photos`：截图投稿（pack_id/title/uploader/r2_key/status/featured/created_at）。
- `announcements`：群公告（title/content/pack_id/created_at）。
