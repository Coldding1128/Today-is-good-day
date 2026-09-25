/**
 * Pages Functions 共用工具。
 * 注意：functions/ 下以 _ 开头的文件不参与路由，只作为共享模块被 import。
 */

/* 与 gallery/index.html 里 MODPACKS 的 id 一一对应。
   服务端单独存一份，是为了不信任前端传来的 pack_id —— 投稿只能落到这 20 个周目里。 */
export const PACK_IDS = [
    'cobblemon', 'vanilla-food', 'element', 'lastone', 'combat', 'alert',
    'mech2', 'newsteam', 'atm10', 'newgen', 'swordking', 'curtain',
    'farm', 'deadworld', 'mech', 'fool', 'swordking-beta', 'utopia-fix',
    'utopia', 'vanilla'
];

/* ============================================================
   整合包下载 —— 目录即列表
   ------------------------------------------------------------
   把整合包压缩包丢进 R2 桶（goodday-shots）的 packs/ 文件夹就行，
   文件名随便起（中文、空格、带版本号都可以）。
   网站会自己扫描这个目录并列出来，不需要改任何代码。
   换周目 = 传新文件（旧的可以留着也能删）。
   ============================================================ */
export const PACK_PREFIX = 'packs/';

/* 下面这张表是「可选的补充信息」，不填完全能用：
   名字、版本默认从文件名里读；这里只是用来补那些文件名说不清的东西，
   比如介绍视频、更整齐的显示名。键名写 packs/ 下的文件名。 */
export const PACK_META = {
    // '去吧方可梦大师 v5.9.2（MC1.21.1）.zip': {
    //     name: '去吧，方可梦大师',
    //     version: 'v5.9.2',
    //     mc: '1.21.1',
    //     video: 'https://www.bilibili.com/video/BV1QU8X6LEYP/',
    //     note: '一句话说明，会显示在卡片上',
    //     theme: 'poke'
    // }
};

export const MAX_BYTES = 6 * 1024 * 1024;               // 单张上限 6MB（前端已压过，正常不超过 500KB）
export const TYPES = {                                   // 只收这三种
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
};

export function json(data, status = 200, extra = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: Object.assign({
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
        }, extra)
    });
}

/** 清理用户输入：去掉控制字符与尖括号，并截断 */
export function clean(v, max) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001F<>]/g, ' ').trim().slice(0, max);
}

/** 数据库行 → 前端要的形状（前端只认 url，不关心 r2_key） */
export function toPhoto(row) {
    return {
        id: row.id,
        pack: row.pack_id,
        title: row.title || '',
        by: row.uploader || '',
        url: '/img/' + row.r2_key,
        status: row.status,
        at: row.created_at,
        /* 腐竹在审核台勾选的「精选」，会排到主页前面。
           写成 row.featured ? 1 : 0 而不是直接取字段：万一 featured 列还没加上，
           这里拿到 undefined 也只是当作 0，不会把整个接口带崩 */
        featured: row.featured ? 1 : 0
    };
}

/* ============================================================
   AWS SigV4 —— 给整合包上传签发一个 presigned PUT URL
   ------------------------------------------------------------
   为什么需要它：把大文件经 Worker 中转写进 R2 这条路实测走不通
   （R2 的 uploadPart 在 Pages Functions 里稳定报 Network connection lost）。
   改成浏览器拿一个签名好的网址，直接 PUT 到 R2，数据完全不经 Worker。

   用的是标准 AWS 签名算法第 4 版，R2 兼容。几个容易写错的点都标了注释。
   ============================================================ */

/** AWS 要求：除 A-Za-z0-9-_.~ 之外全部百分号编码（斜杠单独处理） */
function awsEnc(s) {
    let out = '';
    for (const ch of String(s)) {
        out += /[A-Za-z0-9\-_.~]/.test(ch) ? ch : encodeURIComponent(ch);
    }
    return out;
}

/** 路径按段编码，但保留分隔用的斜杠 */
function awsEncPath(path) {
    return path.split('/').map(awsEnc).join('/');
}

function toHex(bytes) {
    let out = '';
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
    return out;
}

async function sha256Hex(str) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return toHex(new Uint8Array(d));
}

async function hmac(keyBytes, str) {
    const key = await crypto.subtle.importKey(
        'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(str));
    return new Uint8Array(sig);
}

/**
 * 生成 presigned PUT URL。
 * @param {{accountId:string, accessKeyId:string, secretAccessKey:string,
 *          bucket:string, key:string, expires?:number}} o
 */
export async function presignPutUrl(o) {
    /* host / region / date 这三个可以被注入，只为单元测试能对照 AWS 官方示例；
       正常调用只用 accountId，其余走默认值 */
    const host = o.host || (o.accountId + '.r2.cloudflarestorage.com');
    const region = o.region || 'auto';      /* R2 固定用 auto */
    const service = 's3';
    const expires = o.expires || 3600;

    /* 时间戳格式：20260925T060000Z（去掉 - 和 : 与毫秒，保留 Z） */
    const amzDate = (o.date instanceof Date ? o.date : new Date())
        .toISOString().replace(/[-:]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const scope = dateStamp + '/' + region + '/' + service + '/aws4_request';

    /* 路径式寻址：/<桶名>/<key>，注意 key 里有中文时要按段编码。
       pathStyle:false 是为了对照 AWS 官方示例（那种把桶放进域名的写法），
       正常调用不需要传，R2 用路径式。 */
    const canonicalUri = o.pathStyle === false
        ? awsEncPath('/' + o.key)
        : awsEncPath('/' + o.bucket + '/' + o.key);

    /* 查询参数必须按参数名排序；值里的 / 也要编码（所以用 awsEnc 而不是 encodeURIComponent） */
    const params = [
        ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
        ['X-Amz-Credential', o.accessKeyId + '/' + scope],
        ['X-Amz-Date', amzDate],
        ['X-Amz-Expires', String(expires)],
        ['X-Amz-SignedHeaders', 'host']
    ].sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    const canonicalQuery = params.map(function (p) {
        return awsEnc(p[0]) + '=' + awsEnc(p[1]);
    }).join('&');

    const signedHeaders = 'host';
    /* presigned 场景下浏览器算不出正文哈希，标准做法就是用这个固定值 */
    const payloadHash = 'UNSIGNED-PAYLOAD';

    /* method 默认 PUT；同样只为对照官方示例而可注入 */
    const method = o.method || 'PUT';
    const canonicalRequest = [
        method, canonicalUri, canonicalQuery,
        'host:' + host + '\n', signedHeaders, payloadHash
    ].join('\n');

    const stringToSign = [
        'AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)
    ].join('\n');

    /* 签名密钥是四层 HMAC 链 */
    let k = await hmac(new TextEncoder().encode('AWS4' + o.secretAccessKey), dateStamp);
    k = await hmac(k, region);
    k = await hmac(k, service);
    k = await hmac(k, 'aws4_request');
    const signature = toHex(await hmac(k, stringToSign));

    return {
        url: 'https://' + host + canonicalUri + '?' + canonicalQuery + '&X-Amz-Signature=' + signature,
        key: o.key,
        expires: expires
    };
}
