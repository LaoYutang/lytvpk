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
async function handleList(url, env, headers) {
  const steamApiUrl = new URL(
    "https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/"
  );

  const params = steamApiUrl.searchParams;
  params.set("key", env.STEAM_API_KEY);
  params.set("appid", "550"); // L4D2
  params.set("return_details", "true"); // 返回详情
  params.set("numperpage", "20");
  params.set("cache_max_age_seconds", "300"); // 其实 Steam 忽略这个，但我们可以加

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
    if (sort === "recent") params.set("query_type", "1"); // Date
    else if (sort === "top") params.set("query_type", "0"); // Vote
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

  const resp = await fetch(steamApiUrl.toString());
  const data = await resp.json();

  return new Response(JSON.stringify(data), { headers });
}

// ----------------------------------------------------
// Handler 2: 单个详情 (合并 ISteamRemoteStorage 和 IPublishedFileService)
// ----------------------------------------------------
async function handleDetail(url, env, headers) {
  const id = url.searchParams.get("id");
  if (!id) throw new Error("Missing id parameter");

  // 1. 调用旧接口 (ISteamRemoteStorage/GetPublishedFileDetails)
  // 作用: 获取 title, description, 统计数据(订阅/收藏)等
  // 注意: 虽然此接口返回 file_url，但在详情页场景下前端并不使用它(下载走单独流程)
  const oldApiUrl =
    "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";

  const formData = new FormData();
  formData.append("key", env.STEAM_API_KEY);
  formData.append("itemcount", "1");
  formData.append("publishedfileids[0]", id);

  const p1 = fetch(oldApiUrl, {
    method: "POST",
    body: formData,
  }).then((r) => r.json());

  // 2. 爬取 HTML 页面获取更多预览图 (Steam API 通常不返回多图)
  // 目标: 从 HTML 中提取 ShowEnlargedImagePreview 调用中的高清大图链接
  const pageUrl = `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;

  const p2 = fetch(pageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    },
  })
    .then((res) => (res.ok ? res.text() : null))
    .catch(() => null);

  try {
    // 并行请求
    const [dataOld, pageHtml] = await Promise.all([p1, p2]);

    const resultOld = dataOld?.response?.publishedfiledetails?.[0];

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

    // 解析 HTML 提取图片
    const imageUrls = [];
    if (pageHtml) {
      // 策略 A (最全): 提取 rgFullScreenshotURLs 数组中的 URL
      // 格式: { 'previewid' : '...', 'url': '...' },
      const regexRg = /var\s+rgFullScreenshotURLs\s*=\s*\[([\s\S]+?)\];/;
      const matchRg = pageHtml.match(regexRg);

      if (matchRg && matchRg[1]) {
        const content = matchRg[1];
        const regexUrl = /'url'\s*:\s*'([^']+)'/g;
        let urlMatch;
        while ((urlMatch = regexUrl.exec(content)) !== null) {
          imageUrls.push(urlMatch[1]);
        }
      }

      // 策略 B (回退): 查找 ShowEnlargedImagePreview('URL')
      // 注意: 部分页面主图点击放大仍使用此函数直接传 URL
      if (imageUrls.length === 0) {
        const regexEnlarged = /ShowEnlargedImagePreview\(\s*'([^']+)'/g;
        let match;
        while ((match = regexEnlarged.exec(pageHtml)) !== null) {
          // 确保是 URL 而不是 ID
          if (match[1].startsWith("http")) {
            imageUrls.push(match[1]);
          }
        }
      }

      // 策略 C (保底): 主预览图
      // <img id="previewImageMain" class="workshopItemPreviewImageMain" src="...">
      if (imageUrls.length === 0) {
        const regexMain = /<img\s+id="previewImageMain"[^>]+src="([^"]+)"/i;
        const mainMatch = pageHtml.match(regexMain);
        if (mainMatch) {
          imageUrls.push(mainMatch[1]);
        }
      }
    }

    // 合并逻辑: 将爬取到的图片列表作为 previews 字段返回
    // 构造为 Steam API 风格的对象数组，或者直接字符串数组(取决于前端需求，这里用对象更易扩展)
    if (imageUrls.length > 0) {
      resultOld.previews = imageUrls.map((url) => ({
        preview_url: url,
        preview_type: 0, // 0 = image
      }));

      // 如果爬取到了图片，也可以更新主预览图 (API 返回的有时是低清的)
      if (imageUrls[0]) {
        resultOld.preview_url = imageUrls[0];
      }
    } else {
      // 如果没爬到，确保 previews 字段存在（包含主图）
      if (resultOld.preview_url) {
        resultOld.previews = [
          {
            preview_url: resultOld.preview_url,
            preview_type: 0,
          },
        ];
      }
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
