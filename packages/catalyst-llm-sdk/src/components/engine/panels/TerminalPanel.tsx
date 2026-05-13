import { Terminal as TerminalIcon } from "lucide-react";
import { SidePanelItem } from "../../page-shell/SidePanelItem.js";

export interface TerminalPanelProps {
  eventCount: number;
}

TerminalPanel.itemId = "engine.terminal";

export function TerminalPanel({ eventCount }: TerminalPanelProps) {
  return (
    <SidePanelItem
      id="engine.terminal"
      title="Terminal"
      icon={<TerminalIcon className="h-3 w-3" />}
      headerRight={
        <span className="text-[10px] text-muted-foreground">
          {eventCount} total
        </span>
      }
    >
      <div className="p-1.5 font-mono text-[11px] text-muted-foreground">
        Terminal — live token stream + reasoning. Lands next.
      </div>
    </SidePanelItem>
  );
}
