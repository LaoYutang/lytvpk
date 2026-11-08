// ----------------------------------------------------
// 简易令牌桶限流 (按客户端 IP, 仅进程内计数)
// 桶容量是突发额度, REFILL_PER_MIN 是持续速率:
// 客户端启动时的更新检测会一次性打出与 Mod 库等量的 /detail 请求,
// ----------------------------------------------------
const RATE_LIMIT_BURST = 500;
const RATE_LIMIT_REFILL_PER_MIN = 50;
const RATE_LIMIT_IDLE_MS = 10 * 60 * 1000;
const RATE_LIMIT_SWEEP_EVERY = 1000;

// 可选配置 (不在代码中填写实际地址):
// WORKSHOP_HIGH_LIMIT_IPS: Cloudflare Secret, 英文逗号分隔的裸 IPv4 / IPv6。
// 空白和空项忽略, 无效项跳过; 不接受网段、端口、zone ID 或通配符。
// 名单 IP 的额度固定为普通 IP 的 10 倍: 突发 5000, 每分钟补充 500。
// 只有 IP 名单可以通过 Secret 配置, 限流数值固定在下面的常量中。
// 每个匹配 IP 独立计数, 并非多个 IP 共用一个桶。仍是 isolate 内的尽力限流。
const HIGH_LIMIT_BURST = 5000;
const HIGH_LIMIT_REFILL_PER_MIN = 500;
const ordinaryRateLimit = {
  burst: RATE_LIMIT_BURST,
  refillPerMin: RATE_LIMIT_REFILL_PER_MIN,
};
const rateLimitBuckets = new Map();
let rateLimitRequestCount = 0;
let cachedHighLimitConfig;

function normalizeIPv4(value) {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) =>
    !/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255
  )) return null;
  return parts.map(Number);
}

// 不使用 URL 的宽松 IPv4 解析, 避免缩写、整数、八进制等别名意外命中。
// IPv6 按完整 128 位比较; IPv4-mapped IPv6 与相应 IPv4 视作同一地址。
function normalizeClientIP(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 45 ||
      /[^0-9a-fA-F:.]/.test(value)) {
    return null;
  }
  if (!value.includes(":")) {
    const ipv4 = normalizeIPv4(value);
    return ipv4 ? `v4:${ipv4.join(".")}` : null;
  }
  let expanded = value;
  if (expanded.includes(".")) {
    const lastColon = expanded.lastIndexOf(":");
    const ipv4 = normalizeIPv4(expanded.slice(lastColon + 1));
    if (!ipv4) return null;
    expanded = expanded.slice(0, lastColon + 1) +
      ((ipv4[0] << 8) | ipv4[1]).toString(16) + ":" +
      ((ipv4[2] << 8) | ipv4[3]).toString(16);
  }

  const halves = expanded.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-fA-F]{1,4}$/.test(part))) {
    return null;
  }
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const words = [...left, ...Array(missing).fill("0"), ...right].map((part) =>
    Number.parseInt(part, 16)
  );
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return `v4:${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`;
  }
  return `v6:${words.map((word) => word.toString(16)).join(":")}`;
}

function parseHighLimitConfig(env) {
  const ips = new Set();
  if (typeof env?.WORKSHOP_HIGH_LIMIT_IPS === "string") {
    for (const entry of env.WORKSHOP_HIGH_LIMIT_IPS.split(",")) {
      const ip = normalizeClientIP(entry.trim());
      if (ip) ips.add(ip);
    }
  }
  return {
    ips,
    burst: HIGH_LIMIT_BURST,
    refillPerMin: HIGH_LIMIT_REFILL_PER_MIN,
  };
}

function highLimitConfig(env) {
  const value = env?.WORKSHOP_HIGH_LIMIT_IPS;
  if (!cachedHighLimitConfig || value !== cachedHighLimitConfig.value) {
    cachedHighLimitConfig = { value, config: parseHighLimitConfig(env) };
  }
  return cachedHighLimitConfig.config;
}

