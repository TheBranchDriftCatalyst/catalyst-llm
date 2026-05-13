# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: layout.spec.ts >> SidePanelItem collapse / expand >> intra-rail splitter appears between two expanded siblings
- Location: tests/e2e/layout.spec.ts:83:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 4
Received: 3
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "Skip to main content" [ref=e4] [cursor=pointer]:
    - /url: "#main-content"
  - banner [ref=e5]:
    - generic [ref=e6]:
      - heading "Catalyst LLM SDK · Playground" [level=1] [ref=e7]
      - navigation [ref=e8]:
        - button "Chat" [ref=e9]:
          - img [ref=e10]
          - text: Chat
        - button "Compare" [ref=e12]:
          - img [ref=e13]
          - text: Compare
        - button "Prompts" [ref=e15]:
          - img [ref=e16]
          - text: Prompts
        - button "Engine" [ref=e19]:
          - img [ref=e20]
          - text: Engine
        - button "Stats" [ref=e23]:
          - img [ref=e24]
          - text: Stats
    - generic [ref=e28]:
      - generic "Mac inference node (Ollama + vLLM-MLX) — proxied via the LiteLLM ingress" [ref=e29]:
        - generic [ref=e30]: mac
        - generic [ref=e31]: 192.168.1.33
      - navigation [ref=e32]:
        - link "LiteLLM UI" [ref=e33] [cursor=pointer]:
          - /url: http://litellm.talos00/ui
          - generic [ref=e34]: LiteLLM UI
          - img [ref=e35]
        - link "API Docs" [ref=e39] [cursor=pointer]:
          - /url: http://litellm.talos00/docs
          - generic [ref=e40]: API Docs
          - img [ref=e41]
      - generic [ref=e48]: http://litellm.talos00
  - main [ref=e49]:
    - generic [ref=e52]:
      - separator "drag to resize · double-click to reset" [ref=e53]
      - separator "drag to resize · double-click to reset" [ref=e54]
      - separator "drag to resize · double-click to reset" [ref=e55]
      - complementary [ref=e56]:
        - generic [ref=e57]:
          - generic [ref=e59]:
            - button "Drag handle Agents" [expanded] [ref=e60] [cursor=pointer]:
              - generic "Drag handle" [ref=e61]:
                - img [ref=e62]
              - img [ref=e69]
              - img [ref=e72]
              - generic [ref=e75]: Agents
              - button "Refresh /api/agents" [ref=e77]:
                - img [ref=e78]
            - generic [ref=e84]:
              - button "main Top-level chat agent loop. Dispatches tools, threads results back, and continues until the model stops emitting tool_calls." [ref=e85]:
                - generic [ref=e87]: main
                - paragraph [ref=e88]: Top-level chat agent loop. Dispatches tools, threads results back, and continues until the model stops emitting tool_calls.
              - button "extraction NER ensemble + SPO extraction pipeline. Chunks input text, runs N encoders in parallel, consensus-votes mentions, clusters near-duplicates into canonical entities, packs evidence for the SPO LLM, then extracts subject-predicate-object triples with MCP contract validation + LLM repair. Topology mirrors catalyst-data/libs/catalyst-exgraph (build_ensemble_pipeline + build_spo_pipeline). The runtime ships in catalyst-exgraph; this registration is for Engine-tab visualisation + per-node config tuning." [ref=e89]:
                - generic [ref=e91]: extraction
                - paragraph [ref=e92]: NER ensemble + SPO extraction pipeline. Chunks input text, runs N encoders in parallel, consensus-votes mentions, clusters near-duplicates into canonical entities, packs evidence for the SPO LLM, then extracts subject-predicate-object triples with MCP contract validation + LLM repair. Topology mirrors catalyst-data/libs/catalyst-exgraph (build_ensemble_pipeline + build_spo_pipeline). The runtime ships in catalyst-exgraph; this registration is for Engine-tab visualisation + per-node config tuning.
              - 'button "research Web-research council: N parallel members loop over web_search; an optional adaptive critic drives revision rounds; a fusion agent consolidates the approved drafts into one cited markdown answer. Set members.council_size=1 + critic.enabled=False for the simplest base case. web_search" [ref=e93]':
                - generic [ref=e95]: research
                - paragraph [ref=e96]: "Web-research council: N parallel members loop over web_search; an optional adaptive critic drives revision rounds; a fusion agent consolidates the approved drafts into one cited markdown answer. Set members.council_size=1 + critic.enabled=False for the simplest base case."
                - generic [ref=e98]:
                  - img [ref=e99]
                  - text: web_search
          - separator "drag to resize · double-click to reset" [ref=e101]
          - generic [ref=e103]:
            - button "Drag handle Events 0" [expanded] [ref=e104] [cursor=pointer]:
              - generic "Drag handle" [ref=e105]:
                - img [ref=e106]
              - img [ref=e113]
              - img [ref=e116]
              - generic [ref=e120]: Events
              - generic [ref=e121]: "0"
            - generic [ref=e123]:
              - paragraph [ref=e124]: EventStream — chronological + filterable. Sub-component lands next.
              - paragraph [ref=e125]: 0 buffered events for main
      - main [ref=e126]:
        - generic [ref=e127]:
          - generic [ref=e129]:
            - heading "main" [level=1] [ref=e130]:
              - img [ref=e131]
              - generic [ref=e133]: main
            - paragraph [ref=e134]: Top-level chat agent loop. Dispatches tools, threads results back, and continues until the model stops emitting tool_calls.
          - application [ref=e137]:
            - generic [ref=e139]:
              - generic:
                - generic:
                  - img
                  - img:
                    - img "Edge from __start__ to agent"
                  - img:
                    - img "Edge from agent to tools" [ref=e140] [cursor=pointer]
                  - img:
                    - img "Edge from agent to __end__" [ref=e142] [cursor=pointer]
                  - img:
                    - img "Edge from tools to agent" [ref=e144] [cursor=pointer]
                - generic:
                  - group [ref=e146] [cursor=pointer]:
                    - button "__start__" [ref=e147]:
                      - img [ref=e149]
                      - generic [ref=e151]: __start__
                  - group [ref=e152] [cursor=pointer]:
                    - 'generic "agent node: agent" [ref=e153]':
                      - generic [ref=e155]:
                        - img [ref=e156]
                        - generic [ref=e158]: agent
                        - button "Recent runs on this node" [ref=e159]:
                          - img [ref=e160]
                      - generic [ref=e164]:
                        - generic [ref=e165]:
                          - generic [ref=e166]: Model
                          - button "Select a model" [ref=e169]:
                            - img [ref=e170]
                            - generic [ref=e172]: select model
                            - img [ref=e173]
                        - generic [ref=e176]:
                          - generic [ref=e177]: Temperature
                          - slider [ref=e183]
                          - generic [ref=e184]: "0.70"
                        - generic [ref=e185]:
                          - generic [ref=e186]: Max tokens
                          - slider [ref=e192]
                          - generic [ref=e193]: "2048"
                        - generic [ref=e194]:
                          - generic [ref=e195]: Top P
                          - slider [ref=e201]
                          - generic [ref=e202]: "1.00"
                        - generic [ref=e203]:
                          - generic [ref=e204]: Recursion limit
                          - slider [ref=e210]
                          - generic [ref=e211]: "25"
                        - generic [ref=e212]:
                          - generic [ref=e213]: System prompt
                          - button "default" [ref=e214]:
                            - img [ref=e215]
                            - generic [ref=e218]: default
                  - group [ref=e220] [cursor=pointer]:
                    - 'generic "tools dispatcher: tools" [ref=e221]':
                      - generic [ref=e223]:
                        - img [ref=e224]
                        - generic [ref=e226]: tools
                        - button "Recent runs on this node" [ref=e227]:
                          - img [ref=e228]
                      - generic [ref=e232]: no tools bound
                  - group [ref=e234] [cursor=pointer]:
                    - 'generic "end: __end__" [ref=e235]':
                      - img [ref=e237]
                      - generic [ref=e240]: __end__
            - img
            - generic "Control Panel" [ref=e241]:
              - button "Zoom In" [ref=e242] [cursor=pointer]:
                - img [ref=e243]
              - button "Zoom Out" [ref=e245] [cursor=pointer]:
                - img [ref=e246]
              - button "Fit View" [ref=e248] [cursor=pointer]:
                - img [ref=e249]
      - complementary [ref=e252]:
        - generic [ref=e253]:
          - generic [ref=e255]:
            - button "Drag handle Test run main" [expanded] [ref=e256] [cursor=pointer]:
              - generic "Drag handle" [ref=e257]:
                - img [ref=e258]
              - img [ref=e265]
              - img [ref=e268]
              - generic [ref=e270]: Test run
              - generic [ref=e271]: main
            - generic [ref=e274]:
              - generic [ref=e275]:
                - textbox "Ask main something… (⌘/Ctrl+Enter)" [ref=e276]
                - generic [ref=e277]:
                  - generic [ref=e278]: model
                  - button "Select a model" [ref=e281]:
                    - img [ref=e282]
                    - generic [ref=e284]: select model
                    - img [ref=e285]
                  - button "run" [disabled]:
                    - img
                    - text: run
              - generic [ref=e290]:
                - paragraph [ref=e291]: No output yet.
                - paragraph [ref=e292]: Type a prompt above and hit run.
          - button "Drag handle Node detail" [ref=e295] [cursor=pointer]:
            - generic "Drag handle" [ref=e296]:
              - img [ref=e297]
            - img [ref=e304]
            - img [ref=e307]
            - generic [ref=e309]: Node detail
      - generic [ref=e313]:
        - button "Drag handle Terminal 0 total" [expanded] [ref=e314] [cursor=pointer]:
          - generic "Drag handle" [ref=e315]:
            - img [ref=e316]
          - img [ref=e323]
          - img [ref=e326]
          - generic [ref=e328]: Terminal
          - generic [ref=e330]: 0 total
        - generic [ref=e332]: Terminal — live token stream + reasoning. Lands next.
