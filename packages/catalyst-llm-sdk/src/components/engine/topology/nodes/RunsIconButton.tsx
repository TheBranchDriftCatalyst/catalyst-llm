/**
 * Tiny ghost-style icon button that opens the per-node runs Sheet
 * (NodeRunsList) when clicked. Shared by AgentNodeCard, ToolsNodeCard,
 * and EnsembleGroupCard so all three tap into the same trigger
 * affordance.
 */
import { History } from "lucide-react";
import { cn } from "../../../shared/utils.js";

export function RunsIconButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // Stop the click from bubbling to the node-click handler that
        // toggles selection — the runs sheet is a distinct affordance.
        e.stopPropagation();
        onClick();
      }}
      title="Recent runs on this node"
      className={cn(
        "nodrag flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent/40 hover:text-foreground",
        className,
      )}
    >
      <History className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}
