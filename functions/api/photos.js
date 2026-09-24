/**
 * GET /api/photos —— 画廊读取
 * 只返回 status='approved' 的图，待审与驳回的谁也看不到。
 */
import { json, toPhoto } from '../_lib.js';

export async function onRequestGet({ request, env }) {
    if (!env.DB) return json({ error: 'not_configured' }, 503);

    const pack = new URL(request.url).searchParams.get('pack');
    let sql = "SELECT id, pack_id, title, uploader, r2_key, status, created_at "
            + "FROM photos WHERE status = 'approved'";
    const args = [];
    if (pack) { sql += ' AND pack_id = ?'; args.push(pack); }
    sql += ' ORDER BY created_at DESC LIMIT 300';

    try {
        const { results } = await env.DB.prepare(sql).bind(...args).all();
        return json({ photos: (results || []).map(toPhoto) }, 200, {
            /* 审核通过后最多一分钟可见，既省查询又不至于刷新半天不出来 */
            'cache-control': 'public, max-age=60'
        });
    } catch (e) {
        return json({ error: 'db_error' }, 500);
    }
}
