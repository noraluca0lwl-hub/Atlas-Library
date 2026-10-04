import {
  type PluginWorkspacePanelProps,
  type PluginAgentPanelProps,
  useWorkspace,
  useAgent,
  useRpc,
} from "@getpaseo/plugin/client";
import { View, Text } from "react-native";

export function TestWorkspacePanel({ workspaceId }: PluginWorkspacePanelProps) {
  const dir = useWorkspace(workspaceId, (w) => w.directory);
  return (
    <View>
      <Text>{dir}</Text>
    </View>
  );
}

export function TestAgentPanel({ agentId }: PluginAgentPanelProps) {
  const cwd = useAgent(agentId, (a) => a.cwd);
  return (
    <View>
      <Text>{cwd}</Text>
    </View>
  );
}
