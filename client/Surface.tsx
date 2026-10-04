/**
 * client/Surface.tsx — 侧边栏全局入口「图鉴司」。
 * 托管全局所有工作区与会话的图鉴全景。
 */
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ArchifyView } from "./ArchifyView";

export function MainSurface({ theme, layout }: PluginSurfaceProps) {
  return <ArchifyView theme={theme} layout={layout} />;
}
