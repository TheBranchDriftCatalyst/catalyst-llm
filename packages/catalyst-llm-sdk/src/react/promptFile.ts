/**
 * Serialize / parse the `.prompt` markdown-with-frontmatter convention
 * used by GitHub Copilot prompt files, Cursor's `.cursor/rules/*.mdc`,
 * and the broader prompts-as-code ecosystem.
 *
 * The mapping our registry uses:
 *
 *   ---
 *   name: Senior code reviewer
 *   description: Bugs / security / perf review with line refs.
 *   category: system            # user | system | both
 *   icon: shield                # lucide name (lowercase, hyphen-cased)
 *   model: ^claude-             # optional regex pattern (renamed from modelPattern)
 *   tags: [review, engineering]
 *   builtin: false
 *   system: |                   # only when category=both — see below
 *     You are a senior software engineer...
 *   ---
 *
 *   <body — interpreted as the user prompt for category=user/both,
 *    or the system prompt for category=system>
 *
 * Encoding choices:
 *  - For category=user: body = user prompt, no `system` in frontmatter.
 *  - For category=system: body = system prompt, no `system` in frontmatter.
 *    This is the natural shape for prompt-files in tools that don't
 *    distinguish — body is "the prompt".
 *  - For category=both (rare — bundled persona + task): body = user
 *    prompt, and `system: |` in frontmatter holds the system prompt.
 *
 * `id`, `createdAt`, `updatedAt` are *not* serialized — re-importing
 * a .prompt file mints a new id (or updates if one already exists
 * with the same `name`+`category`).
 *
 * No external YAML dep — we use a tiny hand-rolled subset that handles
 * scalars, lists of strings, and a `system: |` block. That covers our
 * actual schema; if a user authors something exotic (anchors, nested
 * structs) we silently drop the unknown keys rather than barf.
 */
import type { CustomPreset } from "./promptStore.js";

export interface ParsedPromptFile {
  preset: Omit<CustomPreset, "id" | "createdAt" | "updatedAt">;
  /** Anything in the frontmatter we didn't recognize, preserved as
   * key→string for round-trip exports if the user re-saves later. */
  extra: Record<string, string>;
}

const SCALAR_FIELDS = ["name", "description", "category", "icon", "model"] as const;
type ScalarField = (typeof SCALAR_FIELDS)[number];

/** Convert one CustomPreset -> .prompt file text. */
export function serializePromptFile(
  preset: Omit<CustomPreset, "id" | "createdAt" | "updatedAt"> &
    Partial<Pick<CustomPreset, "id">>,
): string {
  const fm: string[] = [];
  fm.push(`name: ${yamlScalar(preset.name)}`);
  if (preset.description) fm.push(`description: ${yamlScalar(preset.description)}`);
  fm.push(`category: ${preset.category}`);
  if (preset.iconName) fm.push(`icon: ${preset.iconName}`);
  // We persist `modelPattern` under the simpler `model` key in the
  // file format — every existing prompt-file convention uses `model`
  // for "what model is this for", and our regex form fits.
  if (preset.modelPattern) fm.push(`model: ${yamlScalar(preset.modelPattern)}`);
  if (preset.tags && preset.tags.length > 0) {
    fm.push(`tags: [${preset.tags.map(yamlScalar).join(", ")}]`);
  }
  if (preset.builtin) fm.push(`builtin: true`);

  let body: string;
  if (preset.category === "both") {
    fm.push(`system: |`);
    fm.push(yamlBlock(preset.systemPrompt ?? "", 2));
    body = preset.user ?? "";
  } else if (preset.category === "system") {
    body = preset.systemPrompt ?? "";
  } else {
    body = preset.user ?? "";
  }

  return `---\n${fm.join("\n")}\n---\n\n${body.trim()}\n`;
}

