// ----------------------------------------------------
// 简易令牌桶限流 (按客户端 IP, 仅进程内计数)
// 桶容量是突发额度, REFILL_PER_MIN 是持续速率:
// 客户端启动时的更新检测会一次性打出与 Mod 库等量的 /detail 请求,
// ----------------------------------------------------
const RATE_LIMIT_BURST = 500;
const RATE_LIMIT_REFILL_PER_MIN = 50;
const RATE_LIMIT_REFILL_PER_MS = RATE_LIMIT_REFILL_PER_MIN / 60000;
const RATE_LIMIT_IDLE_MS = 10 * 60 * 1000;
const RATE_LIMIT_SWEEP_EVERY = 1000;

const rateLimitBuckets = new Map();
let rateLimitRequestCount = 0;

function takeRateLimitToken(clientIp) {
  const now = Date.now();

  if (++rateLimitRequestCount >= RATE_LIMIT_SWEEP_EVERY) {
    rateLimitRequestCount = 0;
    sweepIdleBuckets(now);
  }

  const bucket = rateLimitBuckets.get(clientIp);
  if (!bucket) {
    rateLimitBuckets.set(clientIp, {
      tokens: RATE_LIMIT_BURST - 1,
      updatedAt: now,
    });
    return true;
  }

  const tokens = Math.min(
    RATE_LIMIT_BURST,
    bucket.tokens + (now - bucket.updatedAt) * RATE_LIMIT_REFILL_PER_MS
  );
  bucket.updatedAt = now;

  if (tokens < 1) {
    bucket.tokens = tokens;
    return false;
  }

  bucket.tokens = tokens - 1;
  return true;
}

// 闲置超过 IDLE_MS 的桶此时早已补满, 直接回收, 避免 Map 无界增长
function sweepIdleBuckets(now) {
  for (const [ip, bucket] of rateLimitBuckets) {
    if (now - bucket.updatedAt > RATE_LIMIT_IDLE_MS) {
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
    if (!takeRateLimitToken(clientIp)) {
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

async function fetchPublishedFileDetails(ids, env) {
  const formData = new FormData();
  if (env?.STEAM_API_KEY) {
    formData.append("key", env.STEAM_API_KEY);
  }
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

// 获取多张预览图 (官方接口, 替代原先从页面 HTML 提取的方式:
// Steam 新版灰度页面的 HTML 里已没有截图数据)
// 无 key 或请求失败时返回 null, 由调用方回退到单张主图
async function fetchDetailPreviews(id, env) {
  if (!env?.STEAM_API_KEY) {
    return null;
  }

  const params = new URLSearchParams();
  params.set("key", env.STEAM_API_KEY);
  params.set("includeadditionalpreviews", "true");
  params.set("publishedfileids[0]", String(id));

  try {
    const response = await fetch(`${GETDETAILS_URL}?${params.toString()}`);
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const item = data?.response?.publishedfiledetails?.[0];
    const previews = Array.isArray(item?.previews) ? item.previews : [];

    const mapped = previews
      .map((preview) => ({
        preview_url: preview.url || preview.preview_url || "",
        preview_type: Number(preview.preview_type) || 0,
      }))
      .filter((preview) => preview.preview_url);

    return mapped.length > 0 ? mapped : null;
  } catch (err) {
    console.warn(`Failed to fetch detail previews: ${err.message}`);
    return null;
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

async function fetchCollectionChildItems(collection, env) {
  const childIds = (collection?.children || [])
    .map((child) => String(child.publishedfileid || ""))
    .filter(Boolean);

  if (childIds.length === 0) {
    return [];
  }

  try {
    const childDetails = [];
    const chunkSize = 100;
    for (let i = 0; i < childIds.length; i += chunkSize) {
      const chunk = childIds.slice(i, i + chunkSize);
      childDetails.push(...(await fetchPublishedFileDetails(chunk, env)));
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
    console.warn(`Failed to fetch collection child items: ${err.message}`);
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
  const p1 = fetchPublishedFileDetails([id], env);

  // 2. 获取多张预览图 (官方接口一次性返回, 不再抓取页面 HTML)
  const p2 = withPreviews
    ? fetchDetailPreviews(id, env)
    : Promise.resolve(null);

  try {
    // 并行请求
    const [publishedFileDetails, previews] = await Promise.all([p1, p2]);

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
        ? await fetchCollectionChildItems(collectionDetails, env)
        : [];
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
