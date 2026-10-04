/**
 * index.server.ts — 图鉴司服务端主入口。
 * 包含：
 * 1. 六路 RPC 注册（doctor, example, list, read, generate, serve）。
 * 2. 智能体任务监听生命周期（agent.turn_ended）：当 Agent 在工作区中完成任务并产出 .archify 图谱时，
 *    自动捕获最新图谱，并推入时间线卡片。
 */
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  archifyDeleteRpc,
  archifyDoctor,
  archifyExample,
  archifyGenerate,
  archifyList,
  archifyRead,
  archifyRenameRpc,
  archifyServe,
} from "./shared/contracts";

async function backend() {
  return import("./server/archify-backend");
}

export default function contribute(server: PluginServerContext) {
  server.handle(archifyDoctor, async () => {
    const { doctor } = await backend();
    return doctor();
  });

  server.handle(archifyExample, async (input) => {
    const { example } = await backend();
    return example(input.type);
  });

  server.handle(archifyList, async (input) => {
    const { list } = await backend();
    return list(input);
  });

  server.handle(archifyRead, async (input) => {
    const { readDiagram } = await backend();
    return readDiagram(input.htmlPath);
  });

  server.handle(archifyGenerate, async (input, { paseo }) => {
    const { generate } = await backend();
    const out = await generate(input);
    if (input.agentId && out.ok) {
      try {
        await paseo.agents.ref(input.agentId).timeline.append({
          type: "plugin",
          id: `archify-report-${Date.now()}`,
          kind: "archify-report",
          version: 1,
          data: out,
        });
      } catch {}
    }
    return out;
  });

  server.handle(archifyServe, async (input) => {
    const { serve } = await backend();
    return serve(input.root, input.stop ?? false);
  });

  server.handle(archifyDeleteRpc, async (input) => {
    const { deleteDiagram } = await backend();
    return deleteDiagram(input);
  });

  server.handle(archifyRenameRpc, async (input) => {
    const { renameDiagram } = await backend();
    return renameDiagram(input);
  });

  // 监听智能体每次任务回合结束：若工作区有新图谱产出，自动捕获并在时间线回显
  server.on("agent.turn_ended", async (event, { paseo }) => {
    try {
      const { list, getViewerUrl } = await backend();
      const cwd = event.agent.cwd;
      const res = await list({ workspaceDir: cwd });
      const newest = res.items[0];
      // 检查最新图谱是否是最近 30 秒内生成的
      if (newest && newest.htmlPath && Date.now() - newest.createdAt < 30000) {
        await paseo.agents.ref(event.agent.id).timeline.append({
          type: "plugin",
          id: `archify-task-${newest.id}`,
          kind: "archify-report",
          version: 1,
          data: {
            ok: newest.ok,
            title: `任务产出 · ${newest.title}`,
            lines: [
              `类型：${newest.type}`,
              `文件：${newest.htmlPath}`,
              `大小：${(newest.htmlBytes / 1024).toFixed(1)} KB`,
            ],
            type: newest.type,
            slug: newest.slug,
            dir: newest.dir,
            htmlPath: newest.htmlPath,
            htmlBytes: newest.htmlBytes,
            url: getViewerUrl(newest.htmlPath),
            gates: newest.gates || { validate: "pass", deliver: "pass", check: "pass", browserCheck: "pass" },
            durationMs: 0,
            receiptPath: null,
            hint: null,
          },
        });
      }
    } catch {}
  });

  return () => {
    void backend()
      .then(({ shutdown }) => shutdown())
      .catch(() => {});
  };
}
