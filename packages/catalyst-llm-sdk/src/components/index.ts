// ============================================================
// page-shell — layout primitive (PageShell + SidePanel + items)
// ============================================================
export { PageShell, type PageShellProps } from "./page-shell/PageShell.js";
export { SidePanel, type SidePanelProps } from "./page-shell/SidePanel.js";
export {
  SidePanelItem,
  type SidePanelItemProps,
} from "./page-shell/SidePanelItem.js";

// ============================================================
// engine — agent topology + run-viewer primitives
//
// The page-level composition (EnginePage) lives in the consumer app.
// SDK ships rail panels + topology + adapters + sheet bodies.
// ============================================================
export {
  ReactFlowAgentTopology,
  type ReactFlowAgentTopologyProps,
} from "./engine/topology/ReactFlowAgentTopology.js";
export {
  NodeRunsList,
  type NodeRunsListProps,
} from "./engine/panels/NodeRunsList.js";
export {
  TestRunBody,
  type TestRunBodyProps,
} from "./engine/panels/TestRunBody.js";
export {
  AgentsListPanel,
  type AgentsListPanelProps,
} from "./engine/panels/AgentsListPanel.js";
export {
  EventsPanel,
  type EventsPanelProps,
} from "./engine/panels/EventsPanel.js";
export {
  TestRunPanel,
  type TestRunPanelProps,
} from "./engine/panels/TestRunPanel.js";
export { NodeDetailPanel } from "./engine/panels/NodeDetailPanel.js";
export {
  TerminalPanel,
  type TerminalPanelProps,
} from "./engine/panels/TerminalPanel.js";
export {
  AgentConfigForm,
  type AgentConfigFormProps,
} from "./engine/AgentConfigForm.js";
export {
  agentEventToPanelEvent,
  resolveLLMNodeId,
  topologyNodeIds,
} from "./engine/adapters.js";
export type {
  PanelEvent,
  PanelSelection,
  PanelContext,
  NodeStatus,
} from "./engine/panel-types.js";

// ============================================================
// page-shell hooks — operator rail-assignment persistence
// ============================================================
export {
  useItemRails,
  type RailMap,
} from "./page-shell/hooks/useItemRails.js";

// ============================================================
// chat — message rendering, panel, tabs, response viewer
// ============================================================
export { ChatPanel, type ChatPanelProps } from "./chat/ChatPanel.js";
export { ChatTabs, type ChatTabsProps } from "./chat/ChatTabs.js";
export { ChatMessage, type ChatMessageProps } from "./chat/ChatMessage.js";
export { ToolCallCard, type ToolCallCardProps } from "./chat/ToolCallCard.js";
// Sliced sub-components (op-m6t) — consumers compose their own chat
// layouts using these instead of the full ChatPanel kitchen sink.
export {
  ChatMessageList,
  type ChatMessageListProps,
} from "./chat/ChatMessageList.js";
export {
  ChatComposer,
  type ChatComposerProps,
} from "./chat/ChatComposer.js";
export {
  ChatHeader,
  type ChatHeaderProps,
  type ChatHeaderView,
} from "./chat/ChatHeader.js";
export {
  ChatSettingsPanel,
  type ChatSettingsPanelProps,
} from "./chat/ChatSettingsPanel.js";
export {
  ChatStatsRow,
  type ChatStatsRowProps,
} from "./chat/ChatStatsRow.js";
export {
  ReasoningBlock,
  splitReasoning,
  type ReasoningBlockProps,
  type ContentSegment,
} from "./chat/ReasoningBlock.js";
export {
  ResponseViewer,
  type ResponseViewerProps,
} from "./chat/ResponseViewer.js";
export {
  ConnectionStatus,
  type ConnectionStatusProps,
} from "./chat/ConnectionStatus.js";

// ============================================================
// compare — multi-model side-by-side + tabular
// ============================================================
export { CompareView, type CompareViewProps } from "./compare/CompareView.js";
export {
  CompareGraphs,
  type CompareGraphsProps,
} from "./compare/CompareGraphs.js";
export { lineDiff, wordDiff, type Change as DiffChange } from "./compare/diff.js";

// ============================================================
// prompts — preset editor, picker, explorer sheet
// ============================================================
export {
  PromptEditor,
  type PromptEditorProps,
} from "./prompts/PromptEditor.js";
export {
  PromptEditForm,
  EMPTY_PROMPT_DRAFT,
  presetToDraft,
  draftToPayload,
  type PromptEditFormProps,
  type PromptDraft,
} from "./prompts/prompt-edit-form.js";
export {
  PromptPickerList,
  type PromptPickerListProps,
  type PromptPickerGroupAxis,
} from "./prompts/prompt-picker-list.js";
export {
  PromptExplorerSheet,
  type PromptExplorerSheetProps,
} from "./prompts/PromptExplorerSheet.js";
export {
  PromptPresets,
  SystemPromptPresets,
  type PromptPresetsProps,
  type SystemPromptPresetsProps,
} from "./prompts/PromptPresets.js";
export {
  SystemPromptEditor,
  type SystemPromptEditorProps,
} from "./prompts/SystemPromptEditor.js";
export {
  DEFAULT_PRESETS,
  SYSTEM_PRESETS,
  BUILTIN_SEEDS,
  getPresetsForModel,
  type PromptPreset,
} from "./prompts/prompt-seeds.js";

// ============================================================
// model-selector — pickers, info card, parameter controls
// ============================================================
export {
  ModelSelector,
  type ModelSelectorProps,
} from "./model-selector/ModelSelector.js";
export {
  ModelSelectorRich,
  type ModelSelectorRichProps,
} from "./model-selector/ModelSelectorRich.js";
export {
  ModelMicroSwitcher,
  type ModelMicroSwitcherProps,
} from "./model-selector/ModelMicroSwitcher.js";
export {
  ModelMultiSelect,
  type ModelMultiSelectProps,
} from "./model-selector/ModelMultiSelect.js";
export {
  ModelInfoCard,
  type ModelInfoCardProps,
} from "./model-selector/ModelInfoCard.js";
export {
  ParameterControls,
  type ParameterControlsProps,
} from "./model-selector/ParameterControls.js";

// ============================================================
// stats — cost + context-window meters
// ============================================================
export { CostPins, type CostPinsProps } from "./stats/CostPins.js";
export { ContextMeter, type ContextMeterProps } from "./stats/ContextMeter.js";

// ============================================================
// shared — cross-domain primitives (markdown render, fuzzy match)
// ============================================================
export {
  RenderedContent,
  type RenderedContentProps,
} from "./shared/RenderedContent.js";
// Generic monospace dropdown — drop-in replacement for native <select>.
// TODO: move-to-catalyst-ui — base primitive useful outside SDK.
export {
  DenseSelect,
  type DenseSelectOption,
  type DenseSelectProps,
} from "./shared/DenseSelect.js";
export { fuzzyScore, fuzzyFilter } from "./shared/fuzzy.js";
