/**
 * POST /api/admin —— 腐竹端：审核 / 删除
 *
 * 审核码来自环境变量 ADMIN_CODE（没设就退化成 UPLOAD_CODE）。
 * body: { code, action: 'list' | 'approve' | 'reject' | 'delete', id? }
 */
import { json, clean, toPhoto } from '../_lib.js';

export async function onRequestPost({ request, env }) {
    const secret = env.ADMIN_CODE || env.UPLOAD_CODE;
    if (!secret || !env.DB) return json({ error: 'not_configured' }, 503);

    let body;
    try {
        body = await request.json();
    } catch (e) {
        return json({ error: 'bad_json' }, 400);
    }
    if (clean(body && body.code, 64) !== secret) return json({ error: 'bad_code' }, 403);

    const action = clean(body.action, 16);

    if (action === 'list') {
        try {
            const { results } = await env.DB.prepare(
                "SELECT id, pack_id, title, uploader, r2_key, status, created_at FROM photos "
                + "ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 500"
            ).all();
            return json({ photos: (results || []).map(toPhoto) });
        } catch (e) {
            return json({ error: 'db_error' }, 500);
        }
    }

    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad_id' }, 400);

    try {
        if (action === 'approve' || action === 'reject') {
            await env.DB.prepare('UPDATE photos SET status = ? WHERE id = ?')
                .bind(action === 'approve' ? 'approved' : 'rejected', id).run();
            return json({ ok: true, action });
        }
        if (action === 'delete') {
            const row = await env.DB.prepare('SELECT r2_key FROM photos WHERE id = ?').bind(id).first();
            if (row && row.r2_key) await env.BUCKET.delete(row.r2_key);   // 先删文件，避免留下孤儿对象
            await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id).run();
            return json({ ok: true, action });
        }
    } catch (e) {
        return json({ error: 'db_error' }, 500);
    }

    return json({ error: 'bad_action' }, 400);
}
