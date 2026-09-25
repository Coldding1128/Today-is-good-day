/**
 * GET /api/downloads —— 站内可下载的整合包清单
 *
 * 除了清单本身，还会去 R2 探一下文件在不在（head），
 * 顺便把真实大小和上传时间带出去 —— 这样「文件还没传」时页面能优雅显示
 * 「准备中」，而不是给玩家一个点了 404 的按钮。
 */
import { json, DOWNLOADS } from '../_lib.js';

export async function onRequestGet({ env }) {
    const list = [];

    for (const d of DOWNLOADS) {
        let ready = false, size = 0, updated = '';
        if (env.BUCKET) {
            try {
                const head = await env.BUCKET.head(d.key);
                if (head) {
                    ready = true;
                    size = head.size || 0;
                    updated = head.uploaded ? new Date(head.uploaded).toISOString().slice(0, 10) : '';
                }
            } catch (e) { /* 探不到就当没准备好，不报错 */ }
        }
        list.push({
            id: d.id,
            name: d.name,
            version: d.version,
            mc: d.mc,
            theme: d.theme || 'vanilla',
            note: d.note || '',
            video: d.video || '',
            ready: ready,
            size: size,
            updated: updated,
            url: ready ? '/dl/' + d.key : ''
        });
    }

    return json({ downloads: list }, 200, {
        /* 传完文件最多一分钟页面就会自己变成可下载状态 */
        'cache-control': 'public, max-age=60'
    });
}
