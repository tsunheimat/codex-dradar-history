# codex-dradar-history

## 面向 Codex Radar 的长期历史采集器

[English](README.md) | [简体中文](README.zh-CN.md)

**在线历史档案：** [dradar.webhei.top](https://dradar.webhei.top)

codex-dradar-history 持续采集 [Codex Radar](https://codexradar.com) 和 [Distributed Radar](https://deng.codexradar.com)
背后的公开只读数据，将短暂的实时仪表盘变成可检索的历史档案。它保存页面快照、事件、模型评分、
IQ 数据、订阅数、基准单元状态变化、RSS 条目和运行统计，让这些内容在上游滚动窗口更新后仍然可以查询。

> 数据来自 Codex 雷达 · codexradar.com。codex-dradar-history 是独立的档案项目，与上游项目没有隶属关系。

## 为什么需要它

实时仪表盘回答的是：**现在发生了什么？**

采集器补上了历史视角：

- 某一天雷达显示了什么？
- 某个模型、任务或基准单元何时改变了状态？
- IQ、评分、订阅数和运行统计如何随时间变化？
- 哪些事件和观测已经从上游网站消失？

最终得到的是一个镜像和一台时间机器。你可以打开最新快照，也可以通过 `?at=<timestamp>` 查看某个历史时刻。

## 采集内容

采集器只访问固定允许列表中的公开 HTTPS 主机，并以适度且可配置的频率轮询。原始响应会按 SHA-256
进行内容去重，同时提取到 SQLite 中的追加式历史表，包括：

- IQ 点和智能效率数据
- 可搜索的评分事件和任务历史
- 基准单元状态时间线
- 模型评分和订阅数增长
- RSS 条目和 Distributed Radar 运行统计
- 离线重放所需的同源页面资源

服务器是只读的，不会登录、领取任务、提交评分、订阅用户，也不会调用需要密钥的完整 API。重放页面使用
本地 API 和资源路径，不需要连接上游网站或第三方分析服务。

## 工作原理

```text
公开的 Codex Radar 接口
          |
          v
采集器 -> 原始快照 + 提取的历史 -> archive.sqlite
                                      |
                                      v
                         只读镜像和历史服务器
```

两个 Node 进程共享一个 SQLite 数据库：

- `src/collector.js` 轮询数据源、去重内容、发现页面资源并更新历史。
- `src/server.js` 提供镜像页面、档案 API、图表和按时间戳重放的页面。

较旧的文本快照会使用 Brotli 压缩。较大的图片资源可以通过 `sharp` 切片并重新组合，以控制长期运行的档案体积。

## 浏览在线档案

打开 **[dradar.webhei.top](https://dradar.webhei.top)** 浏览已部署的实例。

常用页面：

| 路径 | 说明 |
| --- | --- |
| `/` | Codex Radar 镜像 |
| `/deng/` | Distributed Radar 镜像 |
| `/history` | IQ、评分、订阅数和运行统计的长期图表 |
| `/history/events` | 可搜索的评分事件历史 |
| `/history/cells` | 基准单元状态时间线 |
| `/sources` | 采集器健康状态、数据源版本和存储信息 |

镜像页面和档案 API 路由支持 `?at=`，参数可以是 ISO-8601 时间戳或 Unix 毫秒时间戳：

```text
https://dradar.webhei.top/?at=2026-07-20T12:00:00Z
https://dradar.webhei.top/deng/?at=1785000000000
```

## 本地运行

要求：Node.js 22.5 或更高版本（开发和部署使用 Node 24）以及 npm。

```sh
npm install
npm run seed:fixtures   # 可选：创建离线演示档案
npm start
```

然后打开 <http://localhost:3210/>。如需采集实时观测，在另一个终端运行采集器：

```sh
npm run collect          # 持续轮询
npm run collect:once     # 采集当前到期的数据源后退出
```

Fixture 初始化完全在本地执行，不会访问上游。运行测试：

```sh
npm test
```

测试使用临时数据、已捕获的 fixture 和本地测试服务器，不会请求公开的 Codex Radar 网站。

## Docker Compose

同时启动 Web 服务器和采集器：

```sh
docker compose up -d
```

两个服务共享 `./data`。`web` 服务监听 `3210` 端口，`collector` 服务写入同一个 SQLite 档案。如需初始化空部署，
可以使用内置 fixture：

```sh
docker compose run --rm web node scripts/seed-fixtures.js
```

默认镜像为：

```text
ghcr.io/tsunheimat/codex-dradar-history:latest
```

在 `.env` 中设置 `DRADAR2_IMAGE` 可以固定版本或不可变镜像标签。没有 Docker 的主机可以使用
`deploy/dradar2-web.service` 和 `deploy/dradar2-collector.service` 中的用户级 systemd 单元。

## 配置

配置通过环境变量读取，也支持本地 `.env` 文件。完整列表请参阅 [`.env.example`](.env.example)。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3210` | 镜像和历史服务器端口 |
| `BIND` | `0.0.0.0` | 绑定地址；仅本机访问时使用 `127.0.0.1` |
| `DATA_DIR` | `./data` | 存放 `archive.sqlite` 的目录 |
| `USER_AGENT` | `dradar2/1.0 (+personal long-term archive of codexradar.com)` | 发送给上游的采集器标识 |
| `MAX_RESPONSE_MB` | `8` | 解压后的响应大小上限 |
| `RUNS_KEEP_DAYS` | `30` | 采集审计记录保留天数；原始快照仍会保留 |
| `INTERVAL_SCALE` | `1.0` | 轮询间隔倍率；`2.0` 表示轮询频率减半 |
| `FEED_INTERVALS` | 空 | 按数据源覆盖轮询间隔的 JSON 配置 |

## 礼貌使用、安全与内容归属

codex-dradar-history 只使用公开 GET 接口，通过 `USER_AGENT` 表明身份，并提供可调节的请求频率，同时保留上游署名。
如果你运行自己的实例，请保持适度的轮询频率并保留署名信息。

服务器没有任何身份验证。任何能访问 `PORT` 的人都可以读取完整的本地档案；请将它放在可信网络中，或置于
自己的认证代理/VPN 后面。仅限本机访问时设置 `BIND=127.0.0.1`。

这是一个个人、非商业的归档工具。归档的页面、图片和数据属于上游所有者。codex-dradar-history 只是在保留署名的前提下
存储和重新展示这些观测，不主张拥有上游内容的所有权。
