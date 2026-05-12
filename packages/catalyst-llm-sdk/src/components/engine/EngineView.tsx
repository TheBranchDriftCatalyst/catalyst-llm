/**
 * Engine tab — per-Agent topology viewer + config editor.
 *
 * Two-pane layout:
 *   Left: list of Agents registered with catalyst-langgraph (one card
 *         per Agent — main, research, future sub-agents).
 *   Right: selected Agent's topology + schema-driven config form.
 *
 * Config edits flow through useEngineStore (persisted to
 * localStorage under `catalyst-llm-sdk:engine`); chatStore.sendMessage
 * reads the store on every chat dispatch and stuffs the overrides
 * into the wire request's `agent_config` field.
 *
 * v1: static topology + form. v2 plans: live activity (SSE-driven
 * node highlighting), per-chat overrides, named config presets.
 */
import { useMemo, useState } from "react";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@thebranchdriftcatalyst/catalyst-ui/ui/card";
import { Activity, RefreshCw, RotateCcw, Wrench } from "lucide-react";
import type { AgentDescriptor } from "../../agent/events.js";
import { useAgents } from "../../react/hooks.js";
import { useEngineStore } from "../../react/engineStore.js";
import { cn } from "../utils.js";
import { AgentConfigForm } from "./AgentConfigForm.js";
import { AgentTopologyView } from "./AgentTopology.js";

// Stable empty references for zustand selectors. Returning a fresh `{}`
// or `[]` from a selector tells React's getSnapshot machinery the value
// changed every render, which triggers an infinite re-render loop.
// Module-level constants keep the reference identity stable across
// renders for the no-override case.
const EMPTY_OVERRIDES: Record<string, unknown> = Object.freeze({});

export interface EngineViewProps {
  className?: string;
}

export function EngineView({ className }: EngineViewProps) {
  const { agents, loading, error, refresh } = useAgents();
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const selected = useMemo(() => {
    if (!agents.length) return undefined;
    const found = agents.find((a) => a.id === selectedId);
    return found ?? agents[0];
  }, [agents, selectedId]);

  return (
    <div
      className={cn(
        "flex h-full w-full overflow-hidden bg-background text-foreground",
        className,
      )}
    >
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-card/30">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Agents
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            title="Refresh /api/agents"
            className="h-7 w-7 p-0"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>

        {error && (
          <div
            role="alert"
            className="m-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
          >
            Failed to load agents: {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading && agents.length === 0 ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : agents.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No agents registered. Configure VITE_AGENT_URL and start
              catalyst-langgraph.
            </div>
          ) : (
            agents.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                active={selected?.id === a.id}
                onClick={() => setSelectedId(a.id)}
              />
            ))
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        {selected ? (
          <AgentDetail agent={selected} />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Select an agent on the left to inspect it.
          </div>
        )}
      </main>
    </div>
  );
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
  // Select the underlying (stable-by-reference) inner config object,
  // then derive the count outside the selector. Returning
  // `Object.keys(...)` directly from the selector creates a new array
  // each render and triggers the getSnapshot-cached-warning + infinite
  // loop (see EMPTY_OVERRIDES rationale above).
  const overrides = useEngineStore((s) => s.configs[agent.id]);
  const overrideCount = overrides ? Object.keys(overrides).length : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-md border bg-card/50 p-3 transition-colors",
        active
          ? "border-primary/60 bg-primary/5 shadow-sm"
          : "border-border/60 hover:bg-card/80",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="font-medium text-sm">{agent.id}</div>
        {overrideCount > 0 && (
          <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary">
            {overrideCount} edited
          </span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
        {agent.description}
      </p>
      {agent.tools.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {agent.tools.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground"
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

function AgentDetail({ agent }: { agent: AgentDescriptor }) {
  // Select the inner config object directly (stable-by-reference) and
  // coalesce to the frozen empty constant outside the selector — see
  // EMPTY_OVERRIDES rationale at the top of this file.
  const overridesOrNull = useEngineStore((s) => s.configs[agent.id]);
  const overrides = overridesOrNull ?? EMPTY_OVERRIDES;
  const setField = useEngineStore((s) => s.setField);
  const resetAgent = useEngineStore((s) => s.resetAgent);
  const editedCount = Object.keys(overrides).length;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Activity className="h-5 w-5 text-primary" aria-hidden="true" />
            {agent.id}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {agent.description}
          </p>
          {agent.tools.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {agent.tools.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-xs"
                >
                  <Wrench className="h-3 w-3" aria-hidden="true" />
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        {editedCount > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => resetAgent(agent.id)}
            title="Clear all overrides for this Agent"
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Reset all
          </Button>
        )}
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Topology</CardTitle>
          <CardDescription>
            The LangGraph state machine this Agent runs. Conditional edges
            (dashed, accent-coloured) are router transitions; solid edges
            always fire.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AgentTopologyView topology={agent.topology} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Config</CardTitle>
          <CardDescription>
            Per-Agent tunables advertised by{" "}
            <code className="rounded bg-muted/40 px-1 py-0.5 text-xs">
              GET /api/agents
            </code>
            . Edits persist in localStorage and ride along on every chat
            dispatch via the request's{" "}
            <code className="rounded bg-muted/40 px-1 py-0.5 text-xs">
              agent_config
            </code>{" "}
            field.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AgentConfigForm
            schema={agent.config_schema}
            overrides={overrides}
            onChange={(name, value) => setField(agent.id, name, value)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