// 只面向 Cloudflare 公网入口。request.cf 是平台元数据, 不是 HTTP 头。
// CF-Connecting-IP 在公网入口由 Cloudflare 覆盖; 不读取 X-Forwarded-For / X-Real-IP。
// 同 zone Worker 的 x-real-ip 可改写来源, 跨 zone Worker 又使用共享占位 IP,
// 因此带子请求标记或来源不明的请求只使用普通额度, 不能凭转发头提权。
// https://developers.cloudflare.com/fundamentals/reference/http-headers/
const WORKER_SUBREQUEST_IP = "v6:2a06:98c0:3600:0:0:0:0:103";
function getHighLimitClientIP(request) {
  if (typeof request.cf?.colo !== "string" || request.cf.colo.length !== 3 ||
      !/^[A-Z]{3}$/.test(request.cf.colo) ||
      request.headers.has("CF-Worker") || request.headers.has("CF-EW-Via")) {
    return null;
  }
  const ip = normalizeClientIP(request.headers.get("CF-Connecting-IP"));
  if (!ip || ip === WORKER_SUBREQUEST_IP) return null;

  // Pseudo IPv4 的 Overwrite Headers 模式会丢失主头中的真实 IPv6。
  // 这些 Class E 伪地址不能获得高额度, 也不以另一个可自带的头恢复资格。
  if (ip.startsWith("v4:") && Number(ip.slice(3).split(".")[0]) >= 240) {
    return null;
  }
  return ip;
}

function takeRateLimitToken(clientIp, policy) {
  const now = Date.now();

  if (++rateLimitRequestCount >= RATE_LIMIT_SWEEP_EVERY) {
    rateLimitRequestCount = 0;
    sweepIdleBuckets(now);
  }

  const refillPerMs = policy.refillPerMin / 60000;
  const bucket = rateLimitBuckets.get(clientIp);
  if (!bucket) {
    rateLimitBuckets.set(clientIp, {
      tokens: policy.burst - 1,
      updatedAt: now,
      burst: policy.burst,
      refillPerMs,
    });
    return true;
  }

  // 资格变化时保留已消耗额度, 用此前速率计算此前时段, 再应用新容量。
  const tokens = Math.min(
    policy.burst,
    bucket.burst,
    bucket.tokens + Math.max(0, now - bucket.updatedAt) * bucket.refillPerMs
  );
  bucket.updatedAt = now;
  bucket.burst = policy.burst;
  bucket.refillPerMs = refillPerMs;

  if (tokens < 1) {
    bucket.tokens = tokens;
    return false;
  }

  bucket.tokens = tokens - 1;
  return true;
}

// 只回收闲置超过 10 分钟且已补满的桶, 避免回收时提前恢复额度。
function sweepIdleBuckets(now) {
  for (const [ip, bucket] of rateLimitBuckets) {
    const idle = now - bucket.updatedAt;
    if (idle > RATE_LIMIT_IDLE_MS &&
        bucket.tokens + idle * bucket.refillPerMs >= bucket.burst) {
      rateLimitBuckets.delete(ip);
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 处理 CORS (允许跨域)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    };

    // 限流: 在入口处计数, 缓存命中的请求同样计入
    // (命中也照样消耗 Worker 自身的请求额度, 免费版每天 10 万次用尽后整个服务会不可用)
    const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
    const highLimit = highLimitConfig(env);
    const listedIp = highLimit.ips.size ? normalizeClientIP(clientIp) : null;
    const isListed = listedIp !== null && highLimit.ips.has(listedIp);
    const useHighLimit = isListed && getHighLimitClientIP(request) === listedIp;
    // 名单 IP 降为普通额度时仍用同一桶, 不能靠附加子请求头多取一份额度。
    // 普通非名单 IP 保持原始键和原有限额。
    const bucketKey = isListed ? `listed:${listedIp}` : `ordinary:${clientIp}`;
    if (!takeRateLimitToken(bucketKey, useHighLimit ? highLimit : ordinaryRateLimit)) {
      return new Response(JSON.stringify({ error: "Too Many Requests" }), {
        status: 429,
        headers: { ...corsHeaders, "Retry-After": "1" },
      });
    }

    // 0. 检查缓存 (CF Cache)
    const cache = caches.default;
    let cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    try {
      let response;

      // 1. 列表 & 筛选 & 搜索
      // GET /list?q=xxx&page=1&sort=trend&tags=Weapon,Map
      if (path === "/list") {
        response = await handleList(url, env, corsHeaders);
      }

      // 2. 详情
      // GET /detail?id=123456
      else if (path === "/detail") {
        response = await handleDetail(url, env, corsHeaders);
      }

      // 404
      else {
        return new Response(JSON.stringify({ error: "Not Found" }), {
          status: 404,
          headers: corsHeaders,
        });
      }

      // 统一设置缓存头: 1小时 (s-maxage=3600)
      // 需要重新构建 Response 以修改 Header
      const newHeaders = new Headers(response.headers);
      newHeaders.set("Cache-Control", "public, max-age=3600, s-maxage=3600");

      response = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });

      // 写入缓存 (仅当成功响应时? 或者全部? 通常缓存 200 OK)
      if (response.status === 200) {
        ctx.waitUntil(cache.put(request, response.clone()));
      }

      return response;
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }
  },
};

