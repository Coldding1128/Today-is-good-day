/**
 * POST /api/upload —— 成员投稿
 *
 * 门槛校验在服务端做：上传码来自环境变量 UPLOAD_CODE，
 * 不写进任何前端文件，所以没法按 F12 直接从网页里读出来。
 */
import { PACK_IDS, MAX_BYTES, TYPES, json, clean } from '../_lib.js';

export async function onRequestPost({ request, env }) {
    if (!env.UPLOAD_CODE) return json({ error: 'not_configured' }, 503);

    let form;
    try {
        form = await request.formData();
    } catch (e) {
        return json({ error: 'bad_form' }, 400);
    }

    /* 上传码：服务端比对 */
    if (clean(form.get('code'), 64) !== env.UPLOAD_CODE) {
        return json({ error: 'bad_code' }, 403);
    }

    /* 解锁用：只验码，不落库不落盘 */
    if (clean(form.get('verify'), 4) === '1') return json({ ok: true });

    /* 整合包：只认白名单 */
    const pack = clean(form.get('pack'), 32);
    if (PACK_IDS.indexOf(pack) === -1) return json({ error: 'bad_pack' }, 400);

    /* 文件：类型与体积 */
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'no_file' }, 400);
    const ext = TYPES[file.type];
    if (!ext) return json({ error: 'bad_type', allow: Object.keys(TYPES) }, 415);
    if (file.size > MAX_BYTES) return json({ error: 'too_large', max: MAX_BYTES }, 413);

    const title = clean(form.get('title'), 40) || '未命名';
    const uploader = clean(form.get('uploader'), 16);

    /* 对象名用随机串，不用原始文件名——避免中文名、重名和路径穿越 */
    const key = Date.now().toString(36) + '-' + crypto.randomUUID().slice(0, 8) + '.' + ext;

    try {
        await env.BUCKET.put(key, await file.arrayBuffer(), {
            httpMetadata: {
                contentType: file.type,
                cacheControl: 'public, max-age=31536000, immutable'
            }
        });
        const res = await env.DB
            .prepare('INSERT INTO photos (pack_id, title, uploader, r2_key, status) VALUES (?, ?, ?, ?, ?)')
            .bind(pack, title, uploader, key, 'pending')
            .run();
        return json({ ok: true, id: res.meta.last_row_id, status: 'pending' });
    } catch (e) {
        return json({ error: 'server_error' }, 500);
    }
}
