/**
 * GET /img/:key —— 从 R2 供图
 *
 * 走自己的域名而不是开 R2 公开访问（r2.dev），好处有三个：
 *   1. 不用再配一个子域名，少一步后台操作；
 *   2. 同源，没有跨域问题，OG/分享卡也能直接引用；
 *   3. 图片带 immutable 缓存头，命中边缘缓存后不再回源。
 */
export async function onRequestGet({ params, request, env }) {
    const key = String(params.key || '');
    if (!/^[a-z0-9]+-[a-z0-9]+\.(jpg|png|webp)$/i.test(key)) {
        return new Response('bad key', { status: 400 });
    }

    const cache = caches.default;
    const hit = await cache.match(request);
    if (hit) return hit;

    const obj = await env.BUCKET.get(key);
    if (!obj) return new Response('not found', { status: 404 });

    const res = new Response(obj.body, {
        headers: {
            'content-type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg',
            'cache-control': 'public, max-age=31536000, immutable',
            'etag': obj.httpEtag
        }
    });
    await cache.put(request, res.clone());
    return res;
}
