# 图鉴司 · archify（Paseo 插件）

把 [archify](https://github.com/tt-a1i/archify) 技能包接进 Paseo，侧边栏常驻一出图台。
架构 / 工作流 / 时序 / 数据流 / 生命周期五型图谱，输出**单体可交互 HTML**（内联 SVG、明暗主题、可选运动轨迹、可导 PNG/WebM）。

## 贡献面

| 贡献 | 位置 | 说明 |
| --- | --- | --- |
| 侧边栏主面板 | `client/Surface.tsx` | 选型 → 载样例/粘 JSON → 出图 → 台账 → 预览站 |
| 命令中心条目 | `index.client.tsx` | ⌘K 搜「图鉴司」直达面板 |
| 时间线行 | `client/Report.tsx` | `archify-report`，出图回执推入 agent 时间线 |

## RPC

- `archify.doctor` — 环境体检（技能包路径 / 版本 / Chrome）
- `archify.example` — 取官方样例（示例教形状，不教事实）
- `archify.list` — 扫台账 `<root>/.archify/<type>-<slug>-<stamp>/`
- `archify.generate` — 跑 `finalize` 四门（validate / deliver / check / browser-check）
- `archify.serve` — 起/停 HTTP 预览小站（0.0.0.0 随机端口，台账首页 + 产物直链）

## 布局

```text
archify/
  paseo-plugin.json         # id: archify, requirements.paseo >= 0.10.3
  index.client.tsx          # 客席入口：面板 + 侧边栏 + 命令中心 + 时间线渲染
  index.server.ts           # 服务端入口：五路 RPC
  client/Surface.tsx        # 侧边栏主面板（RN 原语，主题取色）
  client/Report.tsx         # 时间线回执行
  server/archify-backend.ts # 寻路 / 出图 / 台账 / 预览小站
  shared/contracts.ts       # Zod 契约
  vendor/archify/           # archify 技能包本体（MIT，v3.0.1）
```

## 依赖与前置

- Node ≥ 18（实测 v22）
- **Chrome/Chromium 必需**：`browser-check` 门要真浏览器。解析顺序
  `ARCHIFY_CHROME` → `/usr/local/bin/chromium` → Playwright 缓存 → PATH。
- 出图总仓默认 `/root/.paseo/plugin-data/archify/diagrams`，可在面板改。

## 装机与运维

```bash
cd /root/.paseo/plugins/archify
npm run typecheck
paseo plugin install /root/.paseo/plugins/archify
paseo plugin ls            # 须为 running
paseo plugin logs archify  # 排障
paseo plugin reload archify
```

改源码后必须 `paseo plugin reload archify`。技能包本体另在
`~/.pi/agent/skills/archify`、`~/.claude/skills/archify` 各挂一份软链，
使 agent 亦能直呼 `node bin/archify.mjs finalize …`。

## 许可

插件本体 MIT。`vendor/archify/` 为上游 MIT 产物，版权归 tt-a1i；见 `vendor/archify/LICENSE` 与 `THIRD_PARTY_NOTICES.md`。
