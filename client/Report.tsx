/**
 * client/Report.tsx — 时间线行：出图回执（archify-report）。
 */
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { Image, Pressable, Text, View } from "react-native";
import type { ReportData } from "../shared/contracts";
import { TYPE_META } from "../shared/contracts";
import { ARCHIFY_ICON_URI } from "./icon";
import { openExternal } from "./web";

export function ReportRow({ theme, layout, item }: PluginTimelineItemProps<ReportData>) {
  const c = theme.colors;
  const compact = layout.compact;
  const data = item.data;
  const gates = `校验=${data.gates.validate} 交付=${data.gates.deliver} 检查=${data.gates.check} 浏览器=${data.gates.browserCheck}`;
  const typeLabel = TYPE_META[data.type]?.label ?? "图谱";

  return (
    <View style={{ padding: compact ? 10 : 12, gap: 6, borderRadius: 10, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Image
            source={{ uri: ARCHIFY_ICON_URI }}
            style={{ width: 16, height: 16, resizeMode: "contain" }}
          />
          <Text style={{ color: data.ok ? c.accent : "#ff7a7a", fontSize: 13, fontWeight: "700" }}>
            {data.title}
          </Text>
        </View>
        <Text style={{ color: c.foregroundMuted, fontSize: 10, fontFamily: "monospace" }}>
          {(data.htmlBytes / 1024).toFixed(0)} 千字节
        </Text>
      </View>

      <Text style={{ color: c.foregroundMuted, fontSize: 11, fontFamily: "monospace" }}>
        {typeLabel} · {gates}
      </Text>

      {data.htmlPath ? (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
          <Pressable
              onPress={() => copyText(data.htmlPath!)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 6,
                backgroundColor: c.surface2,
              }}
            >
              <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>⧉ 复制路径</Text>
            </Pressable>
        </View>
      ) : null}
    </View>
  );
}
