// Dev-only barrel. Importing from `@catalyst/llm-sdk/dev` is opt-in and
// is intentionally not re-exported from the main `@catalyst/llm-sdk`
// entry — production bundles that don't reach for `/dev` ship none of
// this code.
export { unloadModel } from "./unload.js";
