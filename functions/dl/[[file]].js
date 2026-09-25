/**
 * GET /dl/<key> —— 从 R2 下载整合包文件
 *
 * 为什么不让它读任意 key：R2 桶里还存着玩家投稿的截图，
 * 如果这里不限制，别人就能拿 /dl/xxx-xxx.jpg 把图拖走。
 * 所以只放行 packs/ 前缀下的文件 —— 截图不在这个前缀里，天然隔离。
 *
 * 支持 Range 请求：整合包动辄几百 MB 到 1 GB+，
 * 断网后能续传，对玩家的下载体验差别很大。
 */
import { PACK_PREFIX } from '../_lib.js';

export async function onRequestGet({ params, env, request }) {
    if (!env.BUCKET) return new Response('not configured', { status: 503 });

    /* catch-all 参数：单段时是字符串，多段时是数组，两种都兼容 */
    const raw = params.file;
    const joined = (Array.isArray(raw) ? raw.join('/') : String(raw || '')).replace(/^\/+/, '');

    /* 文件名带中文或空格时，拿到的可能是百分号编码、也可能已经解码过。
       解码失败（文件名里本来就有 % ）就退回原样，不要炸。 */
    let key = joined;
    try {
        const decoded = decodeURIComponent(joined);
        if (decoded) key = decoded;
    } catch (e) { /* 保持原样 */ }

    if (key.indexOf(PACK_PREFIX) !== 0 || key.indexOf('..') !== -1) {
        return new Response('not found', { status: 404 });
    }

    const head = await env.BUCKET.head(key);
    if (!head) return new Response('not found', { status: 404 });

    const total = head.size || 0;
    /* 下载到本地的文件名就沿用 R2 里的名字（去掉 packs/ 前缀）。
       ASCII 兜底名去掉中文后可能只剩版本号，所以留一个保底。 */
    const fileName = key.slice(PACK_PREFIX.length);
    const asciiName = fileName.replace(/[^\x20-\x7E]/g, '').replace(/"/g, '').trim() || 'pack.zip';
    /* 按扩展名给类型：exe 别报成 zip，否则浏览器下载器的提示会不对 */
    const ext = (fileName.match(/\.([a-z0-9]+)$/i) || [])[1] || '';
    const MIME = {
        zip: 'application/zip',
        mrpack: 'application/zip',
        rar: 'application/vnd.rar',
        '7z': 'application/x-7z-compressed',
        exe: 'application/octet-stream'
    };
    const headers = {
        'content-type': MIME[ext.toLowerCase()] || 'application/octet-stream',
        'content-disposition': 'attachment; filename="' + asciiName + '";'
            + " filename*=UTF-8''" + encodeURIComponent(fileName),
        'cache-control': 'public, max-age=3600',
        'accept-ranges': 'bytes',
        'etag': head.httpEtag
    };

    /* ---------- Range：断点续传 ---------- */
    const range = request.headers.get('range');
    if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        if (m) {
            let start, end;
            if (m[1] === '') {
                /* bytes=-500 → 最后 500 字节 */
                const tail = parseInt(m[2], 10) || 0;
                start = Math.max(0, total - tail);
                end = total - 1;
            } else {
                start = parseInt(m[1], 10);
                end = m[2] === '' ? total - 1 : Math.min(parseInt(m[2], 10), total - 1);
            }
            if (start <= end && start < total) {
                const part = await env.BUCKET.get(key, { range: { offset: start, length: end - start + 1 } });
                if (part) {
                    return new Response(part.body, {
                        status: 206,
                        headers: Object.assign({}, headers, {
                            'content-range': 'bytes ' + start + '-' + end + '/' + total,
                            'content-length': String(end - start + 1)
                        })
                    });
                }
            } else {
                return new Response('range not satisfiable', {
                    status: 416, headers: { 'content-range': 'bytes */' + total }
                });
            }
        }
    }

    const obj = await env.BUCKET.get(key);
    if (!obj) return new Response('not found', { status: 404 });

    return new Response(obj.body, {
        headers: Object.assign({}, headers, { 'content-length': String(total) })
    });
}
