import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { requestOpenAiTradePrediction } from "./prediction-request.ts";
import { isValidTradePrediction } from "./prediction-validation.ts";
const valid = { direction_prob: 0.7, win_prob: 0.6, scalp_outcomes: {
  tp_probability: 0.4, sl_probability: 0.2, timeout_win_probability: 0.2,
  timeout_loss_probability: 0.2, timeout_win_net_r: 0.2, timeout_loss_net_r: -0.2,
} };
Deno.test("invalid scalp predictions retry the second model instead of disabling scalp", async () => {
  const original = globalThis.fetch;
  try {
    for (const first of ['{', JSON.stringify({ direction_prob: 0.7, win_prob: 0.6 }),
      JSON.stringify({ ...valid, win_prob: 0.9 }), JSON.stringify({ ...valid, direction_prob: 2 })]) {
      const models: string[] = [];
      globalThis.fetch = ((_url: unknown, init: RequestInit) => {
        models.push(JSON.parse(String(init.body)).model);
        return Promise.resolve(Response.json({ model: models.at(-1), choices: [{ finish_reason: "stop", message: { content: models.length === 1 ? first : JSON.stringify(valid) } }] }));
      }) as typeof fetch;
      const result = await requestOpenAiTradePrediction("system", "prompt", {
        models: ["primary", "backup"], apiKey: "test", timeoutMs: 100,
        validate: value => isValidTradePrediction(value, true, 1.1, 0.02),
      });
      assertEquals(result?.model, "backup");
      assertEquals(models, ["primary", "backup"]);
    }
  } finally { globalThis.fetch = original; }
});
Deno.test("all invalid responses remain unavailable and standard mode needs no timed outcomes", async () => {
  assertEquals(isValidTradePrediction({ direction_prob: 0.7, win_prob: 0.6 }, false, 1.1, 0.02), true);
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(Response.json({ choices: [{ finish_reason: "stop", message: { content: '{}' } }] }))) as typeof fetch;
  try {
    assertEquals(await requestOpenAiTradePrediction("s", "p", {
      models: ["primary", "backup"], apiKey: "test", timeoutMs: 100,
      validate: value => isValidTradePrediction(value, true, 1.1, 0.02),
    }), null);
  } finally { globalThis.fetch = original; }
});
Deno.test("timeout retries within the per-model deadline", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = ((_url: unknown, init: RequestInit) => {
    if (++calls === 1) return new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("timeout"))));
    return Promise.resolve(Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(valid) } }] }));
  }) as typeof fetch;
  try {
    const result = await requestOpenAiTradePrediction("s", "p", { models: ["primary", "backup"], apiKey: "test", timeoutMs: 5, validate: value => isValidTradePrediction(value, true, 1.1, 0.02) });
    assertEquals(result?.model, "backup");
  } finally { globalThis.fetch = original; }
});
