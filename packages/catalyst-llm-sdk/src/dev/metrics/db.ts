/**
 * DuckDB-WASM lifecycle for the in-browser metrics sink.
 *
 * Why this lives under `src/dev/` and is loaded via dynamic import:
 *
 *   - DuckDB-WASM ships ~10 MB of wasm + worker code. Pulling it into
 *     a production bundle for a feature only used during development
 *     would balloon the playground's initial download.
 *   - The `@catalyst/llm-sdk/dev` subpath is intentionally not
 *     re-exported from the main entry, so a host that doesn't
 *     `import "@catalyst/llm-sdk/dev"` ships none of this code.
 *   - Even within `/dev`, we lazy-`import()` `@duckdb/duckdb-wasm`
 *     inside `getDB()` so the wasm bundle is fetched only when the
 *     first metric is recorded (or the StatsView is opened) — opening
 *     the playground without ever touching /stats keeps the network
 *     tab clean.
 *
 * Persistence: we write a single OPFS-backed DuckDB file
 * (`catalyst-llm-metrics.duckdb`). Per-model "partitioning" is
 * implemented logically — every row carries a `model` column, and
 * the export action emits one Parquet file per model into OPFS so
 * the data is also greppable from a `duckdb` CLI shell after export.
 */
import type {
  AsyncDuckDB,
  AsyncDuckDBConnection,
} from "@duckdb/duckdb-wasm";

const OPFS_DB_FILE = "catalyst-llm-metrics.duckdb";

let _db: AsyncDuckDB | null = null;
let _conn: AsyncDuckDBConnection | null = null;
let _initPromise: Promise<AsyncDuckDBConnection> | null = null;

/**
 * Idempotently spin up DuckDB-WASM and return a connection. First call
 * pays the ~30s wasm download + module init; subsequent calls are
 * effectively free (memoized).
 */
export async function getDB(): Promise<AsyncDuckDBConnection> {
  if (_conn) return _conn;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const duckdb = await import("@duckdb/duckdb-wasm");
    const bundles = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(bundles);
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], {
        type: "text/javascript",
      }),
    );
    const worker = new Worker(workerUrl);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);

    // Try to attach an OPFS-backed file so metrics survive reloads.
    // OPFS isn't available everywhere (private mode in some browsers
    // disables it), in which case we fall back to in-memory and warn
    // the user that data is session-local.
    let opfsAttached = false;
    try {
      await db.open({ path: `opfs://${OPFS_DB_FILE}`, accessMode: 2 /* READ_WRITE */ });
      opfsAttached = true;
    } catch (err) {
      console.warn(
        "[catalyst-llm-sdk/dev] OPFS unavailable — metrics will not persist across reloads.",
        err,
      );
    }

    const conn = await db.connect();
    await applySchema(conn);
    if (!opfsAttached) {
      // Tag the DB so the UI can show a "ephemeral" warning. We
      // attach this as a meta column on a settings table.
      await conn.query(
        "CREATE TABLE IF NOT EXISTS sink_meta (key VARCHAR PRIMARY KEY, value VARCHAR)",
      );
      await conn.query(
        "INSERT OR REPLACE INTO sink_meta VALUES ('ephemeral', 'true')",
      );
    }

    _db = db;
    _conn = conn;
    return conn;
  })();
  try {
    return await _initPromise;
  } finally {
    // Only clear on failure so a retry can restart init; on success
    // _conn is set and the early-return at the top short-circuits.
    if (!_conn) _initPromise = null;
  }
}

/**
 * Migrate the metrics schema. Idempotent — safe to call on every boot.
 * Schema version is tracked in `sink_meta('schema_version')`.
 */
