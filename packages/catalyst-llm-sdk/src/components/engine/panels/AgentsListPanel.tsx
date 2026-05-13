import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import { Bot, RefreshCw, Wrench } from "lucide-react";
import type { AgentDescriptor } from "../../../agent/events.js";
import { useEngineStore } from "../../../react/engineStore.js";
import { SidePanelItem } from "../../page-shell/SidePanelItem.js";
import { cn } from "../../utils.js";

export interface AgentsListPanelProps {
  agents: AgentDescriptor[];
  loading: boolean;
  error: string | null;
  selectedId: string | undefined;
  onSelect: (agentId: string) => void;
  onRefresh: () => void;
}

AgentsListPanel.itemId = "engine.agents";

export function AgentsListPanel({
  agents,
  loading,
  error,
  selectedId,
  onSelect,
  onRefresh,
}: AgentsListPanelProps) {
  return (
    <SidePanelItem
      id="engine.agents"
      title="Agents"
      icon={<Bot className="h-3 w-3" />}
      headerRight={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onRefresh();
          }}
          title="Refresh /api/agents"
          className="h-5 w-5 p-0"
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
        </Button>
      }
    >
      <div className="space-y-1 p-1">
        {error && (
          <div
            role="alert"
            className="rounded border border-destructive/30 bg-destructive/10 p-1.5 text-xs text-destructive"
          >
            Failed to load agents: {error}
          </div>
        )}
        {loading && agents.length === 0 ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : agents.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            No agents registered. Configure VITE_AGENT_URL and start
            catalyst-langgraph.
          </div>
        ) : (
          agents.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              active={selectedId === a.id}
              onClick={() => onSelect(a.id)}
            />
          ))
        )}
      </div>
    </SidePanelItem>
  );
}

function countAgentOverrides(
  agentCfg: Record<string, Record<string, unknown>> | undefined,
): number {
  if (!agentCfg) return 0;
  let n = 0;
  for (const nodeCfg of Object.values(agentCfg)) {
    if (nodeCfg) n += Object.keys(nodeCfg).length;
  }
  return n;
}

function AgentCard({
  agent,
  active,
  onClick,
}: {
  agent: AgentDescriptor;
  active: boolean;
  onClick: () => void;
}) {
  const agentCfg = useEngineStore((s) => s.configs[agent.id]);
  const overrideCount = countAgentOverrides(agentCfg);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-md border bg-card/50 p-1.5 transition-colors",
        active
          ? "border-primary/60 bg-primary/5 shadow-sm"
          : "border-border/60 hover:bg-card/80",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="truncate font-medium text-sm">{agent.id}</div>
        {overrideCount > 0 && (
          <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary">
            {overrideCount}
          </span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
        {agent.description}
      </p>
      {agent.tools.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {agent.tools.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-1 py-0.5 text-[10px] text-muted-foreground"
            >
              <Wrench className="h-2.5 w-2.5" aria-hidden="true" />
              {t}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
