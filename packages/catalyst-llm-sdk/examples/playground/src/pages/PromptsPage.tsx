/**
 * Prompts tab — full registry editor (list + form), backed by
 * usePromptStore which persists to localStorage.
 */
import { Wand2 } from "lucide-react";
import { PromptEditor } from "@catalyst/llm-sdk";
import type { PageMeta } from "./types.js";

export function PromptsPage() {
  return (
    <main id="main-content" className="flex-1 overflow-hidden">
      <PromptEditor />
    </main>
  );
}

export const promptsPageMeta: PageMeta = {
  id: "prompts",
  label: "Prompts",
  icon: Wand2,
  path: "/prompts",
  component: PromptsPage,
};
