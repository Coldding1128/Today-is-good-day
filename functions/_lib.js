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
        at: row.created_at
    };
}
