/**
 * server/archify-backend.ts — 图鉴司后端核心引擎。
 * 职责：
 * 1. 动态寻路（archify 技能包、Chromium 浏览器）。
 * 2. 跑 archify CLI finalize 四道严苛门禁（validate/deliver/check/browser-check）。
 * 3. 动态扫盘当前任务与工作区中的 .archify 图谱。
 * 4. 内置 HTTP 静态/交互渲染服务，为前端 iframe 提供 /view 直链。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import type {
  DeleteOutput,
  DiagramItem,
  DiagramType,
  GateReport,
  GenerateInput,
  GenerateOutput,
  ListOutput,
  ReadOutput,
  RenameOutput,
  ServeOutput,
} from "../shared/contracts";

export const DEFAULT_ROOT = "/root/.paseo/plugin-data/archify/diagrams";

const SKILL_CANDIDATES = [
  process.env.ARCHIFY_SKILL_ROOT,
  "/root/.paseo/plugins/archify/vendor/archify",
  "/root/.pi/agent/skills/archify",
].filter((candidate): candidate is string => Boolean(candidate));

export function resolveSkillRoot(): string {
  for (const candidate of SKILL_CANDIDATES) {
    if (existsSync(path.join(candidate, "bin", "archify.mjs"))) return candidate;
  }
  return SKILL_CANDIDATES[0] ?? "/root/.paseo/plugins/archify/vendor/archify";
}

export function resolveChrome(): string | null {
  const fromEnv = process.env.ARCHIFY_CHROME;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  for (const fixed of [
    "/usr/local/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ]) {
    if (existsSync(fixed)) return fixed;
  }

  const cacheRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || "/root/.cache/ms-playwright";
  try {
    for (const entry of readdirSync(cacheRoot)) {
      if (!entry.startsWith("chromium-")) continue;
      const base = path.join(cacheRoot, entry);
      for (const arch of readdirSync(base)) {
        for (const name of ["chrome", "headless_shell"]) {
          const bin = path.join(base, arch, name);
          if (existsSync(bin)) return bin;
        }
      }
    }
  } catch {}

  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (!dir) continue;
    for (const name of ["chromium", "google-chrome", "chrome"]) {
      const bin = path.join(dir, name);
      if (existsSync(bin)) return bin;
    }
  }
  return null;
}

function readArchifyVersion(skillRoot: string): string {
  try {
    const raw = JSON.parse(readFileSync(path.join(skillRoot, "skill-release.json"), "utf8")) as {
      version?: string;
    };
    return raw.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function doctor() {
  const skillRoot = resolveSkillRoot();
  const chrome = resolveChrome();
  const version = readArchifyVersion(skillRoot);
  const lines: string[] = [];
  lines.push(`技能包路径：${skillRoot}`);
  lines.push(`archify 核心版本：${version}`);
  lines.push(`Node 运行态：${process.version}`);
  lines.push(chrome ? `浏览器引擎：${chrome}` : "浏览器引擎：未就绪（browser-check 门需要）");
  lines.push(`全局图鉴根仓：${DEFAULT_ROOT}`);
  return {
    ok: existsSync(path.join(skillRoot, "bin", "archify.mjs")) && Boolean(chrome),
    nodeVersion: process.version,
    archifyVersion: version,
    chromePath: chrome,
    skillRoot,
    defaultRoot: DEFAULT_ROOT,
    lines,
  };
}

export function example(type: DiagramType) {
  const skillRoot = resolveSkillRoot();
  const dir = path.join(skillRoot, "examples");
  const preferred: Record<DiagramType, string[]> = {
    architecture: ["production-deployment.architecture.json", "web-app.architecture.json"],
    workflow: ["agent-tool-call.workflow.json", "incident-response.workflow.json"],
    sequence: ["cache-miss-request.sequence.json"],
    dataflow: ["product-analytics.dataflow.json", "event-stream.dataflow.json"],
    lifecycle: ["agent-run.lifecycle.json", "deployment-release.lifecycle.json"],
  };
  const wanted = preferred[type];
  let picked = wanted.find((name) => existsSync(path.join(dir, name)));
  if (!picked) {
    try {
      picked = readdirSync(dir).find((name) => name.endsWith(`.${type}.json`) || name.includes(`.${type}.`));
    } catch {
      picked = undefined;
    }
  }
  if (!picked) {
    return { type, name: "", json: "", bytes: 0 };
  }
  const json = readFileSync(path.join(dir, picked), "utf8");
  return { type, name: picked, json, bytes: Buffer.byteLength(json, "utf8") };
}

function stamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "diagram";
}

function guessTitle(candidate: unknown): string {
  if (candidate && typeof candidate === "object") {
    const record = candidate as Record<string, unknown>;
    const meta = record.meta;
    if (meta && typeof meta === "object") {
      const metaRecord = meta as Record<string, unknown>;
      for (const key of ["title", "name", "id"]) {
        const value = metaRecord[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    }
    for (const key of ["title", "name"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "diagram";
}

type RunResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

function runArchify(args: string[], cwd: string, timeoutMs: number): Promise<RunResult> {
  const chrome = resolveChrome();
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (chrome) env.ARCHIFY_CHROME = chrome;

  return new Promise<RunResult>((resolve) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}\n${error.message}`, timedOut: false });
    });
    child.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut: false });
    });
  });
}

function pickReceipt(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {}
  }
  return null;
}

function emptyGates(): GateReport {
  return { validate: "fail", deliver: "fail", check: "fail", browserCheck: "fail" };
}

const LOCALIZED_TERMS: Record<string, string> = {
  // 基础组件与角色
  Customers: "终端用户",
  "web + mobile": "Web/移动端",
  "Global Edge": "全局边缘节点",
  "CDN + WAF": "CDN + 防火墙",
  "edge team": "边缘网络组",
  "API Gateway": "API 网关",
  "public :443": "公网:443",
  platform: "平台组",
  "API Pods / AZ-a": "API 节点 A",
  "API Pods / AZ-b": "API 节点 B",
  "private subnet": "内网专用子网",
  "app team": "应用研发组",
  Redis: "Redis 缓存",
  "multi-AZ cache": "多可用区缓存",
  PostgreSQL: "PostgreSQL",
  "primary / encrypted": "加密主库存储",
  "data team": "数据组",
  "Event Bus": "消息总线",
  "orders.v1": "订单事件流",
  Workers: "异步作业节点",
  "private workload": "内网后台作业",
  "DR Replica": "容灾只读副本",
  "eu-west-1": "灾备区",
  "Audit Archive": "审计归档仓",
  "immutable objects": "不可篡改对象",
  security: "安全组",
  Observability: "全链路监控",
  "metrics + traces": "指标与分布式追踪",
  SRE: "SRE 组",

  // 区域边界与安全域
  "AWS us-east-1 / production": "主生产核心集群",
  "private application network": "私有应用隔离网段",
  "AWS eu-west-1 / disaster recovery": "异地容灾隔离区",
  "DR private subnet": "灾备私有子网",

  // 链路与协议
  HTTPS: "HTTPS",
  mTLS: "双向 TLS",
  "VPC route": "VPC 路由",
  cache: "缓存查询",
  SQL: "SQL 事务",
  publish: "事件投递",
  "cross-region WAL": "跨地域同步",
  evidence: "合规审计留痕",
  OTLP: "链路遥测",

  // 卡片面板
  "Runtime Ownership": "运行时权责归属",
  "Platform owns the edge, gateway, cache, and event bus": "基础平台组负责边缘网关、缓存与消息中枢",
  "Application teams own API pods and workers": "应用研发组负责容器服务与后台异步处理",
  "Data owns primary and disaster-recovery state": "数据团队管理生产主数据库与异地灾备只读副本",
  "Named Crossings": "关键边界跨越协议",
  "Public HTTPS terminates at the managed edge": "外网请求由统一边缘加速及防护层终结",
  "mTLS crosses into the application network": "核心服务内部调用强制使用双向 TLS 认证",
  "Cross-region WAL is explicit and encrypted": "数据库跨地域复制通道显式定义并落盘加密",
  "Operational Evidence": "运维证据与链路审计",
  "Workers emit traces to SRE-owned observability": "业务负载向可观测平台统一输出链路追踪与监控",
  "Audit evidence lands in immutable storage": "敏感操作合规日志持久化存储于不可篡改归档区",
  "Unknown placement should remain marked, never invented": "所有拓扑流向必须有据可循，绝不凭空臆造",

  // 工作流术语
  "User Prompt": "用户指令下发",
  "Agent Reason": "智能体研判",
  "Tool Dispatch": "法器调用路由",
  "Sandbox Exec": "沙箱安全执行",
  "Tool Result": "执行回波提取",
  "Final Synthesize": "最终决策输出",
  "CLI / Web": "控制台/Web 端",
  "Model Reasoning": "大模型思维链",
  Router: "任务调度分发器",
  Runner: "隔离执行环境",
  "stdout / stderr": "标准回波输出",
  Response: "组装交付响应",
};

function translateText(val: string): string {
  return LOCALIZED_TERMS[val] || val;
}

/** 递归将图谱中的展示性字段本土化中文化 */
function localizeCandidateContent(candidate: unknown): void {
  if (!candidate || typeof candidate !== "object") return;
  const d = candidate as Record<string, unknown>;

  // 架构图节点
  if (Array.isArray(d.components)) {
    for (const c of d.components as Record<string, unknown>[]) {
      if (typeof c.label === "string") c.label = translateText(c.label);
      if (typeof c.sublabel === "string") c.sublabel = translateText(c.sublabel);
      if (typeof c.tag === "string") c.tag = translateText(c.tag);
    }
  }

  // 边界
  if (Array.isArray(d.boundaries)) {
    for (const b of d.boundaries as Record<string, unknown>[]) {
      if (typeof b.label === "string") b.label = translateText(b.label);
    }
  }

  // 连接关系
  if (Array.isArray(d.connections)) {
    for (const conn of d.connections as Record<string, unknown>[]) {
      if (typeof conn.label === "string") conn.label = translateText(conn.label);
    }
  }

  // 说明卡片
  if (Array.isArray(d.cards)) {
    for (const card of d.cards as Record<string, unknown>[]) {
      if (typeof card.title === "string") card.title = translateText(card.title);
      if (Array.isArray(card.items)) {
        card.items = (card.items as unknown[]).map((it) => (typeof it === "string" ? translateText(it) : it));
      }
    }
  }

  // 工作流步骤
  if (Array.isArray(d.steps)) {
    for (const st of d.steps as Record<string, unknown>[]) {
      if (typeof st.label === "string") st.label = translateText(st.label);
      if (typeof st.sublabel === "string") st.sublabel = translateText(st.sublabel);
      if (typeof st.detail === "string") st.detail = translateText(st.detail);
    }
  }

  // 工作流泳道
  if (Array.isArray(d.lanes)) {
    for (const ln of d.lanes as Record<string, unknown>[]) {
      if (typeof ln.label === "string") ln.label = translateText(ln.label);
    }
  }
}

