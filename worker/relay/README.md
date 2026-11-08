# LytVPK 备用 API 转发服务

独立的 Go 服务，为固定 Worker API 提供有界转发、限流和统计。源码、测试、依赖及本地构建产物均位于 `worker/relay`，使用独立 Go module，不依赖外层管理器模块，也不会更改现有 Worker 或客户端线路。

```text
worker/relay/
├── go.mod / go.sum          独立的服务依赖
├── cmd/lytvpk-relay/        命令行入口与进程管理
├── internal/relay/          转发、限流、超时、统计及 Go 测试
├── test_process.py          本地进程测试
├── lytvpk-relay.env.example 通用环境变量示例
├── .gitignore               服务本地产物忽略规则
└── build/bin/               本地构建产物，不提交
```

## 接口

| 本地接口 | 固定上游 |
| --- | --- |
| `GET /list` | `https://l4d2-workshop.laoyutang.cn/list` |
| `GET /detail` | `https://l4d2-workshop.laoyutang.cn/detail` |
| `POST /parse`，兼容 `POST /` | `https://l4d2-workshop-parse.laoyutang.cn/` |
| `GET /maps/{mapCode}` | `https://l4d2-maps.laoyutang.cn/{mapCode}` |
| `GET /ips` | `https://lytvpk-get-ips.laoyutang.cn/` |
| `GET /healthz` | 本地进程健康检查 |

浏览和详情保持 Worker 的参数及 JSON 响应形状；解析接受非空 JSON ID 数组，兼容整数和数字字符串，返回上游原始数组。地图名返回上游文本。`/ips` 只允许 `domain=cdn.steamusercontent.com`；`format` 可用 `entries` 或省略。所有上游由程序固定，不提供任意 URL 代理或上游地址配置。

上游正常完成且响应在大小限制内时，保留其 HTTP 状态、响应正文及 `Retry-After` 等响应头。连接失败、超时和响应过大由服务返回相应错误；服务不自动重试上游请求。客户端取消会取消排队或进行中的上游请求。输入、请求体和响应体都有上限，逐用户及全局令牌桶、并发上限和有界等待队列共同控制开销。

## 构建与验证

使用本模块要求的 Go 版本；从仓库根目录先进入服务目录：

```sh
cd worker/relay
CGO_ENABLED=0 go test ./internal/relay ./cmd/lytvpk-relay
CGO_ENABLED=0 go vet ./internal/relay ./cmd/lytvpk-relay
mkdir -p build/bin
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -buildvcs=false \
  -ldflags '-s -w -X main.version=local' \
  -o build/bin/lytvpk-relay-linux-amd64 ./cmd/lytvpk-relay
sha256sum build/bin/lytvpk-relay-linux-amd64
python3 test_process.py
```

