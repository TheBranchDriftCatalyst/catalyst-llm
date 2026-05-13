/**
 * Engine tab — agent topology canvas + the SidePanel-driven workbench
 * (Agents / Events / Test run / Node detail / Terminal rails).
 *
 * Currently re-renders the SDK's EnginePage composition; a follow-up
 * commit moves the composition into this file so the SDK only ships
 * primitives (PageShell + SidePanel + topology + rail panels) and the
 * playground assembles the page locally.
 */
import { Cpu } from "lucide-react";
import { EnginePage as SDKEnginePage } from "@catalyst/llm-sdk";
import type { PageMeta } from "./types.js";

export function EnginePage() {
  return (
    <main id="main-content" className="flex-1 overflow-hidden">
      <SDKEnginePage />
    </main>
  );
}

export const enginePageMeta: PageMeta = {
  id: "engine",
  label: "Engine",
  icon: Cpu,
  path: "/engine",
  component: EnginePage,
};
