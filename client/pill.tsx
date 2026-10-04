/**
 * client/pill.tsx — 输入框下方快捷气泡「[图鉴司]」。
 * 为每个活跃 Agent 注册一枚气泡，点击一键展开图鉴司任务面板。
 *
 * API 对齐 @getpaseo/plugin 0.10.3：
 *   addComposerPill({ id, workspaceId, agentId, button })
 *   button = { title, icon, label?, behavior: { kind: "action", onPress } }
 *   remove 是 registration.remove()，不是调用注册函数本身。
 */
import type { PluginClientContext, PluginButtonRegistration } from "@getpaseo/plugin/client";

export function contributePills(client: PluginClientContext) {
  const pills = new Map<string, PluginButtonRegistration>();

  function addPill(agentId: string, workspaceId: string) {
    // Agent 快照每回合都变；气泡不依赖快照，重复注册只会触发
    // "Duplicate plugin button" 并让组件重挂。
    if (pills.has(agentId)) return;
    try {
      const reg = client.addComposerPill({
        id: "archify",
        workspaceId,
        agentId,
        button: {
          title: "图鉴司",
          label: "图鉴司",
          icon: "Workflow",
          behavior: {
            kind: "action",
            onPress() {
              client.openPanel("archify-agent-panel", { workspaceId, agentId });
            },
          },
        },
      });
      pills.set(agentId, reg);
    } catch (error) {
      // 同一 id 重复注册会抛错；跳过即可，不该拖垮整个客户端入口。
      console.warn("archify: composer pill skipped", error);
    }
  }

  function removePill(agentId: string) {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  }

  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "remove") {
      removePill(update.agentId);
      return;
    }
    const { id, workspaceId } = update.agent;
    if (workspaceId) addPill(id, workspaceId);
  });

  client.paseo.agents
    .list()
    .then((result) => {
      result.entries.forEach(({ agent }) => {
        if (agent.workspaceId) addPill(agent.id, agent.workspaceId);
      });
    })
    .catch((error: unknown) => {
      console.error("archify: could not seed composer pills", error);
    });

  return () => {
    unsubscribe();
    pills.forEach((reg) => reg.remove());
    pills.clear();
  };
}
