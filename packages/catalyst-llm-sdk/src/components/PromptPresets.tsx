import { useEffect, useMemo, useRef, useState } from "react";
import {
  Code,
  Wrench,
  Brain,
  ListChecks,
  Sparkles,
  Zap,
  Shield,
  Braces,
  GraduationCap,
  Tag,
  FileSearch,
  ChevronDown,
} from "lucide-react";
import { usePromptStore } from "../react/promptStore.js";
import { useFocusTrap } from "./useFocusTrap.js";
import { useListboxKeyboard } from "./useListboxKeyboard.js";
import { cn } from "./utils.js";

export interface PromptPreset {
  /** Short label for the chip. */
  name: string;
  /** Icon shown in the chip. */
  icon?: React.ElementType;
  /** Tooltip / longer description. */
  description?: string;
  /** Optional system prompt — handler decides whether to apply it. */
  systemPrompt?: string;
  /** Filled into the user prompt textarea on click. Optional for
   * system-prompt-only presets. */
  user?: string;
}

export interface PromptPresetsProps {
  presets?: PromptPreset[];
  onApply: (preset: PromptPreset) => void;
  className?: string;
  /** Label rendered before the trigger / chips. Default "presets". */
  label?: string;
  /** Icon next to the label. Default {@link Sparkles}. */
  labelIcon?: React.ElementType;
  /**
   * Layout for the preset row. Default `"dropdown"` (compact trigger that
   * opens a menu of presets with description tooltips). Use `"chips"` if you
   * have horizontal real estate to spare and want one-click application.
   */
  variant?: "dropdown" | "chips";
  /**
   * Optional model id used to filter custom (registry) presets via their
   * `modelPattern`. Built-ins ignore this — the caller already chose them
   * via {@link getPresetsForModel}. Pass `currentChat.model` here.
   */
  modelId?: string;
  /**
   * When true, custom presets from the local registry (saved via
   * {@link PromptEditor}) are merged into the dropdown alongside the
   * built-ins. Defaults to true. Set to false in stories / docs to
   * keep the dropdown deterministic.
   */
  includeCustom?: boolean;
}

/**
 * Curated benchmark prompts that exercise distinct model capabilities.
 *
 * - **tool calling** — gives the model a fixed tool inventory and asks for
 *   a structured plan. Surfaces format adherence + tool-use reasoning.
 *   No actual tools are wired; we score on the structured output.
 * - **coding** — a HumanEval-flavored function with edge cases and a
 *   require-tests tail. Surfaces correctness + self-testing discipline.
 * - **reasoning** — a multi-step word problem with a unique numeric answer.
 *   Surfaces step-by-step reasoning + arithmetic; pairs well with the
 *   reasoning_effort control to A/B effort levels.
 * - **task following** — IFEval-flavored multi-constraint formatting test.
 *   Surfaces instruction adherence + negative constraints (must-not-contain).
 */