// ----------------------------------------------------
// Handler 1: 列表查询 (IPublishedFileService/QueryFiles)
// ----------------------------------------------------
function buildListUrl(url, env, filetype) {
  const steamApiUrl = new URL(
    "https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/"
  );

  const params = steamApiUrl.searchParams;
  params.set("key", env.STEAM_API_KEY);
  params.set("appid", "550"); // L4D2
  params.set("return_details", "true"); // 返回详情
  params.set("numperpage", "20");
  params.set("cache_max_age_seconds", "300"); // 其实 Steam 忽略这个，但我们可以加
  if (filetype !== null && filetype !== undefined && filetype !== "") {
    params.set("filetype", filetype);
  }

  // 转发参数
  const q = url.searchParams.get("q");
  if (q) {
    params.set("search_text", q);
    params.set("query_type", "12"); // 12-RankedByTextSearch 如果有搜索词
  } else {
    const sort = url.searchParams.get("sort") || "trend";
    // 映射排序
    // 0: RankedByVote 1: RankedByPublicationDate 2: RankedByAcceptedForGame
    // 3: RankedByTrend 4: RankedByTotalUniqueSubscriptions 5: RankedByAccountID
    // ... 查看 Steam 文档
    // 常用: trend -> 3, recent -> 1, top -> 4?
    // QueryFiles sort order:
    // 1 = trend most recently updated? No.
    // Let's use the standard enumeration for QueryFiles:
    // k_PublishedFileQueryType_RankedByVote = 0
    // k_PublishedFileQueryType_RankedByPublicationDate = 1
    // k_PublishedFileQueryType_RankedByAcceptedForGame = 2
    // k_PublishedFileQueryType_RankedByTrend = 3
    // k_PublishedFileQueryType_RankedByTotalUniqueSubscriptions = 4

    // 注意：Steam API "query_type" 的定义有点混乱，QueryFiles v1 经常混用。
    // 为了保险，我们用最常用的：
    if (sort === "recent")
      params.set("query_type", "1"); // Date
    else if (sort === "top")
      params.set("query_type", "0"); // Vote
    else params.set("query_type", "3"); // Trend (Default)
  }

  const page = url.searchParams.get("page") || "0";
  params.set("page", page);

  // Tags 过滤
  // 格式: tags=Weapon,Map (逗号分隔)
  const tagsStr = url.searchParams.get("tags");
  if (tagsStr) {
    const tags = tagsStr.split(",");
    tags.forEach((tag, index) => {
      params.set(`requiredtags[${index}]`, tag);
    });
    params.set("match_all_tags", "true");
  }

  return steamApiUrl;
}

async function fetchListData(url, env, filetype) {
  const steamApiUrl = buildListUrl(url, env, filetype);
  const resp = await fetch(steamApiUrl.toString());
  if (!resp.ok) {
    throw new Error(`QueryFiles failed: ${resp.status}`);
  }
  const data = await resp.json();
  const items = data?.response?.publishedfiledetails;
  if (Array.isArray(items)) {
    items.forEach((item) => {
      delete item.children;
    });
  }
  return data;
}

function mergeListData(itemData, collectionData, limit = 20) {
  const itemResponse = itemData?.response || {};
  const collectionResponse = collectionData?.response || {};
  const items = Array.isArray(itemResponse.publishedfiledetails)
    ? itemResponse.publishedfiledetails
    : [];
  const collections = Array.isArray(collectionResponse.publishedfiledetails)
    ? collectionResponse.publishedfiledetails
    : [];
  const merged = [];
  const seen = new Set();

  const addItem = (item) => {
    if (!item?.publishedfileid || seen.has(String(item.publishedfileid))) {
      return;
    }
    seen.add(String(item.publishedfileid));
    merged.push(item);
  };

  const maxLength = Math.max(items.length, collections.length);
  for (let index = 0; index < maxLength && merged.length < limit; index++) {
    if (index < items.length) addItem(items[index]);
    if (merged.length >= limit) break;
    if (index < collections.length) addItem(collections[index]);
  }

  return {
    response: {
      ...itemResponse,
      publishedfiledetails: merged,
      total:
        Number(itemResponse.total || 0) + Number(collectionResponse.total || 0),
    },
  };
}