```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | import { EnginePage } from "./pages/EnginePage";
  3   | 
  4   | /** §A — PageShell + rail-level splitters + §B — SidePanelItem collapse. */
  5   | 
  6   | test.describe("PageShell layout", () => {
  7   |   let engine: EnginePage;
  8   | 
  9   |   test.beforeEach(async ({ page }) => {
  10  |     engine = new EnginePage(page);
  11  |     await engine.goto();
  12  |     await engine.resetState();
  13  |   });
  14  | 
  15  |   test("renders all three rails", async () => {
  16  |     await expect(engine.rail("left")).toBeVisible();
  17  |     await expect(engine.rail("right")).toBeVisible();
  18  |     await expect(engine.rail("bottom")).toBeVisible();
  19  |   });
  20  | 
  21  |   test("renders three rail-level splitters (left|center, center|right, top|bottom)", async () => {
  22  |     // 3 rail splitters + 1 intra-left (Agents vs collapsed Events shouldn't
  23  |     // produce one — both items must be EXPANDED to get an intra-rail splitter)
  24  |     // and 1 intra-right (Test run vs collapsed Node detail) = 3 total at
  25  |     // defaults. Assert at least 3 (rail-level) are present.
  26  |     const count = await engine.allSplitters().count();
  27  |     expect(count).toBeGreaterThanOrEqual(3);
  28  |   });
  29  | 
  30  |   test("rail splitters have col-resize / row-resize cursor", async ({ page }) => {
  31  |     const cursors = await page.evaluate(() => {
  32  |       const out: string[] = [];
  33  |       for (const s of document.querySelectorAll(
  34  |         '[role="separator"][title*="resize"]',
  35  |       )) {
  36  |         out.push(getComputedStyle(s).cursor);
  37  |       }
  38  |       return out;
  39  |     });
  40  |     // At least one of each axis present.
  41  |     expect(cursors.some((c) => c === "col-resize")).toBe(true);
  42  |     expect(cursors.some((c) => c === "row-resize")).toBe(true);
  43  |   });
  44  | 
  45  |   test("drag left-rail splitter widens the left rail", async () => {
  46  |     const { before, after } = await engine.dragRailSplitter("left", 80);
  47  |     // Allow ±5px slack for hit-area math.
  48  |     expect(after).toBeGreaterThanOrEqual(before + 70);
  49  |   });
  50  | 
  51  |   test("drag right-rail splitter widens the right rail", async () => {
  52  |     const { before, after } = await engine.dragRailSplitter("right", 80);
  53  |     expect(after).toBeGreaterThanOrEqual(before + 70);
  54  |   });
  55  | 
  56  |   test("drag bottom-rail splitter grows the bottom rail", async () => {
  57  |     const { before, after } = await engine.dragRailSplitter("bottom", 60);
  58  |     expect(after).toBeGreaterThanOrEqual(before + 50);
  59  |   });
  60  | });
  61  | 
  62  | test.describe("SidePanelItem collapse / expand", () => {
  63  |   let engine: EnginePage;
  64  | 
  65  |   test.beforeEach(async ({ page }) => {
  66  |     engine = new EnginePage(page);
  67  |     await engine.goto();
  68  |     await engine.resetState();
  69  |   });
  70  | 
  71  |   test("Agents is expanded by default; Events is collapsed by default", async () => {
  72  |     expect(await engine.isExpanded("engine.agents")).toBe(true);
  73  |     expect(await engine.isExpanded("engine.events")).toBe(false);
  74  |   });
  75  | 
  76  |   test("clicking the Events header expands it; clicking again collapses", async () => {
  77  |     await engine.expandItem("engine.events");
  78  |     expect(await engine.isExpanded("engine.events")).toBe(true);
  79  |     await engine.collapseItem("engine.events");
  80  |     expect(await engine.isExpanded("engine.events")).toBe(false);
  81  |   });
  82  | 
  83  |   test("intra-rail splitter appears between two expanded siblings", async () => {
  84  |     const before = await engine.allSplitters().count();
  85  |     await engine.expandItem("engine.events");
  86  |     const after = await engine.allSplitters().count();
> 87  |     expect(after).toBe(before + 1);
      |                   ^ Error: expect(received).toBe(expected) // Object.is equality
  88  |   });
  89  | 
  90  |   test("intra-rail splitter resize changes the lower item's height", async () => {
  91  |     await engine.expandItem("engine.events");
  92  |     const { before, after } = await engine.dragInterItemSplitter(
  93  |       "engine.agents",
  94  |       "engine.events",
  95  |       -100, // drag splitter UP → Events GROWS (invert: true)
  96  |     );
  97  |     expect(after).toBeGreaterThanOrEqual(before + 80);
  98  |   });
  99  | });
  100 | 
```