export const DEFAULT_PRESETS: PromptPreset[] = [
  {
    name: "Tool calling",
    icon: Wrench,
    description:
      "Plan a multi-step task using a fixed tool inventory. Tests structured output + tool-use reasoning.",
    user: `You have access to these tools (and ONLY these):
- get_weather(city: str) -> { temp_f: float, condition: str }
- search_flights(from: str, to: str, date: str) -> [{ airline, price_usd, duration_h }]
- book_hotel(city: str, checkin: str, checkout: str, max_price_usd: int) -> { confirmation: str }
- send_email(to: str, subject: str, body: str) -> { ok: bool }

Plan a 3-day weekend trip to Paris from New York leaving Friday 2026-06-12.
Output ONLY a JSON array of tool calls in the order you'd make them, like:
[{"tool": "get_weather", "args": {"city": "Paris"}}, ...]
No prose, no markdown, no explanation.`,
  },
  {
    name: "Coding",
    icon: Code,
    description:
      "HumanEval-style: implement a function with explicit edge cases and self-tests. Tests correctness + test discipline.",
    user: `Write a Python function:

def is_balanced(s: str) -> bool

that returns True if every opening bracket in \`s\` (\`(\`, \`[\`, \`{\`) is closed by a matching closing bracket in the correct order, ignoring all non-bracket characters. Examples: "([])" -> True, "([)]" -> False, "" -> True, "abc(def)ghi" -> True.

Then write 5 assertions exercising: empty string, simple match, nested match, mismatch, and bracket inside non-bracket text. Output the function and assertions in a single code block.`,
  },
  {
    name: "Reasoning",
    icon: Brain,
    description:
      "Multi-step word problem with a unique numeric answer. Pairs with reasoning_effort to A/B effort levels.",
    user: `Two trains are 240 miles apart on a single track, moving toward each other. Train A leaves Station X at 8:00 AM at 50 mph. Train B leaves Station Y at 8:30 AM at 70 mph. A bird starts at Train A at 8:30 AM and flies back and forth between the trains at 100 mph until they meet.

What time do the trains meet, and how many miles did the bird fly? Show your reasoning step by step, then give the final answer as: "Trains meet at HH:MM. Bird flew X miles."`,
  },
  {
    name: "Task following",
    icon: ListChecks,
    description:
      "Multi-constraint format + negative constraint (must-not-contain). IFEval-style instruction-adherence test.",
    user: `Follow ALL of these instructions exactly:

1. Write a haiku (5/7/5 syllables) about a city sunrise.
2. Below the haiku, list exactly THREE nouns that appear in your haiku, one per line, all lowercase, no punctuation.
3. Below the noun list, write a one-sentence summary of the haiku in 12 words or fewer.
4. The summary MUST NOT contain any of the three nouns you listed.
5. Use this exact output format with the labels in caps:

HAIKU:
<your haiku>

NOUNS:
<noun1>
<noun2>
<noun3>

SUMMARY:
<your sentence>

Do not include any other text before or after.`,
  },
];

/**
 * System-prompt presets that change the model's *role* without touching the
 * user prompt. Pair these with the user-prompt presets above to A/B how a
 * given task changes when you swap the persona — e.g. run "Coding" through
 * both `concise` and `senior code reviewer` to compare terseness vs depth.
 */
export const SYSTEM_PRESETS: PromptPreset[] = [
  {
    name: "Concise",
    icon: Zap,
    description:
      "Minimum-words assistant. No preamble, no caveats, no apologies — direct answers only.",
    systemPrompt: `You are a concise assistant. Answer in the fewest words possible. No preamble, no caveats, no apologies. If asked a yes/no question, answer yes or no first, then add at most one sentence of detail. Skip any "Sure!" / "Of course!" / "I'd be happy to" prefixes.`,
  },
  {
    name: "Code reviewer",
    icon: Shield,
    description:
      "Senior engineer doing code review. Looks for bugs, security, perf, clarity. Direct, no praise.",
    systemPrompt: `You are a senior software engineer doing a thorough code review. For any code shown, identify in this exact order:
1. Bugs and edge cases (null inputs, off-by-one, race conditions, error paths).
2. Security concerns (injection, auth, secrets, untrusted input).
3. Performance issues (allocation, N+1, blocking I/O, complexity).
4. Clarity / maintainability improvements.

Use bullet points. Reference line numbers or function names when relevant. Be direct — do not praise the code, do not soften with "consider" or "you might want to". State the problem and the fix. If the code is correct, say "Looks correct." and move on.`,
  },
  {
    name: "JSON only",
    icon: Braces,
    description:
      "Strict JSON-API persona. Every response is valid JSON, no prose, no fences.",
    systemPrompt: `You are a JSON API. Every response you produce MUST be a single JSON object that parses successfully with json.loads in Python. No prose, no markdown, no code fences, no leading/trailing whitespace beyond what JSON requires.

If you can fulfill the request, respond with: {"result": <answer>}
If you cannot, respond with: {"error": "<short reason>"}

Never wrap your output in \`\`\`json or any other delimiter. The first character of your response must be { and the last must be }.`,
  },
  {
    name: "Critic",
    icon: ListChecks,
    description:
      "Devil's advocate — only finds problems, never proposes solutions. Stress-tests your plan.",
    systemPrompt: `You are a critical reviewer whose only job is to find what could go wrong. For any plan, design, idea, or code shown to you, list:
- Failure modes (specific scenarios where it breaks)
- Hidden assumptions that could be violated
- Risks (security, data loss, scaling, operational)
- Counter-arguments to the stated rationale

Do NOT propose solutions, alternatives, or workarounds. Do NOT acknowledge what's good. Be specific and concrete — abstract criticism ("this might not scale") is useless without a named scenario ("at >10k QPS the unbounded queue in step 3 OOMs the worker"). Use bullet points.`,
  },
  {
    name: "Teacher",
    icon: GraduationCap,
    description:
      "Patient step-by-step teacher. Numbered steps, why-it-matters, plain language.",
    systemPrompt: `You are a patient teacher. Break every explanation into numbered steps. After each step, add a brief "Why:" sentence explaining what makes that step matter. End with a one-line summary the student should remember.

Use plain language. If you must use jargon, define it the first time it appears. Prefer concrete examples over abstract definitions. If the student asks something you can't answer with confidence, say so explicitly rather than guessing.`,
  },
];

