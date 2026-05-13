/**
 * First-class container for ensemble groups (topology.groups[]
 * entries with config_schema set). Owns the SHARED per-member
 * config form + renders N member-preview cards inside (count driven
 * by the live value of the group's instance_count_field).
 *
 * Per-member overrides are NOT supported in v1 — every member reads
 * the same group config. Matches the catalyst-langgraph runtime
 * which fans out N identical asyncio.gather calls.
 */
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Activity, Users } from "lucide-react";
import { useEngineStore } from "../../../../react/engineStore.js";
import { cn } from "../../../shared/utils.js";
import { NodeInlineConfig } from "../../NodeInlineConfig.js";
import { EMPTY_OBJ, type EnsembleGroupData } from "./data-types.js";
import { RunsIconButton } from "./RunsIconButton.js";

export function EnsembleGroupCard({ data }: NodeProps) {
  const d = data as EnsembleGroupData;
  const selected = d.selectedNodeId === d.templateNodeId;
  const active = d.activeNodeId === d.templateNodeId;

  const setField = useEngineStore((s) => s.setField);

  // Group-level overrides (ensemble orchestration — council_size).
  const groupOverridesRaw = useEngineStore(
    (s) => s.configs[d.agentId]?.[d.groupId],
  );
  const groupOverrides = groupOverridesRaw ?? EMPTY_OBJ;

  // Per-member template overrides (model, temperature, …) keyed by the
  // template node id, NOT the group id. Edits to the member form below
  // write here.
  const memberOverridesRaw = useEngineStore(
    (s) => s.configs[d.agentId]?.[d.templateNodeId],
  );
  const memberOverrides = memberOverridesRaw ?? EMPTY_OBJ;

  if (!d.schema) {
    return (
      <div
        className="rounded-lg border-2 border-dashed border-amber-400/60 bg-amber-500/[0.06] p-3"
        style={{ width: d.size.w, height: d.size.h }}
      >
        <Handle type="target" position={Position.Top} />
        ensemble: no schema
        <Handle type="source" position={Position.Bottom} />
      </div>
    );
  }

  // Merge group overrides over group defaults.
  const groupSchemaProps = d.schema.properties ?? {};
  const groupDefaults = d.defaults ?? {};
  const groupOverrideKeys = new Set(Object.keys(groupOverrides));
  const groupValues: Record<string, unknown> = {};
  for (const fieldName of Object.keys(groupSchemaProps)) {
    groupValues[fieldName] = groupOverrideKeys.has(fieldName)
      ? groupOverrides[fieldName]
      : groupDefaults[fieldName];
  }

  // Merge member overrides over member defaults (when the template
  // node has its own schema). The form below renders only when both
  // are present; otherwise the card degrades to the group-only form.
  const memberSchemaProps = d.memberSchema?.properties ?? {};
  const memberDefaults = d.memberDefaults ?? {};
  const memberOverrideKeys = new Set(Object.keys(memberOverrides));
  const memberValues: Record<string, unknown> = {};
  for (const fieldName of Object.keys(memberSchemaProps)) {
    memberValues[fieldName] = memberOverrideKeys.has(fieldName)
      ? memberOverrides[fieldName]
      : memberDefaults[fieldName];
  }

  // Live instance count from the group's config — bounded.
  const instanceCount = d.instanceCountField
    ? Math.max(
        1,
        Math.min(
          12,
          Number(
            groupValues[d.instanceCountField] ??
              groupDefaults[d.instanceCountField] ??
              1,
          ),
        ),
      )
    : 1;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border-2 p-2 shadow-sm transition-all",
        "border-amber-400/60 bg-amber-500/[0.06]",
        selected &&
          "ring-2 ring-primary/60 ring-offset-1 ring-offset-background",
        active && "ring-2 ring-primary animate-pulse",
      )}
      style={{ width: d.size.w, height: d.size.h }}
      title={`${d.label ?? d.groupId}: ${instanceCount} member${instanceCount === 1 ? "" : "s"}`}
    >
      <Handle type="target" position={Position.Top} />

      {/* Group header — label + Nx badge + runs button */}
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">
          <Users className="h-3 w-3" aria-hidden="true" />
          {d.label ?? d.groupId}
        </div>
        <div className="flex items-center gap-1">
          <span className="rounded-sm border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-100">
            {instanceCount}×
          </span>
          {d.onOpenRunsSheet && (
            <RunsIconButton
              onClick={() => d.onOpenRunsSheet?.(d.templateNodeId)}
            />
          )}
        </div>
      </div>

      {/* Group form — ensemble-level orchestration only (council_size).
       * Writes to engineStore keyed by the group id. */}
      <NodeInlineConfig
        schema={d.schema}
        values={groupValues}
        overrideKeys={groupOverrideKeys}
        onChange={(field, value) =>
          setField(d.agentId, d.groupId, field, value)
        }
        onOpenPromptSheet={() => d.onOpenPromptSheet?.(d.groupId)}
        className="shrink-0"
      />

      {/* Member-template form — per-member LLM tunables (model,
       * temperature, system_prompt, …). Writes to engineStore keyed
       * by the template node id. Shared by all N members. */}
      {d.memberSchema && (
        <>
          <div className="flex shrink-0 items-center gap-1.5 border-t border-amber-500/20 pt-2 text-[10px] font-bold uppercase tracking-wider text-amber-200/80">
            <Activity className="h-3 w-3" aria-hidden="true" />
            subagent · template
          </div>
          <NodeInlineConfig
            schema={d.memberSchema}
            values={memberValues}
            overrideKeys={memberOverrideKeys}
            onChange={(field, value) =>
              setField(d.agentId, d.templateNodeId, field, value)
            }
            onOpenPromptSheet={() =>
              d.onOpenPromptSheet?.(d.templateNodeId)
            }
            className="shrink-0"
          />
        </>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
