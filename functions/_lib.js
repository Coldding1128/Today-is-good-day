/**
 * Pages Functions 共用工具。
 * 注意：functions/ 下以 _ 开头的文件不参与路由，只作为共享模块被 import。
 */

/* 与 gallery/index.html 里 MODPACKS 的 id 一一对应。
   服务端单独存一份，是为了不信任前端传来的 pack_id —— 投稿只能落到这 20 个周目里。 */
export const PACK_IDS = [
    'cobblemon', 'vanilla-food', 'element', 'lastone', 'combat', 'alert',
    'mech2', 'newsteam', 'atm10', 'newgen', 'swordking', 'curtain',
    'farm', 'deadworld', 'mech', 'fool', 'swordking-beta', 'utopia-fix',
    'utopia', 'vanilla'
];

/* ============================================================
   整合包下载 —— 目录即列表
   ------------------------------------------------------------
   把整合包压缩包丢进 R2 桶（goodday-shots）的 packs/ 文件夹就行，
   文件名随便起（中文、空格、带版本号都可以）。
   网站会自己扫描这个目录并列出来，不需要改任何代码。
   换周目 = 传新文件（旧的可以留着也能删）。
   ============================================================ */
export const PACK_PREFIX = 'packs/';

/* 下面这张表是「可选的补充信息」，不填完全能用：
   名字、版本默认从文件名里读；这里只是用来补那些文件名说不清的东西，
   比如介绍视频、更整齐的显示名。键名写 packs/ 下的文件名。 */
export const PACK_META = {
    // '去吧方可梦大师 v5.9.2（MC1.21.1）.zip': {
    //     name: '去吧，方可梦大师',
    //     version: 'v5.9.2',
    //     mc: '1.21.1',
    //     video: 'https://www.bilibili.com/video/BV1QU8X6LEYP/',
    //     note: '一句话说明，会显示在卡片上',
    //     theme: 'poke'
    // }
};

export const MAX_BYTES = 6 * 1024 * 1024;               // 单张上限 6MB（前端已压过，正常不超过 500KB）
export const TYPES = {                                   // 只收这三种
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
};

export function json(data, status = 200, extra = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: Object.assign({
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
        }, extra)
    });
}

/** 清理用户输入：去掉控制字符与尖括号，并截断 */
export function clean(v, max) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001F<>]/g, ' ').trim().slice(0, max);
}

/** 数据库行 → 前端要的形状（前端只认 url，不关心 r2_key） */
export function toPhoto(row) {
    return {
        id: row.id,
        pack: row.pack_id,
        title: row.title || '',
        by: row.uploader || '',
        url: '/img/' + row.r2_key,
        status: row.status,
        at: row.created_at,
        /* 腐竹在审核台勾选的「精选」，会排到主页前面。
           写成 row.featured ? 1 : 0 而不是直接取字段：万一 featured 列还没加上，
           这里拿到 undefined 也只是当作 0，不会把整个接口带崩 */
        featured: row.featured ? 1 : 0
    };
}
