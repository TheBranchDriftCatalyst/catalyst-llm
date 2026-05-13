import { Layers } from "lucide-react";
import { SidePanelItem } from "../../page-shell/SidePanelItem.js";

export interface EventsPanelProps {
  eventCount: number;
  selectedAgentId: string | undefined;
}

EventsPanel.itemId = "engine.events";
EventsPanel.defaultCollapsed = true;

export function EventsPanel({ eventCount, selectedAgentId }: EventsPanelProps) {
  return (
    <SidePanelItem
      id="engine.events"
      title="Events"
      icon={<Layers className="h-3 w-3" />}
      defaultCollapsed
      headerRight={
        <span className="text-[10px] text-muted-foreground">{eventCount}</span>
      }
    >
      <div className="p-1.5 text-[11px] text-muted-foreground">
        <p>EventStream — chronological + filterable. Sub-component lands next.</p>
        <p className="mt-1 italic">
          {eventCount} buffered events for{" "}
          <span className="font-mono">{selectedAgentId ?? "—"}</span>
        </p>
      </div>
    </SidePanelItem>
  );
}
