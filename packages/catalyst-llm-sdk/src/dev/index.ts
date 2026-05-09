// Dev-only barrel. Importing from `@catalyst/llm-sdk/dev` is opt-in and
// is intentionally not re-exported from the main `@catalyst/llm-sdk`
// entry — production bundles that don't reach for `/dev` ship none of
// this code.
//
// Heavy modules below (DuckDB-WASM ~10 MB) are also lazy-`import()`d
// internally so the wasm bundle is fetched on first use, not on the
// initial `import "@catalyst/llm-sdk/dev"` itself.
export { unloadModel } from "./unload.js";
export {
  record as recordMetric,
  useMetricsStore,
  shortHash,
  query as queryMetrics,
  exportPartitionedParquet,
  StatsView,
  type MetricsRow,
} from "./metrics/index.js";
