import { Activity } from "lucide-react";
import { SidePanelItem } from "../../page-shell/SidePanelItem.js";

NodeDetailPanel.itemId = "engine.node-detail";
NodeDetailPanel.defaultCollapsed = true;

export function NodeDetailPanel() {
  return (
    <SidePanelItem
      id="engine.node-detail"
      title="Node detail"
      icon={<Activity className="h-3 w-3" />}
      defaultCollapsed
    >
      <div className="p-1.5 text-[11px] text-muted-foreground">
        NodePanel — click a topology node to inspect its last events + drill
        into payload. Lands next.
      </div>
    </SidePanelItem>
  );
}
