/**
 * Dev-only metrics sink. Re-exported via `@catalyst/llm-sdk/dev` so the
 * production bundle never reaches this code unless the host explicitly
 * opts in by importing the `/dev` subpath.
 */
export { record, useMetricsStore, shortHash } from "./store.js";
export {
  query,
  recordRow,
  exportPartitionedParquet,
  closeDB,
  type MetricsRow,
} from "./db.js";
export { StatsView } from "./StatsView.js";