/** 针对未提供具体 JSON 时的任务智能模板生成 */
function synthesizeCandidate(type: DiagramType, title: string, prompt?: string): string {
  const ex = example(type);
  if (ex.json) {
    try {
      const obj = JSON.parse(ex.json) as Record<string, unknown>;
      const output = `${slugify(title)}.html`;
      if (obj.meta && typeof obj.meta === "object") {
        const meta = obj.meta as Record<string, unknown>;
        meta.title = title;
        // meta 只允许 schema 声明的字段；description 非法，改写入合法 subtitle
        delete meta.description;
        if (prompt) meta.subtitle = prompt;
        meta.output = output;
        // 引擎内置 zh-CN 语言包，未显式指定时默认输出中文阅览界面
        if (!meta.locale) meta.locale = "zh-CN";
      } else {
        obj.meta = { title, subtitle: prompt, output, locale: "zh-CN" };
      }
      localizeCandidateContent(obj);
      return JSON.stringify(obj, null, 2);
    } catch {}
  }
  return ex.json || "{}";
}

/** 确保候选图谱使用中文阅览界面（未显式指定 locale 时注入 zh-CN，尊重作者已选语言） */
function ensureChineseLocale(candidate: unknown): void {
  if (!candidate || typeof candidate !== "object") return;
  const obj = candidate as Record<string, unknown>;
  if (!obj.meta || typeof obj.meta !== "object") obj.meta = {};
  const meta = obj.meta as Record<string, unknown>;
  if (!meta.locale || meta.locale === "en" || meta.locale === "en-US") {
    meta.locale = "zh-CN";
  }
  localizeCandidateContent(obj);
}

