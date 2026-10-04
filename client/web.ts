import { createElement } from "react";
import { Platform } from "react-native";

declare const window: { open(url: string, target?: string, features?: string): unknown };

export async function openExternal(url: string): Promise<void> {
  if (Platform.OS === "web") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function DiagramIframe({
  src,
  html,
  style,
}: {
  src?: string | null;
  html?: string | null;
  style?: Record<string, unknown>;
}) {
  if (Platform.OS === "web") {
    // 优先内联 HTML（srcDoc）：不依赖预览端口，跨插件进程 reload 也稳定。
    // 仅当没有内联内容时才回退到 src（在线预览 URL）。
    if (html) {
      return createElement("iframe", {
        srcDoc: html,
        style: {
          width: "100%",
          height: "100%",
          border: "none",
          borderRadius: 8,
          backgroundColor: "#0b0e14",
          ...style,
        },
        title: "图鉴司·交互式图谱阅览台",
      });
    }
    if (src) {
      return createElement("iframe", {
        src,
        style: {
          width: "100%",
          height: "100%",
          border: "none",
          borderRadius: 8,
          backgroundColor: "#0b0e14",
          ...style,
        },
        title: "图鉴司·交互式图谱阅览台",
      });
    }
  }
  return null;
}
