/**
 * client/ArchifyView.tsx — 图鉴司主视图组件。
 * 完整复刻 https://github.com/tt-a1i/archify 的交互体验：
 * 1. 核心舞台直接内嵌交互式 Archify 渲染引擎（iframe/HTML 零延迟渲染），支持节点检查、路由拓扑、深浅主题切换、导出。
 * 2. 任务图鉴无缝轮转：自动扫描并列出工作区/任务产生的全部图鉴。
 * 3. 一键任务出图抽屉：为当前任务快速规划架构、工作流、时序或生命周期。
 * 4. 纯 React Native 原语，全平台自适应。
 */
import { useRpc } from "@getpaseo/plugin/client";
import { copyText, useToast, type ToastVariant } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  TYPE_META,
  archifyDeleteRpc,
  archifyGenerate,
  archifyList,
  archifyRead,
  archifyRenameRpc,
  archifyServe,
  type DiagramItem,
  type DiagramType,
} from "../shared/contracts";
import { ARCHIFY_ICON_URI } from "./icon";
import { DiagramIframe, openExternal } from "./web";

const TYPES: DiagramType[] = ["architecture", "workflow", "sequence", "dataflow", "lifecycle"];

export interface ArchifyViewProps {
  theme: PluginTheme;
  layout: { compact: boolean };
  workspaceDir?: string | null;
  agentId?: string | null;
}

