# dsh-token-speed

[![npm version](https://img.shields.io/npm/v/dsh-token-speed)](https://www.npmjs.com/package/dsh-token-speed)
[![license](https://img.shields.io/npm/l/dsh-token-speed)](LICENSE)

在 DeepSeek Harness 的对话输入框下方显示**实时 Token 吞吐**：生成中的输出速度、实时输出 Token 数、本轮输入 Token 数。

```
● 42 tok/s · ↑48.3k · ↓1.24k
```

点击胶囊展开详情面板：状态、已用时、输入合计与缓存分桶、缓存命中率、上下文占用、输出 Token、首字延迟、解码时长、模型/工具耗时、实时与平均速度、会话累计，以及最近几秒的速度柱状图。

> Live token-throughput meter for the DeepSeek Harness Web chat composer.

## 安装

在 **Plugins → Add plugin** 里填 `dsh-token-speed`，Install 后选择 **Enable now**。

CLI：

```sh
dsh plugin --profile desktop add dsh-token-speed
```

> Web 版把 `desktop` 换成 `web`。

直接从 GitHub 安装（尚未发布 npm 时）：

```sh
dsh plugin --profile desktop add "git+https://github.com/alwayswithmestand/dsh-token-speed.git#v1.0.0"
```

生产环境建议锁 commit（`#<40 位 sha>`），不要用可移动的 tag。

安装后若没有自动启用，在 **Plugins** 页打开对应开关。客户端插件无需重启应用。

## 数值语义

| 数值 | 生成中 | 结束后 |
|---|---|---|
| 输出 Token | 按流式字符**估算**（窄字符 4 字/token，CJK 1.6 字/token） | provider 上报的**精确** `outputTokens` |
| 速度 | 最近 2 秒滑窗速率（估算） | `decodeTokens / decodeMs`（精确平均） |
| 输入 Token | 上下文投影（`contextPressure.projectedTokens`） | 最近一次请求的**精确**提示词用量 |
| 缓存分桶 / 命中率 | 来自最近一次 provider 上报 | 同左 |

provider 只在流结束时上报一次 usage，生成过程中拿不到真实输出 token 数，所以面板会明确标注当前是「估算」还是「精确」。

## 为什么需要它

DSH 自带的速度在每一步结束后才计算（`sessionStats` 的 `decodeTokens / decodeMs`），`tokenUsage`、`contextPressure` 也只在每次 attempt 结算时更新，生成过程中看不到任何实时速度。

本插件从客户端已经折叠好的实时助手流（`useChat(s => s.legacy.partial)` 里的 text / reasoning / tool-call 增量）现算速度，因此：

- 不新增 Host 服务、事件或工具，`index.js` 是空实现；
- 不额外发请求，全部数据来自浏览器里已有的会话状态；
- 订阅随插件卸载一起销毁，不残留 DOM 或定时器。

## 兼容性

| 项目 | 要求 |
|---|---|
| DeepSeek Harness | `>=0.2.2-rc.1 <0.3.0`（`engines.dsh`，安装前校验） |
| 平台 | Web 与 Desktop 的 Web UI |

## 插件市场索引

仓库根的 [`index.json`](index.json) 是 format 1 的市场索引。在 **Plugins → Discover → Add index source** 里添加：

```
https://raw.githubusercontent.com/alwayswithmestand/dsh-token-speed/main/index.json
```

之后可以在 Discover 里搜索、查看详情并一键安装。

## 开发

```sh
npm run check       # node --check index.js + client.js
npm run pack:check  # 检查发布时的文件清单
```

本地联调、发布流程见 [DEVELOPMENT.md](DEVELOPMENT.md)。

## 许可证

[MIT](LICENSE)
