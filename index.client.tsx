/**
 * index.client.tsx — 图鉴司客席入口。
 * 贡献：
 * 1. 侧边栏全局大厅（Sidebar Item + Surface）。
 * 2. 任务工作区侧栏面板（Workspace Panel）：与 Agent 对话同列，任务图鉴即时呈现。
 * 3. 命令中心（Command Center Item）：⌘K 搜索直达。
 * 4. 斜杠命令（/archify）：快速为当前任务生成图鉴并展开。
 * 5. 时间线回显卡片（Timeline Renderer）：出图即刻在对话流中展示。
 */
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { archifyGenerate, reportSchema, type DiagramType } from "./shared/contracts";
import { MainSurface } from "./client/Surface";
import { WorkspaceArchifyPanel, AgentArchifyPanel } from "./client/Panel";
import { ReportRow } from "./client/Report";
import { contributePills } from "./client/pill";

export default function contribute(client: PluginClientContext) {
  const cleanups: Array<() => void> = [];

  // 每个贡献点独立兜底：一处 API 不匹配不该让整个客户端入口崩掉，
  // 否则表现为「侧边栏点了没反应」。
  function safe<T>(label: string, run: () => T): T | undefined {
    try {
      return run();
    } catch (error) {
      console.error(`archify: contribution failed: ${label}`, error);
      return undefined;
    }
  }

  // 1. 时间线回执渲染器
  safe("timelineRenderer", () =>
    client.addTimelineRenderer({
      kind: "archify-report",
      version: 1,
      schema: reportSchema,
      Component: ReportRow,
    }),
  );

  // 2. 侧边栏全局入口（左侧栏）
  safe("surface", () => client.addSurface("main", MainSurface));
  safe("sidebarItem", () =>
    client.addSidebarItem({
      id: "archify",
      title: "图鉴司",
      icon: "Workflow",
      surface: "main",
    }),
  );

  // 3. 工作区任务面板（与对话/文件/终端同列标签）
  safe("workspacePanel", () =>
    client.addWorkspacePanel({
      id: "archify-panel",
      title: "图鉴司",
      icon: "Workflow",
      context: "workspace",
      locations: ["workspace", "explorer"],
      Component: WorkspaceArchifyPanel,
    }),
  );

  safe("agentPanel", () =>
    client.addWorkspacePanel({
      id: "archify-agent-panel",
      title: "任务图鉴",
      icon: "Workflow",
      context: "agent",
      Component: AgentArchifyPanel,
    }),
  );

  // 4. 命令中心快捷项
  safe("commandCenter.global", () =>
    client.addCommandCenterItem({
      id: "archify-open-global",
      title: "图鉴司：查看系统与任务图谱",
      icon: "Workflow",
      keywords: ["archify", "diagram", "图鉴", "架构图", "工作流", "时序图"],
      context: "global",
      onSelect({ openSurface }) {
        openSurface("main");
      },
    }),
  );

  safe("commandCenter.workspace", () =>
    client.addCommandCenterItem({
      id: "archify-open-workspace",
      title: "图鉴司：当前工作区图谱",
      icon: "Workflow",
      keywords: ["archify", "diagram", "图鉴", "架构图", "工作流"],
      context: "workspace",
      onSelect({ openPanel }) {
        openPanel("archify-panel");
      },
    }),
  );

  // 5. 快捷斜杠命令 /archify [类型] [描述]
  safe("slashCommand", () =>
    client.addSlashCommand({
      name: "archify",
      description: "为当前任务生成图鉴，并在图鉴司面板直接显示",
      argumentHint: "[架构|流程|时序|数据流|生命周期] [任务描述]",
      context: "workspace",
      async onSubmit({ args, rpc, openPanel }) {
        const parts = args.trim().split(/\s+/).filter(Boolean);
        const first = (parts[0] ?? "").toLowerCase();
        // 中文类型词 → 内部类型；也兼容直接写英文类型值
        const CN_TYPE: Record<string, DiagramType> = {
          架构: "architecture",
          架构图: "architecture",
          系统架构: "architecture",
          流程: "workflow",
          工作流: "workflow",
          时序: "sequence",
          调用时序: "sequence",
          数据流: "dataflow",
          数据流图: "dataflow",
          生命周期: "lifecycle",
        };
        const validTypes: DiagramType[] = [
          "architecture",
          "workflow",
          "sequence",
          "dataflow",
          "lifecycle",
        ];
        const mapped = CN_TYPE[parts[0] ?? ""] ?? (validTypes.includes(first as DiagramType) ? (first as DiagramType) : null);
        const type: DiagramType = mapped ?? "workflow";
        const prompt = mapped
          ? parts.slice(1).join(" ")
          : args.trim();

        await rpc(archifyGenerate, {
          type,
          title: prompt ? `任务 · ${prompt.slice(0, 20)}` : undefined,
          prompt: prompt || undefined,
        });

        openPanel("archify-panel");
      },
    }),
  );

  // 6. 输入框气泡
  safe("composerPill", () => cleanups.push(contributePills(client)));

  return () => {
    cleanups.forEach((fn) => {
      try {
        fn();
      } catch (error) {
        console.error("archify: cleanup failed", error);
      }
    });
  };
}
