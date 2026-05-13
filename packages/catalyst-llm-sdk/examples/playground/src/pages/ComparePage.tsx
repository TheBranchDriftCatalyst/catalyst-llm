/**
 * Compare tab — multi-model side-by-side benchmark surface.
 *
 * Dev-only `unloadModel` hook fires between sequential turns so each
 * model gets a clean Ollama memory slot when running local
 * comparisons. The client comes off the LLMProvider context rather
 * than being threaded through PageProps so this page stays plug-and-
 * play across consumers.
 */
import { Columns3 } from "lucide-react";
import { CompareView, useCompareStore, useLLMContext } from "@catalyst/llm-sdk";
import { unloadModel } from "@catalyst/llm-sdk/dev";
import type { PageMeta } from "./types.js";

export function ComparePage() {
  const { client } = useLLMContext();
  return (
    <main id="main-content" className="flex-1 overflow-hidden">
      <CompareView
        onTurnComplete={
          import.meta.env.DEV
            ? (modelId) => unloadModel(client, modelId)
            : undefined
        }
      />
    </main>
  );
}

export const comparePageMeta: PageMeta = {
  id: "compare",
  label: "Compare",
  icon: Columns3,
  path: "/compare",
  useStreamingIndicator: () =>
    useCompareStore((s) => Object.values(s.runs).some((r) => r.isStreaming)),
  component: ComparePage,
};
