# 串红A

四人实时在线中文扑克游戏。服务端保存权威牌局状态，浏览器只接收当前玩家可见的信息。

## 当前功能

- 创建或加入 5 位房间码，四人入座后由房主开局。
- 标准 52 张牌发完，♥2 持有者首出，首手必须包含 ♥2。
- 找伙、公开红A、反揪、最大单张展示和积分翻倍。
- 单张、对子、连对、顺子、三/四张炸弹、特殊 A 组。
- 普通压牌、不要、自由领出、走牌、要风、给风和管风。
- 2v2 与 1v3 的终局判定，以及零和积分、连续下一局。
- 仅本人手牌下发的视角快照、服务端操作校验、断线会话恢复。
- 桌面与移动浏览器响应式牌桌。

规则唯一来源是 [RULES.md](RULES.md)。尚未裁决的边界见
[OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)。第一版对开局顺序使用页面明确提示的暂行实现，不把该顺序标记为正式规则。

## 技术要求

- Node.js 22 或更高版本
- pnpm 10

## 本地开发

```bash
pnpm install
pnpm dev
```

打开 `http://localhost:5173`。Vite 开发服务器会把 Socket.IO 和健康检查请求代理到 `http://localhost:3000`。

生产构建与启动：

```bash
pnpm build
pnpm start
```

打开 `http://localhost:3000`。生产服务会从 `apps/web/dist` 提供前端静态文件，并在同一端口处理 Socket.IO。

## 容器部署

```bash
docker compose up --build -d
```

打开 `http://localhost:3000`。健康检查地址为 `GET /healthz`。

可通过环境变量设置监听地址和端口：

```bash
HOST=0.0.0.0 PORT=8080 pnpm start
```

## 验证命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

核心规则测试位于 `packages/game-core/test`，Socket 端到端测试位于 `apps/server/test`。

## 结构

```text
apps/
  server/       Node.js + Socket.IO 权威房间服务
  web/          React + Vite 响应式客户端
packages/
  game-core/    纯 TypeScript 牌模型、规则和视角投影
```

`game-core` 不依赖 React、Socket.IO 或数据库。每个操作在服务端验证行动者、回合、手牌和牌型后才会修改状态。

## 视角与断线

房间状态仅在服务器内存中。浏览器保存房间码、玩家 ID 和不透明恢复令牌。重载页面后会自动尝试恢复席位。服务器重启会清空全部房间、牌局和累计积分。

公开记录只包含已经打出的牌或规则要求的亮牌。其他玩家的暗牌只以张数出现，不会先发送到浏览器再用 CSS 隐藏。

## 暂行规则

首版的行为边界集中在 `RulePolicy`、`OPEN_QUESTIONS.md` 和界面的开局提示中。以下行为尚未定稿：

- 反揪的完整轮询顺序和窗口。
- 红A单独反揪是否自动算作已找伙。
- `AA` 对 `AA`。
- 接风递补和连续走牌的详细边界。

修改这些行为前应先核定 `RULES.md`，再更新规则引擎、测试和界面说明。
