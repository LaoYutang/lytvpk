// 工坊链接解析接口 (l4d2-workshop-parse)
// 收到 POST 的工坊 ID 数组, 返回客户端 internal/app/workshop.go 的 WorkshopFileDetails 数组。
//
// 数据来源是官方 IPublishedFileService/GetDetails:
//   - includechildren=true 时, 合集会返回子项, 普通物品会返回依赖项 (同一 children 字段)
//   - 不再抓取 steamcommunity 页面 HTML: Steam 正在灰度新版页面,
//     新版 HTML 里没有 collectionChildren / requiredItemsContainer, 抓取结果不可靠
//
// 部署: Worker 的 Settings -> Variables 里必须配置 STEAM_API_KEY, 缺失时接口返回 503
const GETDETAILS_URL =
  "https://api.steampowered.com/IPublishedFileService/GetDetails/v1/";

// GetDetails 单次请求的 ID 上限没有明确文档, 与 steam_workshop_worker.js 保持一致按 100 分块
const CHUNK_SIZE = 100;

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    };

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!Array.isArray(payload) || payload.length === 0) {
      return new Response("Payload must be a non-empty array of strings", {
        status: 400,
      });
    }

    // GetDetails 必须带 key, 缺失时直接报错, 避免把 "undefined" 当成 key 发出去
    if (!env?.STEAM_API_KEY) {
      return new Response(
        JSON.stringify({ error: "STEAM_API_KEY is not configured" }),
        { status: 503, headers: corsHeaders }
      );
    }

    // 缓存逻辑：尝试从 Cache 中获取
    // 使用 payload 内容（排序后）作为唯一 Key
    const cache = caches.default;
    const sortedPayload = [...payload].sort();
    const cacheUrl = new URL(request.url);
    // 构造一个虚拟的 GET 请求作为 Cache Key
    // 版本号随响应结构变化, 避免命中旧结构缓存
    const cacheKey = new Request(
      `https://${cacheUrl.hostname}/api/cached-v2/${sortedPayload.join(",")}`,
      {
        method: "GET",
      }
    );

    let cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }

    try {
      // 只有单个 ID 的请求才展开 children（合集子项 / 依赖项）:
      // 批量请求的都是子项, 若带上它们各自的依赖, 客户端会把没有下载链接的
      // 依赖项也列进列表, 界面会出现一批"不可下载"的噪音
      const includeChildren = payload.length === 1;

      const details = [];
      for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
        const chunk = payload.slice(i, i + CHUNK_SIZE);
        details.push(...(await fetchFileDetails(chunk, env, includeChildren)));
      }

      const mappedData = details.map(mapDetail);

      const response = new Response(JSON.stringify(mappedData), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
        },
      });

      // 写入缓存，不阻塞主线程
      ctx.waitUntil(cache.put(cacheKey, response.clone()));

      return response;
    } catch (error) {
      return new Response(
        JSON.stringify({ error: "Upstream API Error: " + error.message }),
        { status: 502, headers: corsHeaders }
      );
    }
  },
};

async function fetchFileDetails(ids, env, includeChildren) {
  const params = new URLSearchParams();
  params.set("key", env.STEAM_API_KEY);
  params.set("includechildren", includeChildren ? "true" : "false");
  ids.forEach((id, index) =>
    params.set(`publishedfileids[${index}]`, String(id))
  );

  const response = await fetch(`${GETDETAILS_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`GetDetails failed: ${response.status}`);
  }

  const data = await response.json();
  return data?.response?.publishedfiledetails || [];
}

// 映射成客户端期望的结构, 字段名与类型都不能变:
// result 必须是数字, file_size 必须能按十进制整数解析, filename 至少要保留扩展名
function mapDetail(item) {
  const children = Array.isArray(item.children)
    ? item.children
        .filter((child) => child?.publishedfileid)
        .map((child) => ({
          publishedfileid: String(child.publishedfileid),
          sortorder: Number(child.sortorder) || 0,
          file_type: Number(child.file_type) || 0,
        }))
    : [];

  // 合集本体不是可下载文件, 即使它带着封面图链接也要标记为不可下载。
  // file_type 2 = 合集; 旧逻辑(有子项且文件名是图片)作为 file_type 缺失时的兜底
  const looksLikeImage = /\.(jpe?g|png|gif|webp)$/i.test(item.filename || "");
  const isCollection =
    Number(item.file_type) === 2 || (children.length > 0 && looksLikeImage);

  return {
    result: isCollection ? 0 : Number(item.result) || 0,
    publishedfileid: String(item.publishedfileid || ""),
    file_type: Number(item.file_type) || 0, // 2 = 合集, 客户端据此调整展示
    filename: item.filename || "",
    file_size: String(item.file_size ?? "0"),
    file_url: item.file_url || "",
    preview_url: item.preview_url || "",
    title: item.title || "",
    file_description: item.file_description || "",
    children,
  };
}