/**
 * Visual constants — palette, icons, and labels shared by every node
 * component in the topology canvas. Keeping them in their own file so
 * the design ownership is obvious: tweak a tone here, every card
 * picks it up consistently.
 */
import { Activity, CircleDot, Flag, Wrench } from "lucide-react";
import type { AgentTopologyNode, GroupType } from "../../../../agent/events.js";

// Group-container visual styling. Keeps tone parity with NODE_VISUAL
// below so the canvas reads as one palette.
export const GROUP_VISUAL: Record<
  GroupType,
  { label: string; border: string; bg: string; text: string }
> = {
  actor_critic_loop: {
    label: "actor-critic loop",
    // dashed border conveys "this is the feedback loop region"; the
    // primary/violet tint reads as the LLM-driven part of the graph.
    border: "border-violet-400/60",
    bg: "bg-violet-500/[0.06]",
    text: "text-violet-200",
  },
  ensemble: {
    label: "ensemble",
    border: "border-amber-400/60",
    bg: "bg-amber-500/[0.06]",
    text: "text-amber-200",
  },
};

// Per-type icon + visual tone. Tones colour the card border + a faint
// background tint; the existing dagre view used the same palette so
// the swap is visually continuous.
export const NODE_VISUAL: Record<
  AgentTopologyNode["type"],
  { icon: typeof Activity; label: string; tone: string }
> = {
  start: {
    icon: Flag,
    label: "start",
    tone: "border-emerald-500/50 bg-emerald-500/10 text-emerald-200",
  },
  end: {
    icon: CircleDot,
    label: "end",
    tone: "border-rose-500/50 bg-rose-500/10 text-rose-200",
  },
  agent: {
    icon: Activity,
    label: "agent",
    tone: "border-primary/50 bg-primary/10 text-primary",
  },
  tools: {
    icon: Wrench,
    label: "tools",
    tone: "border-amber-500/50 bg-amber-500/10 text-amber-200",
  },
};
