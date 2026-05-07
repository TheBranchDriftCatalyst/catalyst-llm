// Node smoke script — run against a live LiteLLM proxy:
//
//   LITELLM_BASE_URL=http://localhost:4000 LITE_LLM_KEY=sk-…  yarn smoke
//
// Exits non-zero on failure so it can gate a release.

import { CatalystLLMClient } from "../src/client/index.js";

async function main() {
  const client = new CatalystLLMClient();
  const ok = await client.verifyConnection();
  console.log("verifyConnection:", ok);
  if (!ok) process.exit(1);

  const models = await client.getModels();
  console.log("getModels:", models.length, "models");
  if (models.length === 0) process.exit(1);

  const routed = await client.getModelsWithRouting();
  const groups = routed.reduce<Record<string, number>>((acc, m) => {
    const t = m.endpoint?.type ?? "unknown";
    acc[t] = (acc[t] ?? 0) + 1;
    return acc;
  }, {});
  console.log("getModelsWithRouting groups:", groups);

  const chatModel = models[0];
  const chunks: string[] = [];
  for await (const chunk of client.streamChat({
    model: chatModel,
    messages: [{ role: "user", content: "Say hi in five words." }],
    params: { max_tokens: 32, temperature: 0 },
  })) {
    if (chunk.done) {
      console.log("\nstreamChat finish_reason:", chunk.meta.finish_reason);
      break;
    }
    chunks.push(chunk.delta);
    process.stdout.write(chunk.delta);
  }
  if (chunks.length === 0) {
    console.error("streamChat produced no chunks");
    process.exit(1);
  }
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
