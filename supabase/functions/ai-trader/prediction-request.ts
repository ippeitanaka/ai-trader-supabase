export async function requestOpenAiTradePrediction(system: string, prompt: string, options: { models: string[]; apiKey: string; timeoutMs: number; validate: (value: unknown) => boolean }): Promise<{ content: string; model: string } | null> {
  const models = [...new Set(options.models.filter(Boolean))];
  const timeoutMs = options.timeoutMs;

  for (const model of models) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const isReasoningModel = /^gpt-[56]/i.test(model);
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${options.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          ...(isReasoningModel
            ? { reasoning_effort: "low", max_completion_tokens: 2000 }
            : { temperature: 0.2, max_tokens: 1000 }),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[AI] OpenAI ${model} error: ${response.status} - ${errorText}`);
        continue;
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (data?.choices?.[0]?.finish_reason === "stop" && !data?.choices?.[0]?.message?.refusal && typeof content === "string" && content.trim()) {
        // Validate before accepting a provider: malformed outcomes must try the next model.
        try {
          const match = content.match(/\{[\s\S]*\}/);
          if (match && options.validate(JSON.parse(match[0]))) return { content, model: data.model ?? model };
        } catch { /* Invalid JSON is retryable through the next provider. */ }
        console.warn(`[AI] OpenAI ${model} invalid prediction; trying next model`);
        continue;
      }
      console.error(`[AI] OpenAI ${model} returned no content`);
    } catch (error) {
      console.error(`[AI] OpenAI ${model} exception:`, error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return null;
}

