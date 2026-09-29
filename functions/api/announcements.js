/**
 * 群公告
 *   GET  /api/announcements      —— 公开读取（所有人可见）
 *   POST /api/announcements      —— 腐竹管理，body: { code, action, id?, content? }
 *       action: 'create' | 'update' | 'delete'
 * 鉴权码复用审核台/上传台的 ADMIN_CODE（没设就退化成 UPLOAD_CODE）。
 */
import { json, clean } from '../_lib.js';

function toAnn(r) {
    return { id: r.id, content: r.content || '', created_at: r.created_at };
}

/** 公告正文：保留换行、去掉尖括号防注入、截断 500 字 */
function cleanContent(v) {
    return String(v == null ? '' : v)
        .replace(/[<>]/g, '')
        .replace(/\r/g, '')
        .trim()
        .slice(0, 500);
}

export async function onRequestGet({ env }) {
    if (!env.DB) return json({ announcements: [] }, 200, { 'cache-control': 'public, max-age=30' });
    try {
        const { results } = await env.DB.prepare(
            'SELECT id, content, created_at FROM announcements ORDER BY id DESC LIMIT 50'
        ).all();
        return json({ announcements: (results || []).map(toAnn) }, 200, {
            'cache-control': 'public, max-age=30'
        });
    } catch (e) {
        return json({ announcements: [] }, 200, { 'cache-control': 'public, max-age=30' });
    }
}

export async function onRequestPost({ request, env }) {
    const secret = env.ADMIN_CODE || env.UPLOAD_CODE;
    if (!secret || !env.DB) return json({ error: 'not_configured' }, 503);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
    if (clean(body && body.code, 64) !== secret) return json({ error: 'bad_code' }, 403);

    const action = clean(body.action, 16);
    /* 前端解锁时用它验证审核码对不对，不改任何数据 */
    if (action === 'ping') return json({ ok: true });
    const content = cleanContent(body.content);

    try {
        if (action === 'create') {
            if (!content) return json({ error: 'empty' }, 400);
            const res = await env.DB.prepare('INSERT INTO announcements (content) VALUES (?)').bind(content).run();
            return json({ ok: true, id: res.meta.last_row_id });
        }

        const id = Number(body.id);
        if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad_id' }, 400);

        if (action === 'update') {
            if (!content) return json({ error: 'empty' }, 400);
            await env.DB.prepare('UPDATE announcements SET content = ? WHERE id = ?').bind(content, id).run();
            return json({ ok: true, action });
        }
        if (action === 'delete') {
            await env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run();
            return json({ ok: true, action });
        }
    } catch (e) {
        return json({ error: 'db_error' }, 500);
    }
    return json({ error: 'bad_action' }, 400);
}