export function PromptPresets({
  presets = DEFAULT_PRESETS,
  onApply,
  className,
  label = "presets",
  labelIcon: LabelIcon = Sparkles,
  variant = "dropdown",
  modelId,
  includeCustom = true,
}: PromptPresetsProps) {
  // Pull custom presets matching the current category. We infer the
  // category from `label` — "system" maps to system, anything else to
  // user. SystemPromptPresets always passes label="system".
  const customCategory: "user" | "system" =
    label === "system" ? "system" : "user";
  const customPresets = usePromptStore((s) =>
    includeCustom ? s.presetsFor(customCategory, modelId) : [],
  );
  // Merge built-ins (passed in or DEFAULT_PRESETS) with custom — built-ins
  // first so the dropdown's keyboard nav still lands on them by default.
  const mergedPresets = useMemo(
    () => (customPresets.length === 0 ? presets : [...presets, ...customPresets]),
    [presets, customPresets],
  );
  if (variant === "chips") {
    return (
      <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <LabelIcon className="h-3 w-3" aria-hidden="true" />
          {label}
        </span>
        {mergedPresets.map((p) => {
          const Icon = p.icon ?? Sparkles;
          return (
            <button
              key={p.name}
              type="button"
              onClick={() => onApply(p)}
              title={p.description}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border border-border bg-card/40 px-2 py-1 text-[11px] font-medium",
                "transition-colors hover:border-primary/60 hover:bg-accent/40 hover:text-foreground",
              )}
            >
              <Icon className="h-3 w-3 text-primary" aria-hidden="true" />
              {p.name}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <PromptPresetDropdown
      presets={mergedPresets}
      onApply={onApply}
      className={className}
      label={label}
      labelIcon={LabelIcon}
    />
  );
}

function PromptPresetDropdown({
  presets,
  onApply,
  className,
  label,
  labelIcon: LabelIcon,
}: {
  presets: PromptPreset[];
  onApply: (preset: PromptPreset) => void;
  className?: string;
  label: string;
  labelIcon: React.ElementType;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  useFocusTrap(popoverRef, open);

  function pick(p: PromptPreset) {
    onApply(p);
    setOpen(false);
  }

  const { keyboardProps, getItemProps, listboxProps } = useListboxKeyboard({
    itemCount: presets.length,
    open,
    onSelect: (i) => pick(presets[i]),
    onEscape: () => setOpen(false),
  });

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className={cn("relative inline-block", className)}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Apply a ${label} preset`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border bg-card/40 px-2 py-1 text-[11px] font-medium",
          "transition-colors hover:border-primary/60 hover:bg-accent/40 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          open && "border-primary/60 bg-accent/40",
        )}
      >
        <LabelIcon className="h-3 w-3 text-primary" aria-hidden="true" />
        <span className="uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <ChevronDown className="h-3 w-3 opacity-60" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-md border border-border bg-popover shadow-2xl"
        >
          <div
            {...listboxProps}
            onKeyDown={keyboardProps.onKeyDown}
            tabIndex={0}
            className="max-h-80 overflow-y-auto p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {presets.map((p, i) => {
              const Icon = p.icon ?? Sparkles;
              const itemProps = getItemProps(i);
              return (
                <button
                  {...itemProps}
                  ref={(el) => itemProps.ref(el)}
                  key={p.name}
                  type="button"
                  onClick={() => pick(p)}
                  title={p.description}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-xs",
                    "hover:bg-accent/40 hover:text-foreground transition-colors",
                    "data-[active=true]:bg-accent/60 data-[active=true]:ring-1 data-[active=true]:ring-inset data-[active=true]:ring-primary/40",
                  )}
                >
                  <Icon
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{p.name}</span>
                    {p.description && (
                      <span className="block text-[10px] leading-snug text-muted-foreground">
                        {p.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Model-specific preset bundles
// ---------------------------------------------------------------------------
// Some specialized models — NuExtract (template-based structured extraction)
// and UniversalNER (zero-shot named-entity recognition) — have their own
// well-defined input shapes. Showing the generic Coding/Reasoning/etc.
// presets when the user has one of those selected is misleading: those
// prompts won't trigger the model's specialized capability. So when one of
// these models is active we swap the preset row for a bundle of prompts
// that match the model's expected input format.
//
// References:
//   NuExtract:    numind/NuExtract / NuExtract-1.5 / NuExtract-2.0 (HF)
//                 expects "### Template:\n{...}\n### Text:\n<source>"
//   UniversalNER: Universal-NER/UniNER-7B-* (HF)
//                 fine-tuned on a conversation where USER asks
//                 "What describes <type> in the text?" given a snippet.
// ---------------------------------------------------------------------------

const NUEXTRACT_PRESETS: PromptPreset[] = [
  {
    name: "Bio → schema",
    icon: FileSearch,
    description:
      "NuExtract template extraction — fill a JSON schema with values pulled from a free-form bio.",
    user: `### Template:
{
    "name": "",
    "age": "",
    "occupation": "",
    "company": "",
    "location": "",
    "skills": []
}
### Text:
Mira Okafor is a 34-year-old machine learning engineer at Polymath Labs in Berlin. She specializes in reinforcement learning and graph neural networks, and previously led the search ranking team at Aetheryx. Outside of work she's an avid bouldering climber.
`,
  },
  {
    name: "Product specs",
    icon: FileSearch,
    description:
      "NuExtract template extraction — pull structured product attributes from a marketing description.",
    user: `### Template:
{
    "product_name": "",
    "manufacturer": "",
    "price_usd": "",
    "weight_kg": "",
    "battery_life_hours": "",
    "ports": [],
    "release_year": ""
}
### Text:
The Zenith X1 from Lumiform Industries (announced 2025) is a 1.4 kg ultraportable laptop priced at $1,499. It packs 18 hours of battery life and ships with two Thunderbolt 5 ports, a USB-C port, and a 3.5mm audio jack.
`,
  },
  {
    name: "Recipe → JSON",
    icon: FileSearch,
    description:
      "NuExtract template extraction — convert a recipe paragraph into structured fields.",
    user: `### Template:
{
    "title": "",
    "servings": "",
    "prep_time_minutes": "",
    "cook_time_minutes": "",
    "ingredients": [
        {
            "item": "",
            "quantity": "",
            "unit": ""
        }
    ],
    "difficulty": ""
}
### Text:
Quick Lemon Garlic Pasta — Serves 4. Prep time: 10 minutes, cook time: 15 minutes. You'll need 400 g of spaghetti, 4 cloves of garlic finely minced, 1/2 cup of olive oil, the zest and juice of 2 lemons, 1 tsp of red pepper flakes, and a generous handful of fresh parsley. Easy enough for a weeknight dinner.
`,
  },
];

const UNIVERSALNER_PRESETS: PromptPreset[] = [
  {
    name: "Extract people",
    icon: Tag,
    description:
      "UniversalNER zero-shot NER — extract person mentions from a paragraph.",
    user: `Text: At the 2026 Paris Climate Forum, Dr. Anika Devereaux opened the panel alongside finance minister Klaus Verlinden. Audience questions came from journalist Mei Hoshino and activist Rafael Costa.

What describes person in the text?`,
  },
  {
    name: "Extract orgs",
    icon: Tag,
    description:
      "UniversalNER zero-shot NER — extract organizations and companies.",
    user: `Text: Bridgewater Associates and Fidelity have both reported increased exposure to AI infrastructure. Meanwhile NVIDIA shipped its newest accelerators to OpenAI, Anthropic, and the Allen Institute for AI.

What describes organization in the text?`,
  },
  {
    name: "Extract dates",
    icon: Tag,
    description:
      "UniversalNER zero-shot NER — extract date and time expressions.",
    user: `Text: The merger was announced on March 14, 2025, with shareholders voting on April 22nd. The deal closes on Q3 2026, and the integration runway extends through next summer. Earnings call: 9 AM ET tomorrow.

What describes date in the text?`,
  },
  {
    name: "Custom entity",
    icon: Tag,
    description:
      "Template you can edit — UniversalNER will extract whatever entity type you ask about.",
    user: `Text: <paste your text here>

What describes <entity type, e.g. medication, gene, vehicle> in the text?`,
  },
];

/**
 * Lookup table mapping model-id patterns to specialized preset bundles. The
 * first matching pattern wins. Anything not matching gets {@link DEFAULT_PRESETS}.
 */
const MODEL_PRESET_BUNDLES: Array<{
  match: (modelId: string) => boolean;
  presets: PromptPreset[];
  bundleLabel: string;
  bundleIcon: React.ElementType;
}> = [
  {
    match: (id) => /(^|\/)nuextract/i.test(id),
    presets: NUEXTRACT_PRESETS,
    bundleLabel: "nuextract",
    bundleIcon: FileSearch,
  },
  {
    match: (id) => /(^|\/)universalner/i.test(id),
    presets: UNIVERSALNER_PRESETS,
    bundleLabel: "universalner",
    bundleIcon: Tag,
  },
];

/**
 * Returns the right preset bundle for a given model ID, plus the bundle's
 * label/icon so callers can swap the row's chrome to match. Falls back to
 * the generic benchmark presets when no specialized bundle matches.
 */
export function getPresetsForModel(modelId: string | undefined | null): {
  presets: PromptPreset[];
  label: string;
  icon: React.ElementType;
  isModelSpecific: boolean;
} {
  if (modelId) {
    for (const b of MODEL_PRESET_BUNDLES) {
      if (b.match(modelId)) {
        return {
          presets: b.presets,
          label: b.bundleLabel,
          icon: b.bundleIcon,
          isModelSpecific: true,
        };
      }
    }
  }
  return {
    presets: DEFAULT_PRESETS,
    label: "presets",
    icon: Sparkles,
    isModelSpecific: false,
  };
}

export interface SystemPromptPresetsProps {
  /** Called with the chosen preset — wire to set your system prompt slot. */
  onApply: (preset: PromptPreset) => void;
  presets?: PromptPreset[];
  className?: string;
  /** See {@link PromptPresetsProps.variant}. Defaults to `"dropdown"`. */
  variant?: "dropdown" | "chips";
  /** See {@link PromptPresetsProps.modelId}. */
  modelId?: string;
  /** See {@link PromptPresetsProps.includeCustom}. Defaults to true. */
  includeCustom?: boolean;
}

/**
 * Thin convenience wrapper around {@link PromptPresets} pre-loaded with
 * {@link SYSTEM_PRESETS} and a "system" label. Use next to a system-prompt
 * textarea; the preset's `systemPrompt` is what you'll typically apply.
 */
export function SystemPromptPresets({
  onApply,
  presets = SYSTEM_PRESETS,
  className,
  variant,
  modelId,
  includeCustom,
}: SystemPromptPresetsProps) {
  return (
    <PromptPresets
      presets={presets}
      onApply={onApply}
      className={className}
      label="system"
      labelIcon={Shield}
      variant={variant}
      modelId={modelId}
      includeCustom={includeCustom}
    />
  );
}
