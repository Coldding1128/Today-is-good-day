/**
 * GET /api/downloads —— 站内可下载的整合包列表
 *
 * 「目录即列表」：直接扫 R2 里 packs/ 这个前缀下的文件，
 * 传进去几个就列几个 —— 换整合包只需传/删文件，不用改代码。
 *
 * 文件名会尽量解析成人看得懂的样子：
 *   去吧方可梦大师 v5.9.2.zip  →  名称「去吧方可梦大师」+ 版本「v5.9.2」
 * 也可以在 _lib.js 的 PACK_META 里覆盖任意一项。
 */
import { json, PACK_PREFIX, PACK_META } from '../_lib.js';

/* 只列整合包压缩包，避免把误传的其他东西也摆出来 */
const PACK_EXT = /\.(zip|rar|7z|mrpack)$/i;

/** 从文件名里拆出名称和版本：末尾的 v1.2.3 / 1.2.3 会被当作版本号 */
function splitName(base) {
    const m = /^(.*?)[\s_\-]*[vV]?(\d+(?:\.\d+)+)\s*$/.exec(base);
    if (m && m[1].trim()) {
        return { name: m[1].trim().replace(/[\s_\-]+$/, ''), version: 'v' + m[2] };
    }
    return { name: base.trim(), version: '' };
}

/** 上传时间 → 北京时间「YYYY-MM-DD HH:mm」，精确到分钟 */
function fmtMin(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const t = new Date(d.getTime() + 8 * 3600 * 1000); /* UTC → 北京时间 */
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate())
        + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes());
}

export async function onRequestGet({ env }) {
    if (!env.BUCKET) return json({ downloads: [], configured: false });

    let objects = [];
    try {
        /* 一页 200 个足够用；真超了再说 */
        const res = await env.BUCKET.list({ prefix: PACK_PREFIX, limit: 200 });
        objects = (res && res.objects) || [];
    } catch (e) {
        return json({ downloads: [], error: 'list_failed' });
    }

    const list = objects
        .filter(function (o) {
            /* 跳过文件夹占位（key 以 / 结尾）和非压缩包 */
            return o.key && !/\/$/.test(o.key) && PACK_EXT.test(o.key);
        })
        .sort(function (a, b) {
            /* 新传的排前面 —— 刚换的周目通常就是你最想让玩家下到的那个 */
            return new Date(b.uploaded || 0) - new Date(a.uploaded || 0);
        })
        .map(function (o, i) {
            const file = o.key.slice(PACK_PREFIX.length);
            const base = file.replace(/\.[^.]+$/, '');
            const guess = splitName(base);
            const meta = PACK_META[file] || PACK_META[o.key] || {};

            return {
                key: o.key,
                file: file,
                name: meta.name || guess.name,
                version: meta.version || guess.version,
                mc: meta.mc || '',
                note: meta.note || '',
                video: meta.video || '',
                theme: meta.theme || 'vanilla',
                size: o.size || 0,
                updated: o.uploaded ? fmtMin(o.uploaded) : '',
                /* 最新传的那个，给一枚「最新」小标 —— 只是客观事实，不猜哪个在运行 */
                latest: i === 0,
                /* 路径段逐个编码，中文 / 空格文件名在 URL 里才不会坏事 */
                url: '/dl/' + o.key.split('/').map(encodeURIComponent).join('/')
            };
        });

    return json({ downloads: list, configured: true }, 200, {
        /* 传完文件最多一分钟页面就会自己出现 */
        'cache-control': 'public, max-age=60'
    });
}
