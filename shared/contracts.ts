/**
 * shared/contracts.ts — 图鉴司（archify）RPC 契约（Zod）。
 * 面向任务与代码库的可视化工作台：支持架构、工作流、时序、数据流、生命周期。
 * 产出为带有内联 SVG、交互探索与四门质检（validate/deliver/check/browser-check）的独立 HTML。
 */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** 五种图谱类型 */
export const DiagramType = z.enum([
  "architecture",
  "workflow",
  "sequence",
  "dataflow",
  "lifecycle",
]);
export type DiagramType = z.infer<typeof DiagramType>;

/** 类型中文标签与描述 */
export const TYPE_META: Record<DiagramType, { label: string; desc: string; icon: string }> = {
  architecture: { label: "系统架构", desc: "组件、边界与基础设施拓扑", icon: "Boxes" },
  workflow: { label: "任务工作流", desc: "步骤、工具调用与审批回退流程", icon: "Workflow" },
  sequence: { label: "调用时序", desc: "API 交互、缓存回源与时序链路", icon: "ArrowRightLeft" },
  dataflow: { label: "数据流图", desc: "数据管道、ETL/ELT 与血缘流转", icon: "Database" },
  lifecycle: { label: "生命周期", desc: "运行状态扭转、等待与重试终态", icon: "RotateCw" },
};

/** finalize 四门质检回执 */
export const GateReport = z.object({
  validate: z.string(),
  deliver: z.string(),
  check: z.string(),
  browserCheck: z.string(),
});
export type GateReport = z.infer<typeof GateReport>;

/** 单张图鉴条目 */
export const DiagramItem = z.object({
  id: z.string(),
  type: DiagramType,
  slug: z.string(),
  title: z.string(),
  dir: z.string(),
  htmlPath: stringOrNull(),
  htmlBytes: z.number().int(),
  url: stringOrNull(),
  createdAt: z.number().int(),
  ok: z.boolean(),
  gates: GateReport.optional(),
  workspaceDir: stringOrNull(),
});
export type DiagramItem = z.infer<typeof DiagramItem>;

function stringOrNull() {
  return z.string().nullable().optional();
}

/** 环境体检 */
export const archifyDoctor = defineRpc({
  name: "archify.doctor",
  input: z.object({}),
  output: z.object({
    ok: z.boolean(),
    nodeVersion: z.string(),
    archifyVersion: z.string(),
    chromePath: stringOrNull(),
    skillRoot: z.string(),
    defaultRoot: z.string(),
    lines: z.array(z.string()),
  }),
});
export type DoctorOutput = z.infer<typeof archifyDoctor.output>;

/** 取样例数据 */
export const archifyExample = defineRpc({
  name: "archify.example",
  input: z.object({ type: DiagramType }),
  output: z.object({
    type: DiagramType,
    name: z.string(),
    json: z.string(),
    bytes: z.number().int(),
  }),
});
export type ExampleOutput = z.infer<typeof archifyExample.output>;

/** 图鉴台账列举（优先扫当前工作区/任务的 .archify 目录） */
export const archifyList = defineRpc({
  name: "archify.list",
  input: z.object({
    root: z.string().optional(),
    workspaceDir: z.string().optional(),
  }),
  output: z.object({
    root: z.string(),
    workspaceDir: stringOrNull(),
    items: z.array(DiagramItem),
    activeUrl: stringOrNull(),
    scannedAt: z.number().int(),
    lines: z.array(z.string()),
  }),
});
export type ListOutput = z.infer<typeof archifyList.output>;

/** 读取图鉴 HTML 内容（供 iframe srcDoc 极速内嵌） */
export const archifyRead = defineRpc({
  name: "archify.read",
  input: z.object({ htmlPath: z.string() }),
  output: z.object({
    ok: z.boolean(),
    title: z.string(),
    type: DiagramType,
    html: z.string(),
    bytes: z.number().int(),
    url: stringOrNull(),
  }),
});
export type ReadOutput = z.infer<typeof archifyRead.output>;

/** 生成输出 schema（供 RPC 与前端回执校验共用）
 *  注意：zod 4 已移除运行时可访问的 `.output` 属性，故 schema 单独抽出，
 *  禁止再用 `archifyGenerate.output` 在运行时取值（会在模块顶层抛错）。 */
export const generateOutputSchema = z.object({
  ok: z.boolean(),
  title: z.string(),
  lines: z.array(z.string()),
  type: DiagramType,
  slug: z.string(),
  dir: z.string(),
  htmlPath: stringOrNull(),
  htmlBytes: z.number().int(),
  url: stringOrNull(),
  gates: GateReport,
  durationMs: z.number().int(),
  receiptPath: stringOrNull(),
  hint: stringOrNull(),
});

/** 出图（直接绘制或从当前任务绘制） */
export const archifyGenerate = defineRpc({
  name: "archify.generate",
  input: z.object({
    type: DiagramType,
    candidateJson: z.string().optional(),
    title: z.string().optional(),
    prompt: z.string().optional(),
    root: z.string().optional(),
    workspaceDir: z.string().optional(),
    quality: z.enum(["showcase", "standard"]).optional(),
    agentId: z.string().optional(),
  }),
  output: generateOutputSchema,
});
export type GenerateOutput = z.infer<typeof generateOutputSchema>;
export type GenerateInput = z.infer<typeof archifyGenerate.input>;

/** HTTP 预览服务 */
export const archifyServe = defineRpc({
  name: "archify.serve",
  input: z.object({
    root: z.string().optional(),
    stop: z.boolean().optional(),
  }),
  output: z.object({
    running: z.boolean(),
    url: stringOrNull(),
    port: z.number().int().nullable(),
    root: z.string(),
    lines: z.array(z.string()),
  }),
});
export type ServeOutput = z.infer<typeof archifyServe.output>;

/** 删除单张图鉴（真删：整个时间戳目录） */
export const archifyDeleteRpc = defineRpc({
  name: "archify.delete",
  input: z.object({ dir: z.string() }),
  output: z.object({
    ok: z.boolean(),
    dir: z.string(),
    removed: z.array(z.string()),
    lines: z.array(z.string()),
  }),
});
export type DeleteOutput = z.infer<typeof archifyDeleteRpc.output>;

/** 重命名图鉴（只改显示名：目录名 + HTML 文件名 + meta.title，不重出） */
export const archifyRenameRpc = defineRpc({
  name: "archify.rename",
  input: z.object({ dir: z.string(), newTitle: z.string() }),
  output: z.object({
    ok: z.boolean(),
    oldDir: z.string(),
    newDir: z.string(),
    newTitle: z.string(),
    htmlPath: stringOrNull(),
    lines: z.array(z.string()),
  }),
});
export type RenameOutput = z.infer<typeof archifyRenameRpc.output>;

/** 时间线回执条目 */
export const reportSchema = generateOutputSchema;
export type ReportData = GenerateOutput;
