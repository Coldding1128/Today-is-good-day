/**
 * POST /api/admin —— 腐竹端：审核 / 删除 / 精选
 *
 * 审核码来自环境变量 ADMIN_CODE（没设就退化成 UPLOAD_CODE）。
 * body: { code, action: 'list' | 'approve' | 'reject' | 'delete' | 'feature', id?, featured? }
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
        /* featured 列是后加的。如果还没执行那条 ALTER TABLE，
           带 featured 的排序会直接报错，所以退一步用旧排序跑，
           并在返回里带上 legacy 标记，让审核台能明确提示「去更新数据库」，
           而不是让腐竹对着一张点不动的按钮猜原因 */
        const base = "SELECT * FROM photos ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END";
        const attempts = [
            { sql: base + ", CASE WHEN featured = 1 THEN 0 ELSE 1 END, created_at DESC LIMIT 500", legacy: false },
            { sql: base + ", created_at DESC LIMIT 500", legacy: true }
        ];
        for (const a of attempts) {
            try {
                const { results } = await env.DB.prepare(a.sql).all();
                return json({ photos: (results || []).map(toPhoto), legacy: a.legacy });
            } catch (e) { /* 换下一条 */ }
        }
        return json({ error: 'db_error' }, 500);
    }

    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad_id' }, 400);

    try {
        if (action === 'approve' || action === 'reject') {
            await env.DB.prepare('UPDATE photos SET status = ? WHERE id = ?')
                .bind(action === 'approve' ? 'approved' : 'rejected', id).run();
            return json({ ok: true, action });
        }
        if (action === 'feature') {
            /* 设 / 取消「精选」。只有已通过的图才允许上精选 ——
               驳回到 published 之外的东西不该出现在主页上 */
            const on = body.featured ? 1 : 0;
            const row = await env.DB.prepare('SELECT status FROM photos WHERE id = ?').bind(id).first();
            if (!row) return json({ error: 'not_found' }, 404);
            if (on && row.status !== 'approved') return json({ error: 'not_approved' }, 409);
            await env.DB.prepare('UPDATE photos SET featured = ? WHERE id = ?').bind(on, id).run();
            return json({ ok: true, action, featured: on });
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
