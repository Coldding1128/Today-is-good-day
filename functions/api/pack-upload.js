/**
 * POST /api/pack-upload —— 腐竹上传整合包（分片，绕过网页后台 300 MB 的上限）
 *
 * R2 的网页后台上传有 300 MB 硬限制，整合包基本都超。这个接口走 R2 的
 * multipart 上传：前端把文件切片，一片一片发过来，最后由 R2 合并成一个完整的文件。
 * 每片控制在 80 MB 以内，所以不会撞上 Workers 的请求体上限（免费版 100 MB）。
 *
 * 用 ?action= 区分四个动作：
 *   init      开始上传 → 返回 R2 的 uploadId
 *   part      传一片   → 返回这一片的 etag
 *   complete  收尾     → 把所有片的 etag 交给 R2 合并
 *   abort     放弃     → 清掉半途而废的分片，不占存储
 *
 * 为什么不在服务端存上传状态：uploadId 和每片的 etag 都由前端带着走，
 * 这样不用新建数据表、也不用你去 D1 跑 SQL。
 * 代价只有一个：上传中途刷新页面就要重来（所以前端会提示别刷新）。
 *
 * 鉴权：请求头 x-admin-code，值就是审核台的审核码（ADMIN_CODE）。
 */
import { json, clean, PACK_PREFIX, presignPutUrl } from '../_lib.js';

const MAX_NAME_LEN = 120;   // 文件名截断长度（R2 的 key 上限是 1024 字节，中文够用）
const MAX_PARTS = 200;      // 每片最少 5 MiB，200 片足够应付 10 GB

/* R2 免费额度是 10 GB，超了要按量计费。默认按 10 GB 卡住不让传，
   想放宽就配个环境变量 R2_QUOTA_GB（比如 50）。 */
function quotaBytes(env) {
    const gb = Number(env.R2_QUOTA_GB);
    return (gb > 0 ? gb : 10) * 1024 * 1024 * 1024;
}

/** 扫一遍 packs/ 目录，算出整合包占了多少 */
async function usedBytes(env) {
    const res = await env.BUCKET.list({ prefix: PACK_PREFIX, limit: 1000 });
    return (res.objects || [])
        .filter(function (o) { return o.key && !/\/$/.test(o.key); })
        .reduce(function (sum, o) { return sum + (o.size || 0); }, 0);
}

