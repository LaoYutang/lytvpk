# 工坊 Worker 请求与 Steam 调用统计

在 Cloudflare Observability 的 **Query Builder** 选择查询时段。下表每行都先加过滤条件 `event` **Equals** `steam_request_summary`，这样一条应用汇总对应一次进入 Worker 的请求。直接传给 `console.log` 的对象字段可以分别查询。[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) · [Query Builder](https://developers.cloudflare.com/workers/observability/query-builder/)

| 要查什么 | 额外 Filter | Visualize | Group By |
| --- | --- | --- | --- |
| 两个 Worker 的请求量 | 无 | Count | `worker`, `route` |
| 每条路由的缓存命中率 | `cache_hit` Exists | Average of `cache_hit` | `worker`, `route` |
| 带 Steam Key 的调用总数 | 无 | Sum of `steam_keyed` | `worker`, `route` |
| 不带 Key 的调用总数 | 无 | Sum of `steam_unkeyed` | `worker`, `route` |
| Worker 返回的各 HTTP 状态 | 无 | Count | `route`, `http_status` |
| Steam 对带 Key 调用返回 429 的次数 | 无 | Sum of `steam_http.keyed_429` | `route` |
| 各路由调用 GetDetails 的次数 | 无 | Sum of `steam_endpoints.get_details` | `route` |

`worker` 取 `l4d2-workshop` 或 `l4d2-workshop-to-url`。前者的 `route` 取 `/list`、`/detail`、`/updates` 或 `other`，后者的入口统一记为 `parse`。汇总只写固定标签、状态和计数。只有进入这版 Worker 且被 Workers Logs 收录的事件可查。

- **缓存。** `hit` / `miss` 表示 Cache API 读到响应 / 正常查空，`cache_hit` 对应 1 / 0。平均值等于 `hit / (hit + miss)`，如 0.75 表示 75%。`not_checked`（例如预检、入口限流、解析参数校验）和 `error`（打开或读取缓存出错）均无此数值，分母为零时没有命中率。用 Count 按 `route`、`cache` 分组可核对分子和分母。缓存写入沿用原来的后台行为。
- **上游调用。** 每发起一次 Steam `fetch` 计一次，包括失败、并发查询及后续重试。带 Key 指请求实际附有配置的非空 Key，次数不能证明 Steam 扣减了配额。列表缺少配置时原代码仍可能向 Steam 发送占位值，此次尝试记入 `steam_unkeyed`。`steam_endpoints` 的固定计数为 `query_files`、`get_details`、`published_file_details`、`collection_details`，解析 Worker 只调用 `get_details`。
- **状态。** `http_status` 记录 Worker 返回的 HTTP 状态，处理函数直接抛错时为 `null`。`steam_http` 按实际使用 Key 与 HTTP 状态计数，例如 `keyed_200`、`unkeyed_429`。未取得 HTTP 状态的尝试计入 `steam_fetch_errors`。即使 JSON 无效或单项 Steam result 为 9，已收到的 HTTP 200 仍计入 200。只有出现过的上游状态才有对应字段。
- **读数示例。** 冷缓存的混合列表通常是 1 次入口、2 次带 Key。普通详情带预览且没有依赖时是 1 次带 Key、1 次不带 Key。合集确认和子项分块会追加不带 Key 的调用。合法的 100 项更新批次在缓存查空时只用 1 次不带 Key 的调用。入口限流的 429 为零次，Steam 返回 429 则计入相应状态桶。

两个 Worker 都没有主动拒绝并返回 409 的分支。缓存若返回 409，入口状态为 409，Steam 调用为零。若 Steam 对 `/updates` 或解析查询返回 409，入口按原逻辑返回 502，同时记录一次上游 409。基础详情先失败时，客户端可以先收到错误，汇总会等仍在途的预览请求结束后写入。若运行时提前终止，可能没有该条汇总。