async function applySchema(conn: AsyncDuckDBConnection): Promise<void> {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS sink_meta (
      key   VARCHAR PRIMARY KEY,
      value VARCHAR
    );
  `);
  // We define the metrics table once; future changes go through
  // ALTER TABLE in version-bumped branches below.
  await conn.query(`
    CREATE TABLE IF NOT EXISTS metrics (
      ts                 TIMESTAMP    NOT NULL,
      chat_id            VARCHAR,
      turn_id            VARCHAR,
      source             VARCHAR      NOT NULL,        -- "chat" | "compare"
      model              VARCHAR      NOT NULL,
      role               VARCHAR      NOT NULL DEFAULT 'assistant',
      prompt_tokens      INTEGER,
      completion_tokens  INTEGER,
      total_tokens       INTEGER,
      cost_usd           DOUBLE,
      ttft_ms            INTEGER,
      duration_ms        INTEGER,
      tokens_per_sec     DOUBLE,
      finish_reason      VARCHAR,
      n_messages         INTEGER,
      ctx_used           INTEGER,
      system_prompt_hash VARCHAR,
      user_prompt_hash   VARCHAR,
      error              VARCHAR
    );
  `);
  // Helpful indexes for the common dashboard queries.
  await conn.query("CREATE INDEX IF NOT EXISTS idx_metrics_model ON metrics(model);");
  await conn.query("CREATE INDEX IF NOT EXISTS idx_metrics_ts    ON metrics(ts);");
  await conn.query(
    "INSERT OR REPLACE INTO sink_meta VALUES ('schema_version', '1');",
  );
}

/**
 * Append one row to the metrics table. Pre-bound prepared statement
 * since we'll call this on every chat completion and want to avoid
 * re-parsing the SQL each time.
 */
let _insertStmt: Awaited<ReturnType<AsyncDuckDBConnection["prepare"]>> | null = null;
async function getInsertStmt(conn: AsyncDuckDBConnection) {
  if (_insertStmt) return _insertStmt;
  _insertStmt = await conn.prepare(`
    INSERT INTO metrics VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  return _insertStmt;
}

export interface MetricsRow {
  ts: Date;
  chat_id?: string;
  turn_id?: string;
  source: "chat" | "compare";
  model: string;
  role?: "assistant" | "user" | "system";
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost_usd?: number;
  ttft_ms?: number;
  duration_ms?: number;
  tokens_per_sec?: number;
  finish_reason?: string;
  n_messages?: number;
  ctx_used?: number;
  system_prompt_hash?: string;
  user_prompt_hash?: string;
  error?: string;
}

export async function recordRow(row: MetricsRow): Promise<void> {
  const conn = await getDB();
  const stmt = await getInsertStmt(conn);
  // DuckDB's prepared-statement bindings expect plain primitives.
  await stmt.query(
    row.ts,
    row.chat_id ?? null,
    row.turn_id ?? null,
    row.source,
    row.model,
    row.role ?? "assistant",
    row.prompt_tokens ?? null,
    row.completion_tokens ?? null,
    row.total_tokens ?? null,
    row.cost_usd ?? null,
    row.ttft_ms ?? null,
    row.duration_ms ?? null,
    row.tokens_per_sec ?? null,
    row.finish_reason ?? null,
    row.n_messages ?? null,
    row.ctx_used ?? null,
    row.system_prompt_hash ?? null,
    row.user_prompt_hash ?? null,
    row.error ?? null,
  );
}

/**
 * Run an arbitrary SQL query and return rows as plain JS objects. Used
 * by the StatsView's free-form SQL pane and the summary card queries.
 */
export async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const conn = await getDB();
  const arrow = await conn.query(sql);
  return arrow.toArray().map((r: any) => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(r)) out[k] = r[k];
    return out as T;
  });
}

/**
 * Export every per-model partition as a Parquet file under
 * `opfs://exports/<model>.parquet`. Returns the list of file paths so
 * the UI can offer "download" links via the OPFS getFile API.
 *
 * DuckDB's `COPY ... TO 'opfs://...'` writes through the same OPFS
 * adapter we attached for the DB itself.
 */
export async function exportPartitionedParquet(): Promise<string[]> {
  const conn = await getDB();
  const models = (
    await query<{ model: string }>("SELECT DISTINCT model FROM metrics ORDER BY model")
  ).map((r) => r.model);
  const paths: string[] = [];
  for (const m of models) {
    const safe = m.replace(/[^A-Za-z0-9._-]+/g, "_");
    const path = `opfs://exports/${safe}.parquet`;
    // SAFE because `m` is matched against an existing row and we
    // single-quote it with explicit escaping; still, prefer parameter
    // binding when DuckDB-WASM exposes it for COPY in a future release.
    const escaped = m.replace(/'/g, "''");
    await conn.query(
      `COPY (SELECT * FROM metrics WHERE model = '${escaped}') TO '${path}' (FORMAT 'parquet')`,
    );
    paths.push(path);
  }
  return paths;
}

/**
 * Best-effort cleanup. Mostly useful for tests; we don't actually
 * detach DuckDB on browser nav since OPFS persists for us.
 */
export async function closeDB(): Promise<void> {
  try {
    await _conn?.close();
  } catch {
    /* noop */
  }
  try {
    await _db?.terminate();
  } catch {
    /* noop */
  }
  _conn = null;
  _db = null;
  _initPromise = null;
  _insertStmt = null;
}
