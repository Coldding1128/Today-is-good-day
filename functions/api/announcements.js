/**
 * 群公告
 *   GET  /api/announcements      —— 公开读取（所有人可见）
 *   POST /api/announcements      —— 腐竹管理，body: { code, action, id?, title?, content?, pack? }
 *       action: 'ping' | 'create' | 'update' | 'delete'
 * 鉴权码复用审核台/上传台的 ADMIN_CODE（没设就退化成 UPLOAD_CODE）。
 * 也就是：只有知道审核码的人（腐竹）能发布/编辑/删除，其他人只读。
 */
import { json, clean, PACK_IDS } from '../_lib.js';

function toAnn(r) {
    return {
        id: r.id,
        title: r.title || '',
        content: r.content || '',
        pack: r.pack_id || '',
        created_at: r.created_at
    };
}

/** 标题：单行、去尖括号防注入、截断 60 字 */
function cleanTitle(v) {
    return String(v == null ? '' : v)
        .replace(/[<>]/g, '')
        .replace(/[\r\n]+/g, ' ')
        .trim()
        .slice(0, 60);
}

/** 正文：保留换行、去尖括号、截断 500 字 */
function cleanContent(v) {
    return String(v == null ? '' : v)
        .replace(/[<>]/g, '')
        .replace(/\r/g, '')
        .trim()
        .slice(0, 500);
}

/** 归属整合包：只认白名单 id，留空 = 通用公告 */
function cleanPack(v) {
    const p = clean(v, 32);
    return p && PACK_IDS.indexOf(p) !== -1 ? p : '';
}

export async function onRequestGet({ env }) {
    if (!env.DB) return json({ announcements: [] }, 200, { 'cache-control': 'public, max-age=30' });
    try {
        const { results } = await env.DB.prepare(
            'SELECT id, title, content, pack_id, created_at FROM announcements ORDER BY id DESC LIMIT 100'
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

    const title = cleanTitle(body.title);
    const content = cleanContent(body.content);
    const pack = cleanPack(body.pack);

    try {
        if (action === 'create') {
            if (!title) return json({ error: 'empty_title' }, 400);
            if (!content) return json({ error: 'empty_content' }, 400);
            const res = await env.DB.prepare(
                'INSERT INTO announcements (title, content, pack_id) VALUES (?, ?, ?)'
            ).bind(title, content, pack).run();
            return json({ ok: true, id: res.meta.last_row_id });
        }

        const id = Number(body.id);
        if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad_id' }, 400);

        if (action === 'update') {
            if (!title) return json({ error: 'empty_title' }, 400);
            if (!content) return json({ error: 'empty_content' }, 400);
            await env.DB.prepare(
                'UPDATE announcements SET title = ?, content = ?, pack_id = ? WHERE id = ?'
            ).bind(title, content, pack, id).run();
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