/** 出图执行 */
export async function generate(input: GenerateInput): Promise<GenerateOutput> {
  const started = Date.now();
  const skillRoot = resolveSkillRoot();
  const cli = path.join(skillRoot, "bin", "archify.mjs");
  const type = input.type;
  const quality = input.quality ?? "showcase";

  // 优先存入工作区目录，否则存入全局默认仓
  const root = input.workspaceDir?.trim() || input.root?.trim() || DEFAULT_ROOT;

  const fail = (title: string, lines: string[], extra?: Partial<GenerateOutput>): GenerateOutput => ({
    ok: false,
    title,
    lines,
    type,
    slug: extra?.slug ?? "",
    dir: extra?.dir ?? "",
    htmlPath: extra?.htmlPath ?? null,
    htmlBytes: extra?.htmlBytes ?? 0,
    url: extra?.url ?? null,
    gates: extra?.gates ?? emptyGates(),
    durationMs: Date.now() - started,
    receiptPath: extra?.receiptPath ?? null,
    hint: extra?.hint ?? null,
  });

  if (!existsSync(cli)) return fail("技能包缺位", [`未找到 ${cli}`, "请检查 vendor/archify 是否就位"]);
  if (!resolveChrome()) {
    return fail("缺 Chrome 引擎", [
      "archify 的 browser-check 门禁需要真浏览器支持",
      "请检查系统 Chromium 是否安装或 ARCHIFY_CHROME 变量配置",
    ]);
  }

  let candidateText = input.candidateJson?.trim();
  if (!candidateText) {
    const rawTitle = input.title?.trim() || "任务可视化图谱";
    candidateText = synthesizeCandidate(type, rawTitle, input.prompt);
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(candidateText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("候选 JSON 校验不通过", [message]);
  }

  // 统一注入中文阅览界面（引擎内置 zh-CN 语言包）
  ensureChineseLocale(candidate);
  candidateText = JSON.stringify(candidate, null, 2);

  const title = input.title?.trim() || guessTitle(candidate);
  const slug = slugify(title);
  const dir = path.join(root, ".archify", `${type}-${slug}-${stamp()}`);
  const candidatePath = path.join(dir, "candidate.json");
  const htmlPath = path.join(dir, `${slug}.html`);

  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(candidatePath, candidateText, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("工作区写入失败", [dir, message]);
  }

  const run = await runArchify(
    [cli, "finalize", type, candidatePath, htmlPath, "--quality", quality, "--json"],
    dir,
    240000,
  );

  const receipt = pickReceipt(run.stdout);
  const gatesRaw = (receipt?.gates ?? {}) as Record<string, unknown>;
  const gate = (key: string): string =>
    typeof gatesRaw[key] === "string" ? (gatesRaw[key] as string) : "fail";
  const gates: GateReport = {
    validate: gate("validate"),
    deliver: gate("deliver"),
    check: gate("check"),
    browserCheck: gate("browser-check"),
  };

  const artifact = (receipt?.artifact ?? {}) as Record<string, unknown>;
  const artifactPath = typeof artifact.path === "string" ? artifact.path : null;
  const artifactBytes = typeof artifact.bytes === "number" ? artifact.bytes : 0;
  const receiptPath =
    typeof (receipt?.evidence as Record<string, unknown> | undefined)?.receipt === "string"
      ? String((receipt?.evidence as Record<string, unknown>).receipt)
      : null;
  const ok = Boolean(receipt?.ok) && run.code === 0;

  // 确保存储与服务可用
  await ensureServe();
  const url = artifactPath ? getViewerUrl(artifactPath) : null;

  const lines: string[] = [];
  lines.push(`图谱名称：${title}`);
  lines.push(`产物路径：${artifactPath ?? htmlPath}`);
  lines.push(`文件体积：${(artifactBytes / 1024).toFixed(1)} KB`);
  lines.push(`四门质检：validate=${gates.validate} deliver=${gates.deliver} check=${gates.check} browser-check=${gates.browserCheck}`);
  lines.push(`出图耗时：${Date.now() - started} ms`);
  if (url) lines.push(`在线预览：${url}`);

  return {
    ok,
    title: ok ? `出图就绪 · ${title}` : `质检拦截 · ${title}`,
    lines,
    type,
    slug,
    dir,
    htmlPath: artifactPath ?? (existsSync(htmlPath) ? htmlPath : null),
    htmlBytes: artifactBytes,
    url,
    gates,
    durationMs: Date.now() - started,
    receiptPath,
    hint: null,
  };
}

/** 读单图 HTML 内容 */
export async function readDiagram(htmlPath: string): Promise<ReadOutput> {
  if (!existsSync(htmlPath)) {
    return { ok: false, title: "文件不存在", type: "architecture", html: "", bytes: 0, url: null };
  }
  try {
    const html = readFileSync(htmlPath, "utf8");
    const name = path.basename(htmlPath, ".html");
    await ensureServe();
    const url = getViewerUrl(htmlPath);
    return {
      ok: true,
      title: name,
      type: "architecture",
      html,
      bytes: Buffer.byteLength(html, "utf8"),
      url,
    };
  } catch (error) {
    return { ok: false, title: "读取失败", type: "architecture", html: "", bytes: 0, url: null };
  }
}

/** 扫描目录下的 .archify 目录 */
function scanDirForDiagrams(baseDir: string, workspaceDir?: string): DiagramItem[] {
  const archifyDir = path.join(baseDir, ".archify");
  if (!existsSync(archifyDir)) return [];

  const items: DiagramItem[] = [];
  try {
    const entries = readdirSync(archifyDir);
    for (const name of entries) {
      const fullDir = path.join(archifyDir, name);
      try {
        if (!statSync(fullDir).isDirectory()) continue;
        const withoutStamp = name.replace(/-\d{8}-\d{6}$/, "");
        const parts = withoutStamp.split("-");
        const type = (["architecture", "workflow", "sequence", "dataflow", "lifecycle"].includes(parts[0])
          ? parts[0]
          : "architecture") as DiagramType;
        const slug = parts.slice(1).join("-") || withoutStamp;

        let htmlPath: string | null = null;
        let htmlBytes = 0;
        let createdAt = Math.floor(statSync(fullDir).mtimeMs);

        for (const file of readdirSync(fullDir)) {
          if (file.endsWith(".html")) {
            const p = path.join(fullDir, file);
            htmlPath = p;
            htmlBytes = statSync(p).size;
            break;
          }
        }
        if (!htmlPath) continue;

        let ok = true;
        try {
          const sumFile = readdirSync(fullDir).find((f) => f.endsWith(".finalize-summary.json"));
          if (sumFile) {
            const sum = JSON.parse(readFileSync(path.join(fullDir, sumFile), "utf8")) as { ok?: boolean };
            ok = Boolean(sum.ok);
          }
        } catch {}

        items.push({
          id: `${type}-${slug}-${createdAt}`,
          type,
          slug,
          title: slug,
          dir: fullDir,
          htmlPath,
          htmlBytes,
          url: getViewerUrl(htmlPath),
          createdAt,
          ok,
          workspaceDir: workspaceDir || null,
        });
      } catch {}
    }
  } catch {}
  return items;
}

/** 台账聚合 */
export async function list(options: { root?: string; workspaceDir?: string }): Promise<ListOutput> {
  await ensureServe();
  const root = options.root || DEFAULT_ROOT;
  const workspaceDir = options.workspaceDir;

  const allItems: DiagramItem[] = [];
  const seenPaths = new Set<string>();

  // 1. 如果传了工作区目录，先扫工作区
  if (workspaceDir && existsSync(workspaceDir)) {
    for (const item of scanDirForDiagrams(workspaceDir, workspaceDir)) {
      if (item.htmlPath && !seenPaths.has(item.htmlPath)) {
        seenPaths.add(item.htmlPath);
        allItems.push(item);
      }
    }
  }

  // 2. 扫全局默认出图根
  if (existsSync(root)) {
    for (const item of scanDirForDiagrams(root)) {
      if (item.htmlPath && !seenPaths.has(item.htmlPath)) {
        seenPaths.add(item.htmlPath);
        allItems.push(item);
      }
    }
  }

  // 按生成时间倒序（最新的任务图排在最前）
  allItems.sort((a, b) => b.createdAt - a.createdAt);

  const activeUrl = allItems[0]?.url || (preview ? `http://${lanAddress()}:${preview.port}/` : null);

  const lines = [
    `扫描完成：共发现 ${allItems.length} 张图谱`,
    workspaceDir ? `工作区目录：${workspaceDir}` : "",
    `全局存储库：${root}`,
  ].filter(Boolean);

  return {
    root,
    workspaceDir: workspaceDir || null,
    items: allItems.slice(0, 50),
    activeUrl,
    scannedAt: Date.now(),
    lines,
  };
}

/* ------------------------- 图纸增删查改（路径安全校验） ------------------------- */

/** 判定某路径是否属于图鉴仓（严防越界删除/改写系统文件） */
function isInsideRoot(target: string, root = DEFAULT_ROOT): boolean {
  const resolved = path.resolve(target);
  const base = path.resolve(root);
  return resolved === base || resolved.startsWith(base + path.sep);
}

/** 把任意标题转成安全目录名（保留中文，剔除路径分隔符与控制字符） */
function safeName(raw: string): string {
  return raw
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\.\.+/g, "-")
    .trim()
    .slice(0, 80);
}

