import { Play } from "lucide-react";
import type { AgentDescriptor } from "../../../agent/events.js";
import { SidePanelItem } from "../../page-shell/SidePanelItem.js";
import { TestRunBody } from "./TestRunBody.js";

export interface TestRunPanelProps {
  agent: AgentDescriptor | undefined;
  openSignal: number;
}

TestRunPanel.itemId = "engine.test-run";

export function TestRunPanel({ agent, openSignal }: TestRunPanelProps) {
  return (
    <SidePanelItem
      id="engine.test-run"
      title="Test run"
      icon={<Play className="h-3 w-3" />}
      openSignal={openSignal}
      headerRight={
        agent ? (
          <span className="font-mono text-[10px] normal-case tracking-normal text-foreground">
            {agent.id}
          </span>
        ) : undefined
      }
    >
      {agent ? (
        <div className="flex h-full min-h-0 flex-col p-1.5">
          <TestRunBody agent={agent} />
        </div>
      ) : (
        <div className="p-1.5 text-[11px] text-muted-foreground">
          Select an agent to dispatch a test run.
        </div>
      )}
    </SidePanelItem>
  );
}