/** 把用户给的文件名收拾成安全的 R2 key：保留中文和空格，去掉路径分隔符与控制字符 */
function safeKey(fileName) {
    const base = String(fileName == null ? '' : fileName)
        .replace(/[\u0000-\u001F<>\\/:*?"|]/g, '_')   // 路径分隔符与非法字符
        .replace(/\.{2,}/g, '_')                      // 连续的点（路径穿越的残留）一并消灭
        .replace(/\s+/g, ' ')
        .trim();

    /* 截断时要把扩展名留住 —— 否则下载列表按扩展名过滤，这个文件就凭空消失了 */
    const ext = (base.match(/\.[a-z0-9]{1,8}$/i) || [''])[0];
    const stem = ext ? base.slice(0, -ext.length) : base;
    const safe = stem.slice(0, Math.max(1, MAX_NAME_LEN - ext.length)) + ext;

    return PACK_PREFIX + (safe || 'pack.zip');
}

export async function onRequestPost({ request, env }) {
    const secret = env.ADMIN_CODE || env.UPLOAD_CODE;
    if (!secret || !env.BUCKET) return json({ error: 'not_configured' }, 503);

    /* 所有动作都要认码 —— 包括传分片，否则知道 key 的人就能往你的上传里塞数据 */
    const code = clean(request.headers.get('x-admin-code'), 64);
    if (code !== secret) return json({ error: 'bad_code' }, 403);

    const url = new URL(request.url);
    const action = clean(url.searchParams.get('action'), 16);
    const key = clean(url.searchParams.get('key'), 300);
    const id = clean(url.searchParams.get('id'), 300);

    /* ---------- init：开一次 multipart 上传 ---------- */
    if (action === 'init') {
        let body;
        try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
        /* 这里不能先 clean() 截断 —— 会把扩展名切掉，导致文件传上去却不显示。
           清理和截断统一交给 safeKey，它会保住扩展名 */
        const target = safeKey(body.file);
        try {
            const up = await env.BUCKET.createMultipartUpload(target);
            return json({ ok: true, key: target, uploadId: up.uploadId });
        } catch (e) {
            return json({ error: 'r2_error', detail: String(e).slice(0, 120) }, 500);
        }
    }

    /* ---------- list：看现在有哪些包、占了多少空间（腐竹在弹窗里看） ---------- */
    if (action === 'list') {
        try {
            const res = await env.BUCKET.list({ prefix: PACK_PREFIX, limit: 1000 });
            const files = (res.objects || [])
                .filter(function (o) { return o.key && !/\/$/.test(o.key); })
                .map(function (o) {
                    return {
                        key: o.key,
                        name: o.key.slice(PACK_PREFIX.length),
                        size: o.size || 0,
                        updated: o.uploaded ? new Date(o.uploaded).toISOString().slice(0, 10) : ''
                    };
                })
                .sort(function (a, b) { return (b.updated > a.updated) ? 1 : -1; });
            const used = files.reduce(function (s, f) { return s + f.size; }, 0);
            const limit = quotaBytes(env);
            return json({ ok: true, files: files, used: used, limit: limit });
        } catch (e) {
            return json({ error: 'list_failed', detail: String(e).slice(0, 120) }, 500);
        }
    }

    /* ---------- delete：删掉一个包，腾出空间 ---------- */
    if (action === 'delete') {
        let body;
        try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
        const target = clean(body.key, 300);
        /* 只允许删 packs/ 下的东西 —— 截图不在这个前缀里，误删不了 */
        if (target.indexOf(PACK_PREFIX) !== 0 || target.indexOf('..') !== -1) {
            return json({ error: 'bad_key' }, 400);
        }
        try {
            await env.BUCKET.delete(target);
            return json({ ok: true, key: target });
        } catch (e) {
            return json({ error: 'delete_failed', detail: String(e).slice(0, 120) }, 500);
        }
    }

    /* ---------- sign：签发一个直传 R2 的网址（当前前端走的就是这条路） ----------
       浏览器拿到签名后的 URL 之后直接 PUT 到 R2，数据完全不经过 Worker，
       这样就绕开了「大文件经 Worker 中转写 R2 会失败」的问题。
       需要的三个值在 Cloudflare 后台生成后配成环境变量。 */
    if (action === 'sign') {
        let body;
        try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }

        const accountId = env.R2_ACCOUNT_ID;
        const ak = env.R2_ACCESS_KEY_ID;
        const sk = env.R2_SECRET_ACCESS_KEY;
        if (!accountId || !ak || !sk) {
            return json({ error: 'not_configured', detail: '还没配 R2 直传密钥' }, 503);
        }

        /* 先看看还剩多少空间。配额是按「传完之后」算的，
           所以要把这次要传的大小一起加进去判断 */
        const incoming = Number(body.size) || 0;
        let used = 0;
        try { used = await usedBytes(env); } catch (e) { /* 查不到就不拦，别把上传卡死 */ }
        const limit = quotaBytes(env);
        if (incoming > 0 && used + incoming > limit) {
            return json({
                error: 'quota_exceeded',
                used: used,
                limit: limit,
                incoming: incoming,
                detail: '空间不够了，先删掉几个旧包再传'
            }, 413);
        }

        const target = safeKey(body.file);
        try {
            const signed = await presignPutUrl({
                accountId: accountId,
                accessKeyId: ak,
                secretAccessKey: sk,
                bucket: env.R2_BUCKET_NAME || 'goodday-shots',
                key: target,
                expires: 3600
            });
            return json({ ok: true, key: target, url: signed.url, expires: signed.expires });
        } catch (e) {
            return json({ error: 'sign_failed', detail: String(e).slice(0, 140) }, 500);
        }
    }

    /* ---------- diag：分步诊断，用来定位 part 为什么失败 ----------
       收下同样大小的一份数据，依次试「单次 put」「建 multipart」「传一片」，
       把每一步的结果回给前端。这样失败时能直接看出卡在哪，不用再猜。 */
    if (action === 'diag') {
        const out = {};
        let buf;
        try {
            buf = await request.arrayBuffer();
            out.bodyBytes = buf.byteLength;
        } catch (e) {
            out.readBody = 'FAIL ' + String(e).slice(0, 120);
            return json(out);
        }

        /* A. 对照：用单次 put 写同样大小的数据 */
        try {
            await env.BUCKET.put('packs/.diag-put.tmp', buf);
            out.put = 'ok';
        } catch (e) {
            out.put = 'FAIL ' + String(e).slice(0, 140);
        }
        try { await env.BUCKET.delete('packs/.diag-put.tmp'); } catch (e) {}

        /* B. multipart：建会话 + 传一片 */
        try {
            const up = await env.BUCKET.createMultipartUpload('packs/.diag-mpu.tmp');
            out.create = 'ok';
            try {
                const p = await up.uploadPart(1, buf);
                out.uploadPart = 'ok etag=' + String(p.etag || '').slice(0, 24);
            } catch (e) {
                out.uploadPart = 'FAIL ' + String(e).slice(0, 140);
            }
            try { await up.abort(); } catch (e) {}
        } catch (e) {
            out.create = 'FAIL ' + String(e).slice(0, 140);
        }

        return json(out);
    }

    if (key.indexOf(PACK_PREFIX) !== 0) return json({ error: 'bad_key' }, 400);
    if (!id) return json({ error: 'bad_id' }, 400);

    let upload;
    try {
        upload = env.BUCKET.resumeMultipartUpload(key, id);
    } catch (e) {
        return json({ error: 'r2_error' }, 500);
    }

    /* ---------- part：收一片 ---------- */
    if (action === 'part') {
        const n = Number(url.searchParams.get('n'));
        if (!Number.isInteger(n) || n < 1 || n > MAX_PARTS) return json({ error: 'bad_part' }, 400);
        if (!request.body) return json({ error: 'no_body' }, 400);

        /* 必须先把请求体读成内存里的字节，再交给 R2。
           直接把 request.body（ReadableStream）交给 uploadPart 会报
           "Network connection lost" —— R2 要求流必须有「已知长度」，
           而经 Cloudflare 边缘转发过来的 request.body 不满足这个前提（社区有同款案例，
           解法同样是先缓冲成 ArrayBuffer）。每片只有 10 MB，读进内存完全安全。 */
        let buf;
        try {
            buf = await request.arrayBuffer();
        } catch (e) {
            return json({ error: 'read_body_failed', detail: String(e).slice(0, 120) }, 400);
        }
        if (!buf || !buf.byteLength) return json({ error: 'empty_body' }, 400);

        try {
            const part = await upload.uploadPart(n, buf);
            return json({ ok: true, n: part.partNumber, etag: part.etag, bytes: buf.byteLength });
        } catch (e) {
            return json({
                error: 'part_failed',
                detail: String(e).slice(0, 140),
                sentBytes: buf.byteLength
            }, 500);
        }
    }

    /* ---------- abort：放弃，把已传的分片清掉 ---------- */
    if (action === 'abort') {
        try { await upload.abort(); } catch (e) { /* 已经不存在就算了 */ }
        return json({ ok: true });
    }

    /* ---------- complete：合并 ---------- */
    if (action === 'complete') {
        let body;
        try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
        const parts = (body.parts || [])
            .map(function (p) { return { partNumber: Number(p.partNumber), etag: String(p.etag || '') }; })
            .filter(function (p) { return Number.isInteger(p.partNumber) && p.etag; })
            .sort(function (a, b) { return a.partNumber - b.partNumber; });
        if (!parts.length) return json({ error: 'no_parts' }, 400);
        try {
            const obj = await upload.complete(parts);
            return json({ ok: true, key: obj.key, size: obj.size });
        } catch (e) {
            return json({ error: 'complete_failed', detail: String(e).slice(0, 140) }, 500);
        }
    }

    return json({ error: 'bad_action' }, 400);
}
