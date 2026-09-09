import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { requestPairSelection } from "./index.ts";
Deno.test("truncated JSON retries fallback and records failure", async () => {
  const original = globalThis.fetch;
  const failures: string[] = [];
  let calls = 0;
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({model:"actual-model",choices:[{finish_reason:++calls === 1 ? "length" : "stop",message:{content:'{"selected_pairs":[]}'}}]})))) as typeof fetch;
  try {
    const result = await requestPairSelection("test", {models:["first","second"],failures});
    assertEquals(calls,2);
    assertEquals(result?.model,"actual-model");
    assertEquals(failures,["first:invalid_json_or_length"]);
  } finally { globalThis.fetch = original; }
});
Deno.test("provider failures do not masquerade as AI selections", async () => {
  const original = globalThis.fetch;
  const failures: string[] = [];
  globalThis.fetch = (() => Promise.resolve(new Response('{}',{status:401}))) as typeof fetch;
  try {
    assertEquals(await requestPairSelection("test",{models:["test"],failures}),null);
    assertEquals(failures,["test:http_401"]);
  } finally { globalThis.fetch = original; }
});