/** Parse `.prompt` text -> CustomPreset shape (minus id/timestamps). */
export function parsePromptFile(text: string): ParsedPromptFile {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(
      "missing YAML frontmatter — `.prompt` files must start with --- ... ---",
    );
  }
  const fmRaw = match[1];
  const body = match[2].trim();
  const { fields, blocks } = parseFrontmatter(fmRaw);

  const name = fields.name ?? "";
  if (!name) throw new Error("frontmatter `name` is required");
  const categoryRaw = (fields.category ?? "user").toLowerCase();
  const category: CustomPreset["category"] =
    categoryRaw === "system" || categoryRaw === "both" ? categoryRaw : "user";

  const out: Omit<CustomPreset, "id" | "createdAt" | "updatedAt"> = {
    name,
    description: fields.description || undefined,
    iconName: fields.icon || undefined,
    modelPattern: fields.model || undefined,
    tags: parseTagsList(fields.tags),
    category,
    builtin: fields.builtin === "true",
  };
  if (category === "system") {
    out.systemPrompt = body;
  } else if (category === "both") {
    out.systemPrompt = blocks.system ?? "";
    out.user = body;
  } else {
    out.user = body;
  }

  // Preserve unknown frontmatter keys for lossless round-trip.
  const known = new Set<ScalarField | "tags" | "builtin" | "system">([
    ...SCALAR_FIELDS,
    "tags",
    "builtin",
    "system",
  ]);
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!known.has(k as any)) extra[k] = v;
  }
  return { preset: out, extra };
}

// ─── tiny YAML helpers ────────────────────────────────────────────────

function yamlScalar(s: string): string {
  // Quote when needed: contains a colon, leading whitespace, '#', or
  // looks YAML-special. Otherwise emit bare. Always escape embedded
  // double quotes.
  if (s === "") return '""';
  if (/[:#\n]/.test(s) || /^[\s\-?@&*!|>'"%]/.test(s) || /\s$/.test(s)) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

function yamlBlock(s: string, indent: number): string {
  const pad = " ".repeat(indent);
  return s
    .split("\n")
    .map((ln) => pad + ln)
    .join("\n");
}

function parseFrontmatter(text: string): {
  fields: Record<string, string>;
  blocks: Record<string, string>;
} {
  const fields: Record<string, string> = {};
  const blocks: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) {
      i += 1;
      continue;
    }
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) {
      i += 1;
      continue;
    }
    const key = m[1];
    const rest = m[2];
    if (rest === "|" || rest === "|-" || rest === ">") {
      // Block scalar — gather lines indented more than the key.
      const blockLines: string[] = [];
      i += 1;
      // Detect the indent of the first content line.
      let blockIndent: number | null = null;
      while (i < lines.length) {
        const ln = lines[i];
        if (ln.trim() === "") {
          blockLines.push("");
          i += 1;
          continue;
        }
        const indent = ln.length - ln.trimStart().length;
        if (blockIndent === null) blockIndent = indent;
        if (indent < (blockIndent ?? 0)) break;
        blockLines.push(ln.slice(blockIndent ?? 0));
        i += 1;
      }
      blocks[key] = blockLines.join("\n").replace(/\n+$/, "");
    } else {
      fields[key] = unquote(rest);
      i += 1;
    }
  }
  return { fields, blocks };
}

function unquote(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return t;
}

function parseTagsList(s: string | undefined): string[] | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) {
    // Allow comma-separated bare lists as a courtesy.
    const parts = t.split(",").map((x) => x.trim()).filter(Boolean);
    return parts.length > 0 ? parts : undefined;
  }
  const inner = t.slice(1, -1);
  const parts: string[] = [];
  let buf = "";
  let inQuote = false;
  let quoteChar = "";
  for (const ch of inner) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        buf += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ",") {
      const v = buf.trim();
      if (v) parts.push(v);
      buf = "";
    } else {
      buf += ch;
    }
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);
  return parts.length > 0 ? parts : undefined;
}
