/**
 * Schema-driven card for `agent` nodes. Subscribes to the per-node
 * override dict via useEngineStore and renders the inline
 * NodeInlineConfig form so the operator can tweak any advertised
 * field without leaving the canvas.
 */
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useEngineStore } from "../../../../react/engineStore.js";
import { cn } from "../../../shared/utils.js";
import { NodeInlineConfig } from "../../NodeInlineConfig.js";
import { NODE_VISUAL } from "./visuals.js";
import { EMPTY_OBJ, type CommonNodeData } from "./data-types.js";
import { RunsIconButton } from "./RunsIconButton.js";

export function AgentNodeCard({ data }: NodeProps) {
  const d = data as CommonNodeData;
  const visual = NODE_VISUAL.agent;
  const Icon = visual.icon;
  const selected = d.selectedNodeId === d.nodeId;
  const active = d.activeNodeId === d.nodeId;

  // Subscribe to the whole per-node override dict so any field edit
  // re-renders this card. EMPTY_OBJ keeps reference identity stable.
  const nodeOverrides = useEngineStore(
    (s) => s.configs[d.agentId]?.[d.nodeId],
  );
  const overrides = nodeOverrides ?? EMPTY_OBJ;
  const setField = useEngineStore((s) => s.setField);

  if (!d.schema) {
    return (
      <div
        className={cn(
          "flex flex-col gap-1 rounded-md border-2 p-2 shadow-sm transition-all",
          visual.tone,
          selected &&
            "ring-2 ring-primary/60 ring-offset-1 ring-offset-background",
        )}
        style={{ width: d.size.w, height: d.size.h }}
        title={`agent node: ${d.nodeId}`}
      >
        <Handle type="target" position={Position.Top} />
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="font-mono truncate">{d.nodeId}</span>
          <RunsIconButton
            onClick={() => d.onOpenRunsSheet?.(d.nodeId)}
            className="ml-auto"
          />
        </div>
        <span className="text-[10px] text-muted-foreground">
          no schema advertised
        </span>
        <Handle type="source" position={Position.Bottom} />
      </div>
    );
  }

  // Materialise effective values: explicit override wins, else
  // schema default. NodeInlineConfig wants both the merged values
  // and the set of override keys (for the inline reset affordance).
  const schemaProps = d.schema.properties ?? {};
  const defaults = d.defaults ?? {};
  const overrideKeys = new Set(Object.keys(overrides));
  const values: Record<string, unknown> = {};
  for (const fieldName of Object.keys(schemaProps)) {
    values[fieldName] = overrideKeys.has(fieldName)
      ? overrides[fieldName]
      : defaults[fieldName];
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-md border-2 p-2 shadow-sm transition-all",
        visual.tone,
        selected &&
          "ring-2 ring-primary/60 ring-offset-1 ring-offset-background",
      )}
      style={{ width: d.size.w, height: d.size.h }}
      title={`agent node: ${d.nodeId}`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="font-mono truncate">{d.nodeId}</span>
        {overrideKeys.size > 0 && (
          <span className="ml-auto rounded-full bg-primary/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-primary">
            {overrideKeys.size}
          </span>
        )}
        <RunsIconButton
          onClick={() => d.onOpenRunsSheet?.(d.nodeId)}
          className={overrideKeys.size > 0 ? "" : "ml-auto"}
        />
      </div>
      <NodeInlineConfig
        schema={d.schema}
        values={values}
        overrideKeys={overrideKeys}
        onChange={(field, value) =>
          setField(d.agentId, d.nodeId, field, value)
        }
        onOpenPromptSheet={() => d.onOpenPromptSheet?.(d.nodeId)}
        className="flex-1 overflow-y-auto"
      />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