/** 删除单张图鉴（真删整个时间戳目录；仅限图鉴仓内） */
export async function deleteDiagram(input: { dir: string }): Promise<DeleteOutput> {
  const dir = input.dir?.trim() || "";
  if (!dir) {
    return { ok: false, dir, removed: [], lines: ["删除失败：目录为空"] };
  }
  if (!isInsideRoot(dir)) {
    return { ok: false, dir, removed: [], lines: ["删除被拒：目标不在图鉴仓内", `图鉴仓：${DEFAULT_ROOT}`, `目标：${dir}`] };
  }
  if (!existsSync(dir)) {
    return { ok: false, dir, removed: [], lines: ["删除失败：目录不存在", dir] };
  }
  let removed: string[] = [];
  try {
    removed = readdirSync(dir);
  } catch {
    removed = [];
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, dir, removed, lines: ["删除失败", message] };
  }
  return {
    ok: true,
    dir,
    removed,
    lines: [`已删除图鉴目录：${path.basename(dir)}`, `清理文件：${removed.length} 个`],
  };
}

/** 重命名图鉴：只改显示名（目录名 + HTML 文件名 + meta.title），不重出 */
export async function renameDiagram(input: { dir: string; newTitle: string }): Promise<RenameOutput> {
  const dir = input.dir?.trim() || "";
  const rawTitle = input.newTitle?.trim() || "";
  const newTitle = safeName(rawTitle);

  if (!dir || !newTitle) {
    return { ok: false, oldDir: dir, newDir: dir, newTitle, htmlPath: null, lines: ["重命名失败：目录或新名称为空"] };
  }
  if (!isInsideRoot(dir)) {
    return { ok: false, oldDir: dir, newDir: dir, newTitle, htmlPath: null, lines: ["重命名被拒：目标不在图鉴仓内", `图鉴仓：${DEFAULT_ROOT}`] };
  }
  if (!existsSync(dir)) {
    return { ok: false, oldDir: dir, newDir: dir, newTitle, htmlPath: null, lines: ["重命名失败：目录不存在", dir] };
  }

  // 1. 定位旧 HTML
  let oldHtmlName = "";
  try {
    oldHtmlName = readdirSync(dir).find((n) => n.endsWith(".html")) || "";
  } catch {
    oldHtmlName = "";
  }
  const oldHtmlPath = oldHtmlName ? path.join(dir, oldHtmlName) : "";

  // 2. 改 candidate.json / 质检回执里的 meta.title（仅动标题字段，不碰任何几何）
  if (oldHtmlName) {
    const stem = oldHtmlName.replace(/\.html$/, "");
    for (const name of readdirSync(dir)) {
      if (name === oldHtmlName || !name.startsWith(stem)) continue;
      if (!name.endsWith(".json")) continue;
      const p = path.join(dir, name);
      try {
        const data = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
        if (name === "candidate.json" && data.meta && typeof data.meta === "object") {
          (data.meta as Record<string, unknown>).title = newTitle;
          writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
        }
      } catch {
        /* 非 JSON 或解析失败则跳过，不影响改名 */
      }
    }
  }

  // 3. 改 HTML 内嵌标题（只替换 <title> 与 meta.title 字面量，不动图形数据）
  if (oldHtmlPath && existsSync(oldHtmlPath)) {
    try {
      let html = readFileSync(oldHtmlPath, "utf8");
      html = html.replace(/<title>[^<]*<\/title>/, `<title>${newTitle}</title>`);
      writeFileSync(oldHtmlPath, html, "utf8");
    } catch {
      /* 标题改写失败不阻断改名 */
    }
  }

  // 4. 目录名：保留原 “类型-” 前缀 + 原时间戳后缀
  const parent = path.dirname(dir);
  const base = path.basename(dir);
  const stampMatch = base.match(/-(\d{8}-\d{6})$/);
  const stampSuffix = stampMatch ? `-${stampMatch[1]}` : "";
  const typePrefixRaw = base.replace(/-\d{8}-\d{6}$/, "").split("-")[0];
  const typePrefix = /^[a-z]+$/.test(typePrefixRaw) ? `${typePrefixRaw}-` : "";
  const newBase = `${typePrefix}${newTitle}${stampSuffix}`;
  const newDir = path.join(parent, newBase);

  let finalDir = dir;
  let finalHtml = oldHtmlPath;
  if (newDir !== dir && !existsSync(newDir)) {
    try {
      const { renameSync } = await import("node:fs");
      renameSync(dir, newDir);
      finalDir = newDir;
      if (oldHtmlName) {
        const newHtml = path.join(newDir, `${newTitle}.html`);
        if (oldHtmlPath && existsSync(path.join(newDir, oldHtmlName)) && path.join(newDir, oldHtmlName) !== newHtml) {
          const { renameSync: rn2 } = await import("node:fs");
          rn2(path.join(newDir, oldHtmlName), newHtml);
        }
        finalHtml = newHtml;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, oldDir: dir, newDir: dir, newTitle, htmlPath: oldHtmlPath || null, lines: ["目录改名失败", message] };
    }
  }

  return {
    ok: true,
    oldDir: dir,
    newDir: finalDir,
    newTitle,
    htmlPath: finalHtml || null,
    lines: [`图鉴已更名为：${newTitle}`, `目录：${path.basename(finalDir)}`],
  };
}

