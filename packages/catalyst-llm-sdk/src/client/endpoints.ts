import type { EndpointInfo, EndpointType } from "./types.js";

const MAC_LAN_HINTS = ["192.168.", "10.0.", "mac-node"];
const CLUSTER_HINTS = ["cluster.local", "talos", ".svc"];
const LOCAL_HINTS = ["localhost", "127.0.0.1"];

const CLOUD_LABELS: Array<[string, string]> = [
  ["openai.com", "OpenAI"],
  ["anthropic.com", "Anthropic"],
  ["googleapis.com", "Google"],
  ["runpod.ai", "RunPod"],
  ["runpod.net", "RunPod"],
];

export function getEndpointInfo(apiBase?: string): EndpointInfo {
  if (!apiBase) {
    return { label: "Cloud", type: "cloud" };
  }

  const lower = apiBase.toLowerCase();

  for (const hint of LOCAL_HINTS) {
    if (lower.includes(hint)) {
      return { label: "Local", type: "mac", apiBase };
    }
  }

  for (const hint of MAC_LAN_HINTS) {
    if (lower.includes(hint)) {
      return { label: "Mac (LAN)", type: "mac", apiBase };
    }
  }

  for (const hint of CLUSTER_HINTS) {
    if (lower.includes(hint)) {
      return { label: "Cluster", type: "cluster", apiBase };
    }
  }

  for (const [needle, label] of CLOUD_LABELS) {
    if (lower.includes(needle)) {
      return { label, type: "cloud", apiBase };
    }
  }

  const host = apiBase.replace(/^https?:\/\//, "").split("/")[0];
  return { label: host, type: "cluster" as EndpointType, apiBase };
}