export function ArchifyView({ theme, layout, workspaceDir, agentId }: ArchifyViewProps) {
  const c = theme.colors;
  const compact = layout.compact;
  const toast = useToast();
  const notify = (message: string, variant: ToastVariant = "info") => toast.show(message, { variant });

  const rpcList = useRpc(archifyList);
  const rpcRead = useRpc(archifyRead);
  const rpcGenerate = useRpc(archifyGenerate);
  const rpcServe = useRpc(archifyServe);
  const rpcDelete = useRpc(archifyDeleteRpc);
  const rpcRename = useRpc(archifyRenameRpc);

  const [items, setItems] = useState<DiagramItem[]>([]);
  const [activeItem, setActiveItem] = useState<DiagramItem | null>(null);
  const [activeHtml, setActiveHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 任务出图抽屉状态
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [taskType, setTaskType] = useState<DiagramType>("workflow");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPrompt, setTaskPrompt] = useState("");
  const [generating, setGenerating] = useState(false);

  // 图纸管理台状态
  const [showManager, setShowManager] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DiagramItem | null>(null);
  const [renameText, setRenameText] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DiagramItem | null>(null);
  const [busy, setBusy] = useState(false);

  // 查找（搜索 / 筛选 / 排序）
  const [searchText, setSearchText] = useState("");
  const [filterType, setFilterType] = useState<DiagramType | "all">("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

  /** 按关键字 / 类型 / 时间过滤后的图纸清单 */
  const filteredItems = useMemo(() => {
    const kw = searchText.trim().toLowerCase();
    const list = items.filter((it) => {
      if (filterType !== "all" && it.type !== filterType) return false;
      if (!kw) return true;
      const haystack = `${it.title} ${TYPE_META[it.type].label} ${it.slug}`.toLowerCase();
      return haystack.includes(kw);
    });
    return sortOrder === "newest"
      ? [...list].sort((a, b) => b.createdAt - a.createdAt)
      : [...list].sort((a, b) => a.createdAt - b.createdAt);
  }, [items, searchText, filterType, sortOrder]);

  // 刷新并载入台账
  async function reloadList(preferId?: string) {
    setLoading(true);
    try {
      const res = await rpcList({ workspaceDir: workspaceDir || undefined });
      setItems(res.items);
      if (res.items.length > 0) {
        const target = preferId
          ? res.items.find((x) => x.id === preferId) || res.items[0]
          : activeItem
            ? res.items.find((x) => x.id === activeItem.id) || res.items[0]
            : res.items[0];
        if (target) {
          await loadDiagram(target);
        }
      } else {
        setActiveItem(null);
        setActiveHtml(null);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "获取图鉴列表失败", "error");
    } finally {
      setLoading(false);
    }
  }

  // 载入特定图鉴内容
  async function loadDiagram(item: DiagramItem) {
    setActiveItem(item);
    if (!item.htmlPath) {
      setActiveHtml(null);
      return;
    }
    try {
      const readRes = await rpcRead({ htmlPath: item.htmlPath });
      if (readRes.ok) {
        setActiveHtml(readRes.html);
      }
    } catch {
      // 读文件失败则由 iframe src 兜底加载
    }
  }

  useEffect(() => {
    void reloadList();
    void rpcServe({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceDir]);

  // 执行任务出图
  async function onGenerate() {
    setGenerating(true);
    try {
      const title = taskTitle.trim() || `${TYPE_META[taskType].label}任务`;
      const res = await rpcGenerate({
        type: taskType,
        title,
        prompt: taskPrompt.trim() || undefined,
        workspaceDir: workspaceDir || undefined,
        agentId: agentId || undefined,
      });

      if (res.ok) {
        notify("四门质检通过，图鉴已生成！", "success");
        setDrawerOpen(false);
        setTaskTitle("");
        setTaskPrompt("");
        await reloadList(res.slug);
      } else {
        notify(`出图未过门禁：${res.lines[0] || "请检查输入"}`, "error");
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "生成失败", "error");
    } finally {
      setGenerating(false);
    }
  }

  // 全屏浏览器标签页打开
  async function onOpenExternal() {
    if (!activeItem?.url) {
      notify("该图暂无在线预览直链", "info");
      return;
    }
    await openExternal(activeItem.url);
  }

  // 发起改名（打开弹窗）
  function onRenameStart(item: DiagramItem) {
    setRenameTarget(item);
    setRenameText(item.title);
  }

  // 确认改名（只改显示名）
  async function onRenameConfirm() {
    if (!renameTarget) return;
    const next = renameText.trim();
    if (!next || next === renameTarget.title) {
      setRenameTarget(null);
      return;
    }
    setBusy(true);
    try {
      const res = await rpcRename({ dir: renameTarget.dir, newTitle: next });
      if (res.ok) {
        notify(`已更名为：${res.newTitle}`, "success");
        setRenameTarget(null);
        await reloadList();
      } else {
        notify(res.lines[0] || "改名失败", "error");
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "改名失败", "error");
    } finally {
      setBusy(false);
    }
  }

  // 确认删除（真删）
  async function onDeleteConfirm() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const res = await rpcDelete({ dir: deleteTarget.dir });
      if (res.ok) {
        notify(`已删除：${deleteTarget.title}`, "success");
        const wasActive = activeItem?.id === deleteTarget.id;
        setDeleteTarget(null);
        if (wasActive) {
          setActiveItem(null);
          setActiveHtml(null);
        }
        await reloadList();
      } else {
        notify(res.lines[0] || "删除失败", "error");
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "删除失败", "error");
    } finally {
      setBusy(false);
    }
  }

  // 复制路径
  async function onCopyPath() {
    if (activeItem?.htmlPath) {
      await copyText(activeItem.htmlPath);
      notify("图鉴产物绝对路径已复制", "success");
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.surface0, padding: compact ? 8 : 12, gap: 8 }}>
      {/* ── 顶部导航控制条 ── */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingBottom: 6,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Image
            source={{ uri: ARCHIFY_ICON_URI }}
            style={{ width: compact ? 18 : 20, height: compact ? 18 : 20, resizeMode: "contain" }}
          />
          <Text style={{ color: c.foreground, fontSize: compact ? 15 : 17, fontWeight: "700" }}>
            图鉴司
          </Text>
          <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>
            {activeItem ? `${TYPE_META[activeItem.type].label} · ${activeItem.title}` : "图鉴阅览台"}
          </Text>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="任务绘图"
            onPress={() => setDrawerOpen((v) => !v)}
            style={{
              paddingHorizontal: compact ? 8 : 12,
              paddingVertical: 5,
              borderRadius: 8,
              backgroundColor: drawerOpen ? c.surface2 : c.accent,
            }}
          >
            <Text
              style={{
                color: drawerOpen ? c.foreground : c.accentForeground ?? "#0b0e14",
                fontSize: 11,
                fontWeight: "600",
              }}
            >
              {drawerOpen ? "收起" : "✨ 任务出图"}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="刷新图谱"
            onPress={() => reloadList()}
            style={{
              paddingHorizontal: compact ? 8 : 10,
              paddingVertical: 5,
              borderRadius: 8,
              backgroundColor: c.surface1,
            }}
          >
            <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>↻ 刷新</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="图纸管理台"
            onPress={() => setShowManager((v) => !v)}
            style={{
              paddingHorizontal: compact ? 8 : 10,
              paddingVertical: 5,
              borderRadius: 8,
              backgroundColor: showManager ? c.surface2 : c.surface1,
            }}
          >
            <Text style={{ color: showManager ? c.foreground : c.foregroundMuted, fontSize: 11 }}>
              ⚙ 图纸管理 ({items.length})
            </Text>
          </Pressable>
        </View>
      </View>

      {/* ── 图纸管理台：增删查改 ── */}
      {showManager ? (
        <View
          style={{
            maxHeight: 220,
            padding: 10,
            borderRadius: 10,
            backgroundColor: c.surface1,
            borderWidth: 1,
            borderColor: c.border,
            gap: 6,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: c.foreground, fontSize: 12, fontWeight: "600" }}>
              ⚙ 图纸管理台 · 共 {items.length} 张
            </Text>
            <Text style={{ color: c.foregroundMuted, fontSize: 10 }}>点标题查看 · 改名 / 删除</Text>
          </View>

          {/* 查找工具条：关键字 / 类型 / 排序 */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder="🔍 搜索标题或类型…"
              placeholderTextColor={c.foregroundMuted}
              style={{
                flex: 1,
                paddingHorizontal: 8,
                paddingVertical: 5,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: c.border,
                color: c.foreground,
                fontSize: 11,
                backgroundColor: c.surface0,
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="排序切换"
              onPress={() => setSortOrder((v) => (v === "newest" ? "oldest" : "newest"))}
              style={{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: c.surface2 }}
            >
              <Text style={{ color: c.foregroundMuted, fontSize: 10 }}>
                {sortOrder === "newest" ? "↓ 最新" : "↑ 最早"}
              </Text>
            </Pressable>
          </View>

          {/* 类型筛选芯片 */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
            <Pressable
              onPress={() => setFilterType("all")}
              style={{
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 999,
                backgroundColor: filterType === "all" ? c.accent : c.surface0,
              }}
            >
              <Text style={{ color: filterType === "all" ? c.accentForeground ?? "#0b0e14" : c.foregroundMuted, fontSize: 10 }}>
                全部
              </Text>
            </Pressable>
            {TYPES.map((t) => {
              const active = filterType === t;
              return (
                <Pressable
                  key={t}
                  onPress={() => setFilterType(active ? "all" : t)}
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 999,
                    backgroundColor: active ? c.accent : c.surface0,
                  }}
                >
                  <Text style={{ color: active ? c.accentForeground ?? "#0b0e14" : c.foregroundMuted, fontSize: 10 }}>
                    {TYPE_META[t].label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {(searchText.trim() || filterType !== "all") && (
            <Text style={{ color: c.foregroundMuted, fontSize: 10 }}>
              筛选结果：{filteredItems.length} / {items.length} 张
              {searchText.trim() ? ` · 关键字「${searchText.trim()}」` : ""}
            </Text>
          )}

          {items.length === 0 ? (
            <Text style={{ color: c.foregroundMuted, fontSize: 11, paddingVertical: 8 }}>
              尚无图纸，点「✨ 任务出图」生成首张。
            </Text>
          ) : filteredItems.length === 0 ? (
            <Text style={{ color: c.foregroundMuted, fontSize: 11, paddingVertical: 8 }}>
              没有匹配的图纸，换个关键字或清除筛选。
            </Text>
          ) : (
            <ScrollView style={{ maxHeight: 160 }} contentContainerStyle={{ gap: 4 }}>
              {filteredItems.map((item) => {
                const isSelected = activeItem?.id === item.id;
                return (
                  <View
                    key={item.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      paddingHorizontal: 8,
                      paddingVertical: 5,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: isSelected ? c.accent : c.border,
                      backgroundColor: isSelected ? `${c.accent}18` : c.surface0,
                    }}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={item.title}
                      onPress={() => loadDiagram(item)}
                      style={{ flex: 1 }}
                    >
                      <Text
                        numberOfLines={1}
                        style={{
                          color: isSelected ? c.accent : c.foreground,
                          fontSize: 11,
                          fontWeight: isSelected ? "600" : "400",
                        }}
                      >
                        {TYPE_META[item.type].label} · {item.title}
                      </Text>
                      <Text style={{ color: c.foregroundMuted, fontSize: 9 }}>
                        {(item.htmlBytes / 1024).toFixed(0)} KB · {item.ok ? "四门 PASS" : "未过门禁"}
                      </Text>
                    </Pressable>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`重命名 ${item.title}`}
                      onPress={() => onRenameStart(item)}
                      style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: c.surface2 }}
                    >
                      <Text style={{ color: c.foregroundMuted, fontSize: 10 }}>✎ 改名</Text>
                    </Pressable>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`删除 ${item.title}`}
                      onPress={() => setDeleteTarget(item)}
                      style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: `${c.statusDanger}22` }}
                    >
                      <Text style={{ color: c.statusDanger, fontSize: 10 }}>🗑 删除</Text>
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      ) : null}

      {/* ── 改名弹窗 ── */}
      {renameTarget ? (
        <View
          style={{
            padding: 12,
            borderRadius: 10,
            backgroundColor: c.surface1,
            borderWidth: 1,
            borderColor: c.accent,
            gap: 8,
          }}
        >
          <Text style={{ color: c.foreground, fontSize: 12, fontWeight: "600" }}>✎ 重命名图纸</Text>
          <Text style={{ color: c.foregroundMuted, fontSize: 10 }}>
            原名称：{renameTarget.title}（仅改显示名，图形内容不变）
          </Text>
          <TextInput
            value={renameText}
            onChangeText={setRenameText}
            placeholder="输入新名称"
            placeholderTextColor={c.foregroundMuted}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: c.border,
              color: c.foreground,
              fontSize: 12,
              backgroundColor: c.surface0,
            }}
          />
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            <Pressable
              onPress={() => setRenameTarget(null)}
              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
            >
              <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>取消</Text>
            </Pressable>
            <Pressable
              onPress={onRenameConfirm}
              disabled={busy}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 6,
                borderRadius: 8,
                backgroundColor: c.accent,
                opacity: busy ? 0.6 : 1,
              }}
            >
              <Text style={{ color: c.accentForeground ?? "#0b0e14", fontSize: 11, fontWeight: "600" }}>
                {busy ? "更名中…" : "确认改名"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* ── 删除二次确认弹窗 ── */}
      {deleteTarget ? (
        <View
          style={{
            padding: 12,
            borderRadius: 10,
            backgroundColor: `${c.statusDanger}14`,
            borderWidth: 1,
            borderColor: c.statusDanger,
            gap: 8,
          }}
        >
          <Text style={{ color: c.statusDanger, fontSize: 12, fontWeight: "700" }}>
            ⚠ 确认删除图纸？此操作不可撤销
          </Text>
          <Text style={{ color: c.foreground, fontSize: 11 }}>
            {TYPE_META[deleteTarget.type].label} · {deleteTarget.title}
          </Text>
          <Text style={{ color: c.foregroundMuted, fontSize: 10 }}>将永久删除以下目录及其全部产物：</Text>
          <Text style={{ color: c.foregroundMuted, fontSize: 9, fontFamily: "monospace" }} numberOfLines={2}>
            {deleteTarget.dir}
          </Text>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            <Pressable
              onPress={() => setDeleteTarget(null)}
              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
            >
              <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>取消</Text>
            </Pressable>
            <Pressable
              onPress={onDeleteConfirm}
              disabled={busy}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 6,
                borderRadius: 8,
                backgroundColor: c.statusDanger,
                opacity: busy ? 0.6 : 1,
              }}
            >
              <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>
                {busy ? "删除中…" : "确认删除"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* ── 任务出图抽屉面板 ── */}
      {drawerOpen ? (
        <View
          style={{
            padding: 12,
            borderRadius: 10,
            backgroundColor: c.surface1,
            borderWidth: 1,
            borderColor: c.border,
            gap: 8,
          }}
        >
          <Text style={{ color: c.foreground, fontSize: 12, fontWeight: "600" }}>
            ✨ 为当前任务规划可视化图鉴
          </Text>

          {/* 类型选型 */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {TYPES.map((t) => {
              const active = t === taskType;
              return (
                <Pressable
                  key={t}
                  onPress={() => setTaskType(t)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 999,
                    backgroundColor: active ? c.accent : c.surface0,
                  }}
                >
                  <Text
                    style={{
                      color: active ? c.accentForeground ?? "#0b0e14" : c.foregroundMuted,
                      fontSize: 11,
                    }}
                  >
                    {TYPE_META[t].label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            value={taskTitle}
            onChangeText={setTaskTitle}
            placeholder={`图谱名称（如：${TYPE_META[taskType].label}流程）`}
            placeholderTextColor={c.foregroundMuted}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: c.border,
              color: c.foreground,
              fontSize: 11,
              backgroundColor: c.surface0,
            }}
          />

          <TextInput
            value={taskPrompt}
            onChangeText={setTaskPrompt}
            placeholder="描述任务步骤、工具调用或系统交互（留空则基于内置规范结构化绘制）..."
            placeholderTextColor={c.foregroundMuted}
            multiline
            style={{
              minHeight: 50,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: c.border,
              color: c.foreground,
              fontSize: 11,
              backgroundColor: c.surface0,
            }}
          />

          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            <Pressable
              onPress={() => setDrawerOpen(false)}
              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
            >
              <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>取消</Text>
            </Pressable>
            <Pressable
              onPress={onGenerate}
              disabled={generating}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 6,
                borderRadius: 8,
                backgroundColor: c.accent,
                opacity: generating ? 0.6 : 1,
              }}
            >
              <Text style={{ color: c.accentForeground ?? "#0b0e14", fontSize: 11, fontWeight: "600" }}>
                {generating ? "四门质检出图中…" : "◉ 绘制并上屏展示"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* ── 核心主舞台：Archify 交互式大图直接渲染 ── */}
      <View
        style={{
          flex: 1,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: c.border,
          overflow: "hidden",
          backgroundColor: "#0b0e14",
        }}
      >
        {activeItem ? (
          <DiagramIframe src={activeItem.url} html={activeHtml} />
        ) : (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              gap: 12,
            }}
          >
            <Image
              source={{ uri: ARCHIFY_ICON_URI }}
              style={{ width: 56, height: 50, resizeMode: "contain" }}
            />
            <Text style={{ color: c.foreground, fontSize: 16, fontWeight: "700" }}>
              图鉴司 · 交互式全景画布
            </Text>
            <Text style={{ color: c.foregroundMuted, fontSize: 12, textAlign: "center", maxWidth: 360, lineHeight: 18 }}>
              把你想理解、规划或分享的任务与系统，变成可以互动的可视化作品。点击上方「✨ 任务出图」或向 Agent 发送出图指令，即可在此处交互探索。
            </Text>
            <Pressable
              onPress={() => setDrawerOpen(true)}
              style={{
                marginTop: 6,
                paddingHorizontal: 18,
                paddingVertical: 9,
                borderRadius: 999,
                backgroundColor: c.accent,
              }}
            >
              <Text style={{ color: c.accentForeground ?? "#0b0e14", fontSize: 12, fontWeight: "600" }}>
                ＋ 为当前任务生成首张图谱
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* ── 底部图鉴状态与质检简报 ── */}
      {activeItem ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 4,
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: c.accent, fontSize: 10, fontFamily: "monospace" }}>
              四门质检：{activeItem.ok ? "PASS" : "BLOCK"}
            </Text>
            <Text style={{ color: c.foregroundMuted, fontSize: 10, fontFamily: "monospace" }}>
              {(activeItem.htmlBytes / 1024).toFixed(0)} KB
            </Text>
          </View>

          <Pressable onPress={onCopyPath}>
            <Text style={{ color: c.foregroundMuted, fontSize: 10 }}>⧉ 复制产物路径</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