// ----------------------------------------------------
// Handler 1: 列表查询 (IPublishedFileService/QueryFiles)
// ----------------------------------------------------
async function handleList(url, env, headers) {
  const requestedFileType = url.searchParams.get("filetype");
  if (requestedFileType !== null) {
    const data = await fetchListData(url, env, requestedFileType);
    return new Response(JSON.stringify(data), { headers });
  }

  const [itemsResult, collectionsResult] = await Promise.allSettled([
    fetchListData(url, env, "0"),
    fetchListData(url, env, "1"),
  ]);

  if (
    itemsResult.status === "rejected" &&
    collectionsResult.status === "rejected"
  ) {
    throw itemsResult.reason;
  }

  const itemData =
    itemsResult.status === "fulfilled"
      ? itemsResult.value
      : { response: { publishedfiledetails: [], total: 0 } };
  const collectionData =
    collectionsResult.status === "fulfilled"
      ? collectionsResult.value
      : { response: { publishedfiledetails: [], total: 0 } };
  const data = mergeListData(itemData, collectionData);

  return new Response(JSON.stringify(data), { headers });
}

// ----------------------------------------------------
// Handler 2: 单个详情 (合并 ISteamRemoteStorage 和 IPublishedFileService)
// ----------------------------------------------------
const PUBLISHED_FILE_DETAILS_URL =
  "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";
const COLLECTION_DETAILS_URL =
  "https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/";
const GETDETAILS_URL =
  "https://api.steampowered.com/IPublishedFileService/GetDetails/v1/";

// 免 key 的详情接口: 实测带不带 key 返回字段一致, 不带可避免消耗 key 的每日调用配额。
// 需要 children / 多图预览时另走 GetDetails(必须带 key)
async function fetchPublishedFileDetails(ids) {
  const formData = new FormData();
  formData.append("itemcount", String(ids.length));
  ids.forEach((id, index) => {
    formData.append(`publishedfileids[${index}]`, id);
  });

  const response = await fetch(PUBLISHED_FILE_DETAILS_URL, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`GetPublishedFileDetails failed: ${response.status}`);
  }

  const data = await response.json();
  return data?.response?.publishedfiledetails || [];
}

// 获取完整详情的附加数据: 多图预览 + children(合集的子项 / 普通物品的依赖项)
// 两者来自同一次 GetDetails 调用, 不额外增加调用次数
// 无 key 或请求失败时返回空结果, 由调用方回退到单张主图
async function fetchDetailExtras(id, env) {
  const empty = { previews: null, childIds: [], fileType: 0 };
  if (!env?.STEAM_API_KEY) {
    return empty;
  }

  const params = new URLSearchParams();
  params.set("key", env.STEAM_API_KEY);
  params.set("includeadditionalpreviews", "true");
  params.set("includechildren", "true");
  params.set("publishedfileids[0]", String(id));

  try {
    const response = await fetch(`${GETDETAILS_URL}?${params.toString()}`);
    if (!response.ok) {
      return empty;
    }

    const data = await response.json();
    const item = data?.response?.publishedfiledetails?.[0];

    const previews = (Array.isArray(item?.previews) ? item.previews : [])
      .map((preview) => ({
        preview_url: preview.url || preview.preview_url || "",
        preview_type: Number(preview.preview_type) || 0,
      }))
      .filter((preview) => preview.preview_url);

    const childIds = (Array.isArray(item?.children) ? item.children : [])
      .map((child) => String(child?.publishedfileid || ""))
      .filter(Boolean);

    return {
      previews: previews.length > 0 ? previews : null,
      childIds,
      fileType: Number(item?.file_type) || 0,
    };
  } catch (err) {
    console.warn(`Failed to fetch detail extras: ${err.message}`);
    return empty;
  }
}

async function fetchCollectionDetails(id) {
  const formData = new FormData();
  formData.append("collectioncount", "1");
  formData.append("publishedfileids[0]", id);

  const response = await fetch(COLLECTION_DETAILS_URL, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`GetCollectionDetails failed: ${response.status}`);
  }

  const data = await response.json();
  const collection = data?.response?.collectiondetails?.[0];
  if (
    !collection ||
    Number(collection.result) !== 1 ||
    String(collection.publishedfileid || id) !== String(id)
  ) {
    return null;
  }

  return collection;
}

