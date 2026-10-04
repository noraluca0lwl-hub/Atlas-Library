/**
 * client/Panel.tsx — 任务工作区面板「图鉴司」。
 * 与 Agent 对话并列（与 Terminals / Files / Diff 同列）。
 * 每次做任务时，自动锁定当前工作区 / Agent 的 .archify 图谱并在面板中呈现。
 */
import {
  type PluginWorkspacePanelProps,
  type PluginAgentPanelProps,
  useWorkspace,
  useAgent,
} from "@getpaseo/plugin/client";
import { ArchifyView } from "./ArchifyView";

export function WorkspaceArchifyPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const dir = useWorkspace(workspaceId, (w) => w.directory);
  return <ArchifyView theme={theme} layout={layout} workspaceDir={dir} />;
}

export function AgentArchifyPanel({ theme, layout, workspaceId, agentId }: PluginAgentPanelProps) {
  const cwd = useAgent(agentId, (a) => a.cwd);
  const dir = useWorkspace(workspaceId, (w) => w.directory);
  return <ArchifyView theme={theme} layout={layout} workspaceDir={cwd || dir} agentId={agentId} />;
}