转发服务直接使用 `database/sql` 和纯 Go 驱动 `github.com/glebarez/go-sqlite v1.21.2`，底层为 `modernc.org/sqlite v1.23.1`，不引入 GORM。核对时面板默认分支的 [backend/go.mod](https://github.com/LaoYutang/l4d2-server-next/blob/e6152e6171a6552301e486d2c0e1a5407bb0e426/backend/go.mod) 和 [数据库初始化](https://github.com/LaoYutang/l4d2-server-next/blob/e6152e6171a6552301e486d2c0e1a5407bb0e426/backend/db/db.go) 使用 `github.com/glebarez/sqlite v1.11.0` GORM 适配器，其底层也是这一驱动。上述构建关闭 CGO，生成纯 Go 静态程序，不需要 gcc、系统 SQLite 库或 SQLite 开发包。

需要额外进行 Go 并发竞态检测时，可运行 `CGO_ENABLED=1 go test -race ./internal/relay ./cmd/lytvpk-relay`。这是 Go race 检测器自身对 CGO 和 C 工具链的要求；SQLite 驱动及最终交付程序仍使用纯 Go，普通测试与构建保持 `CGO_ENABLED=0`。

外层管理器的 `go test ./...` 不会包含这个独立模块，服务测试须在 `worker/relay` 内单独运行。以下命令均以该目录为工作目录。

进程烟测默认使用本目录的上述构建产物；可用 `LYTVPK_RELAY_BIN=/path/to/lytvpk-relay python3 test_process.py` 指定其他二进制。脚本只需 Python 3 标准库（含 `sqlite3`），在 loopback 临时端口验证配置拒绝、环境与参数优先级、API/管理隔离、有界排队、总请求预算、SQLite 数据校验与重启恢复及 SIGTERM 等待活动和排队请求完成。普通测试显式关闭持久化，数据库测试使用临时目录。API 请求使用本地拒绝的无效输入，不访问生产上游，也不执行部署。

本地运行：

```sh
CGO_ENABLED=0 go run ./cmd/lytvpk-relay -stats-file ''
curl --fail http://127.0.0.1:18080/healthz
curl --fail http://127.0.0.1:18081/stats
```

`-version` 显示构建版本，`-help` 显示全部选项。测试使用受控上游，不需要生产 Steam API key。现网端到端验证另外依赖 DNS、目标 Worker 可达性及其配额。

## 配置

默认 API 绑定 `127.0.0.1:18080`，管理接口绑定 `127.0.0.1:18081`。地址必须使用 IP 字面量及有效端口；管理接口强制 loopback。环境变量见 `lytvpk-relay.env.example`，命令行参数优先于环境变量。

| 选项 | 环境变量 | 默认值 |
| --- | --- | --- |
| `-listen` | `RELAY_LISTEN` | `127.0.0.1:18080` |
| `-admin-listen` | `RELAY_ADMIN_LISTEN` | `127.0.0.1:18081` |
| `-trusted-proxies` | `RELAY_TRUSTED_PROXIES` | 空 |
| `-real-ip-header` | `RELAY_REAL_IP_HEADER` | `X-Real-IP` |
| `-client-rate` | `RELAY_CLIENT_RATE` | 50 次/分钟 |
| `-client-burst` | `RELAY_CLIENT_BURST` | 500 |
| `-global-rate` | `RELAY_GLOBAL_RATE` | 600 次/分钟 |
| `-global-burst` | `RELAY_GLOBAL_BURST` | 1000 |
| `-max-clients` | `RELAY_MAX_CLIENTS` | 20000 |
| `-client-idle-ttl` | `RELAY_CLIENT_IDLE_TTL` | `10m` |
| `-max-concurrent` | `RELAY_MAX_CONCURRENT` | 32 |
| `-max-concurrent-per-client` | `RELAY_MAX_CONCURRENT_PER_CLIENT` | 16 |
| `-max-queued` | `RELAY_MAX_QUEUED` | 1024 |
| `-max-queued-per-client` | `RELAY_MAX_QUEUED_PER_CLIENT` | 500 |
| `-queue-timeout` | `RELAY_QUEUE_TIMEOUT` | `5s` |
| `-request-timeout` | `RELAY_REQUEST_TIMEOUT` | `10s`，最多 10 秒 |
| `-upstream-timeout` | `RELAY_UPSTREAM_TIMEOUT` | `10s` |
| `-stats-file` | `RELAY_STATS_FILE` | `/var/lib/lytvpk-relay/stats.sqlite3` |
| `-stats-flush-interval` | `RELAY_STATS_FLUSH_INTERVAL` | `5s` |
| `-max-body-bytes` | `RELAY_MAX_BODY_BYTES` | 65536 |
| `-max-response-bytes` | `RELAY_MAX_RESPONSE_BYTES` | 8388608 |
| `-max-parse-ids` | `RELAY_MAX_PARSE_IDS` | 1000 |

客户端 Mod 库更新会突发请求大量详情，现有客户端不会对 HTTP 429 自动重试。因此逐用户默认突发额度与现有 Worker 的 500 保持一致；暂时超出活动并发额度的请求由有界队列吸收，默认最多全局 1024 个、单用户 500 个等待请求，最长等待 5 秒。队列满或等待超时返回 HTTP 429。将两个队列容量同时设为 0 可关闭排队；管理员可按实际用户容量调整并发、等待容量和时限。

普通接口每个请求扣一份调用额度；解析每 100 个 ID 扣一份，不足 100 个也按一份计，逐用户与全局桶都采用该成本。调用速率超额仍会直接被拒绝。新调用方应尊重 `Retry-After`，分批更新和重试；不应同时为全部条目无限建立请求。较大的合集解析请求可能达到 1000 ID 上限，超过时需要调用方分批。

总预算从 Go 完成请求头解析、进入 `ServeHTTP` 时开始；读取请求头另有不超过 5 秒的限制。请求体读取、等待队列、实际上游调用和响应写出共享 `RELAY_REQUEST_TIMEOUT`，默认和最大值均为 10 秒；可以缩短该值。`RELAY_QUEUE_TIMEOUT` 和 `RELAY_UPSTREAM_TIMEOUT` 分别进一步限制等待和上游阶段，不能延长剩余总预算。例如排队耗时 4 秒后，上游和响应写出只能使用剩余约 6 秒。

程序在总预算内预留 `min(100ms, RequestTimeout/10)` 发送 HTTP 504，处理阶段会提前结束。若响应头已经发送，客户端所见状态无法再改成 504，超时会关闭或截断响应，并按 504 统计。已有客户端的自身超时仍会取消尚未完成的请求。

Go 的总预算从服务收到请求头后开始，不包含此前的 TLS 握手、入口请求头读取、反向代理预缓冲或网络传输耗时。

只有显式配置的受信代理可以提供客户端地址头，受信代理 CIDR 仅允许回环范围。`-real-ip-header` 只接受 `X-Real-IP` 或 `CF-Connecting-IP`，该头只能包含单个地址。`X-Forwarded-For` 链不作为用户标识。

Worker 仍会对转发流量应用自己的配额和限流。本服务不会通过伪造 Cloudflare 身份头绕过其限制。

## 统计与管理

管理监听器提供 `GET /healthz` 和 `GET /stats`，不要将其反代到公网。统计只描述经过该服务的请求，无法覆盖客户端直接访问 Worker 的流量。

`total_requests` 包含业务入口收到的预检、无效路径和被拒请求，不包含健康检查及管理接口访问。`forwarded_requests` 是向固定 Worker 发起的 HTTP 请求数，包含最终失败的尝试，不代表 Worker 内部访问 Steam 的次数。`upstream_failures` 包含上游 5xx、网络错误、超时及不可用响应；客户端主动取消单独计为 499，不计入上游故障。

`anonymous_users` 按 UTC 当天的 IP 身份近似计算，`cumulative_anonymous_users` 提供跨日去重的累计地址估计，两者都不能视为登录用户数；同一 NAT 下的人可能合并，同一人更换 IP 也可能重复。统计内存有界，不记录原始 IP 或请求内容。累计调用数、当天计数与匿名估计、最多 30 天的每日历史可通过 SQLite 跨进程恢复。

守护程序默认使用真正的 SQLite 数据库 `/var/lib/lytvpk-relay/stats.sqlite3`，每 5 秒尝试提交统计事务；自定义文件必须使用绝对路径，`-stats-file ''` 或空 `RELAY_STATS_FILE` 显式关闭持久化。数据库仅供单实例使用，不可由多个服务进程共享。程序库默认不启用持久化。加载、后台事务和退出保存都由独立维护任务执行，业务请求只更新内存，不进行数据库操作。服务启动即可处理请求，后台恢复完成前请查看 `persistence.ready`；`persistence` 还报告启用状态、加载/保存错误、最近保存时间及恢复状态。

加载出现 `load_error`（例如损坏的 SQLite、未来格式或不安全路径）时，服务暂停向该目标写入，以保留原文件；业务继续响应并在内存中统计，管理接口公开 `load_error` 和 `save_error`。管理员需处理或移走有问题的文件后重启服务。旧 JSON 检查点不能改扩展名后充当 SQLite，也不会被自动覆盖或转换。正常加载后发生保存故障（包括数据库被锁住），则继续周期重试，业务请求不等待数据库。错误状态不代表数据已经保存。

未启用或尚未成功加载/保存时，重启可能丢失统计。正常退出会在请求完成后尝试最终保存，维护退出最多等待 1 秒，慢盘不会无限拖住进程。异常退出或保存失败仍可能丢失最近尚未落盘的数据。`resets_on_restart` 及 `persistence` 字段共同说明当前恢复能力。

数据库使用规范化表：`meta` 保存匿名种子与时间元数据，`cumulative` 保存累计计数，`daily` 保存当天及最近 30 天的每日历史，`route_counts`/`status_counts` 保存路由与状态计数，`sketches` 保存匿名位图；结构版本由 `PRAGMA user_version` 标识。计数使用独立字段，不把完整状态塞进 JSON 单列。后台事务使一次保存原子完成，使用 `DELETE` journal 模式避免 WAL 长期增长；数据库主文件上限 2 MiB。当前日与累计匿名估计各用固定 64 KiB 位图，后台加载前最多暂存 4096 个匿名指纹；超出时标记估计不完整。数据库文件权限为 0600，不保存原始 IP、请求内容或可枚举的用户明细。

## 进程行为

服务以前台模式运行，SIGTERM 会停止接收请求并等待活动请求结束，排空等待受请求总预算加 2 秒的时限约束。HTTP 请求头读取超时不超过 5 秒，读取/写入使用总请求预算，空闲连接超时 60 秒，请求头上限 16 KiB。
