/**
 * GET /dl/<key> —— 从 R2 下载整合包文件
 *
 * 为什么不让它读任意 key：R2 桶里还存着玩家投稿的截图，
 * 如果这里不限制，别人就能拿 /dl/xxx-xxx.jpg 把图拖走。
 * 所以只放行 DOWNLOADS 清单里出现过的 key，其余一律 404。
 *
 * 支持 Range 请求：整合包动辄几百 MB 到 1 GB+，
 * 断网后能续传，对玩家的下载体验差别很大。
 */
import { DOWNLOADS } from '../_lib.js';

export async function onRequestGet({ params, env, request }) {
    if (!env.BUCKET) return new Response('not configured', { status: 503 });

    /* catch-all 参数：单段时是字符串，多段时是数组，两种都兼容 */
    const raw = params.file;
    const key = (Array.isArray(raw) ? raw.join('/') : String(raw || '')).replace(/^\/+/, '');

    const item = DOWNLOADS.find(function (d) { return d.key === key; });
    if (!item) return new Response('not found', { status: 404 });

    const head = await env.BUCKET.head(key);
    if (!head) return new Response('not uploaded yet', { status: 404 });

    const total = head.size || 0;
    const name = item.name + ' ' + item.version + '.zip';
    const headers = {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="' + item.id + '-' + item.version + '.zip";'
            + " filename*=UTF-8''" + encodeURIComponent(name),
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