/** ------------------------- HTTP 交互预览服务 ------------------------- */

let preview: { server: Server; port: number } | null = null;

function lanAddress(): string {
  const nets = networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

export function getViewerUrl(filePath: string): string | null {
  // 预览服务未启动时不生成连不上的 URL（旧行为会 fallback 到死端口 34509，
  // 导致客户端 iframe 一直 Connection refused → “点了没反应”）。
  if (!preview) return null;
  return `http://${lanAddress()}:${preview.port}/view?file=${encodeURIComponent(filePath)}`;
}

export async function ensureServe(): Promise<void> {
  if (preview) return;

  const server = createServer((req, res) => {
    try {
      const parsedUrl = new URL(req.url ?? "/", "http://localhost");
      const pathname = parsedUrl.pathname;

      // 直取单张图鉴
      if (pathname === "/view") {
        const targetFile = parsedUrl.searchParams.get("file");
        if (targetFile && existsSync(targetFile) && targetFile.endsWith(".html")) {
          const body = readFileSync(targetFile);
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "content-length": String(body.length),
            "access-control-allow-origin": "*",
          });
          res.end(body);
          return;
        }
        res.writeHead(404, { "content-type": "text/plain" }).end("diagram file not found");
        return;
      }

      // 默认欢迎页 / 画廊
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><meta charset="utf-8"><title>图鉴司 · Archify</title>
<body style="font:14px system-ui;background:#0b0e14;color:#e6e6e6;padding:24px">
<h2>📐 图鉴司 · Archify 渲染引擎已就绪</h2>
<p style="color:#8a8f98">可交互图谱服务运行中。</p>
</body></html>`);
    } catch (error) {
      res.writeHead(500).end(error instanceof Error ? error.message : "internal error");
    }
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  }).catch(() => 0);

  if (port) {
    preview = { server, port };
  }
}

export async function serve(root?: string, stop = false): Promise<ServeOutput> {
  if (stop) {
    if (preview) {
      const s = preview.server;
      preview = null;
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    return { running: false, url: null, port: null, root: root || DEFAULT_ROOT, lines: ["服务已停止"] };
  }

  await ensureServe();
  return {
    running: true,
    url: preview ? `http://${lanAddress()}:${preview.port}/` : null,
    port: preview?.port ?? null,
    root: root || DEFAULT_ROOT,
    lines: ["预览服务运行中", "支持前端 iframe 直载与浏览器全屏"],
  };
}

export function shutdown(): void {
  if (preview) {
    preview.server.close();
    preview = null;
  }
}