async function fetchCollectionChildItems(collection) {
  const childIds = (collection?.children || [])
    .map((child) => String(child.publishedfileid || ""))
    .filter(Boolean);

  return fetchChildItemsByIds(childIds);
}

// 按 ID 批量取精简详情（合集子项与依赖项共用）
async function fetchChildItemsByIds(childIds) {
  if (childIds.length === 0) {
    return [];
  }

  try {
    const childDetails = [];
    const chunkSize = 100;
    for (let i = 0; i < childIds.length; i += chunkSize) {
      const chunk = childIds.slice(i, i + chunkSize);
      childDetails.push(...(await fetchPublishedFileDetails(chunk)));
    }

    const detailsById = new Map(
      childDetails.map((item) => [String(item.publishedfileid), item])
    );

    return childIds
      .map((id) => detailsById.get(id))
      .filter(Boolean)
      .map((item) => ({
        publishedfileid: item.publishedfileid,
        title: item.title,
        preview_url: item.preview_url,
        creator: item.creator,
        file_type: item.file_type,
        views: item.views,
        subscriptions: item.subscriptions,
        favorited: item.favorited,
        tags: item.tags || [],
      }));
  } catch (err) {
    console.warn(`Failed to fetch child items: ${err.message}`);
    return [];
  }
}

async function handleDetail(url, env, headers) {
  const id = url.searchParams.get("id");
  if (!id) throw new Error("Missing id parameter");

  // 默认不查询多图预览(更新检测、写入 meta 等只需要基础字段), 省一次消耗 API key 的调用;
  // 需要图集的调用方(详情页)带 with_previews=1
  const withPreviews = /^(1|true)$/i.test(
    url.searchParams.get("with_previews") || ""
  );

  // 1. 调用旧接口 (ISteamRemoteStorage/GetPublishedFileDetails)
  // 作用: 获取 title, description, 统计数据(订阅/收藏)等
  // 注意: 虽然此接口返回 file_url，但在详情页场景下前端并不使用它(下载走单独流程)
  const p1 = fetchPublishedFileDetails([id]);

  // 2. 获取附加数据：多图预览 + 依赖项（同一次 GetDetails 调用）
  const p2 = withPreviews
    ? fetchDetailExtras(id, env)
    : Promise.resolve({ previews: null, childIds: [], fileType: 0 });

  try {
    // 并行请求
    const [publishedFileDetails, extras] = await Promise.all([p1, p2]);
    const previews = extras.previews;

    const resultOld = publishedFileDetails?.[0];

    // 基础校验
    if (!resultOld) {
      return new Response(
        JSON.stringify({ error: "Item not found in RemoteStorage" }),
        {
          status: 404,
          headers,
        }
      );
    }

    // 合并逻辑: 将官方接口返回的多图列表作为 previews 字段
    if (previews && previews.length > 0) {
      resultOld.previews = previews;

      // 拿到多图后同步更新主预览图 (接口返回的主图有时是低清的)
      if (previews[0].preview_url) {
        resultOld.preview_url = previews[0].preview_url;
      }
    } else if (resultOld.preview_url) {
      // 拿不到多图时，确保 previews 字段存在（包含主图）
      resultOld.previews = [
        {
          preview_url: resultOld.preview_url,
          preview_type: 0,
        },
      ];
    }

    const fileTypeMissing =
      resultOld.file_type === undefined ||
      resultOld.file_type === null ||
      resultOld.file_type === "";
    let collectionDetails = null;
    let isCollection = Number(resultOld.file_type) === 2;

    if (isCollection || fileTypeMissing) {
      try {
        collectionDetails = await fetchCollectionDetails(id);
        if (collectionDetails) {
          resultOld.file_type = 2;
          isCollection = true;
        }
      } catch (err) {
        console.warn(`Failed to confirm collection details: ${err.message}`);
      }
    }

    if (isCollection) {
      resultOld.child_items = collectionDetails
        ? await fetchCollectionChildItems(collectionDetails)
        : [];
    } else if (extras.fileType !== 2 && extras.childIds.length > 0) {
      // 普通物品的 children 是依赖项(必需物品)，用 ID 批量补详情以便展示名称
      resultOld.required_items = await fetchChildItemsByIds(extras.childIds);
    }

    // 构造最终响应 (保持原有结构)
    const responseData = {
      response: {
        result: 1,
        resultcount: 1,
        publishedfiledetails: [resultOld],
      },
    };

    return new Response(JSON.stringify(responseData), { headers });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Upstream API Error: " + err.message }),
      {
        status: 500,
        headers,
      }
    );
  }
}
