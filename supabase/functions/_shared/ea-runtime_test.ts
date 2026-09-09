import { assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { instanceStatus, overlayRuntimeOverrides, parseHeartbeat, parseRuntimeSettings, runtimeBlockReasons, runtimeKey, type EaRuntimeSettings } from "./ea-runtime.ts";

const base = { symbol: "XAUUSD", strategy_mode: "scalp", min_win_prob: 0.63, session_override: null };
const settings = { ...parseRuntimeSettings(base), updated_at: "2026-09-09T00:00:00Z" };

Deno.test("manual probability supports 1pt steps and explicit inheritance", () => {
  for (let percent = 50; percent <= 90; percent++) assertEquals(parseRuntimeSettings({ ...base, min_win_prob: percent / 100 }).min_win_prob, percent / 100);
  assertEquals(parseRuntimeSettings({ ...base, min_win_prob: null }).min_win_prob, null);
  for (const value of [0.49, 0.91, 0.625, NaN, "0.60", undefined]) assertThrows(() => parseRuntimeSettings({ ...base, min_win_prob: value }));
});

Deno.test("runtime identity separates standard/scalp and rejects unsupported modes", () => {
  assertEquals(runtimeKey("xauusd", "scalp"), "XAUUSD:scalp");
  assertEquals(runtimeKey("XAUUSD", "standard"), "XAUUSD:standard");
  assertThrows(() => parseRuntimeSettings({ ...base, strategy_mode: "unknown" }));
  assertThrows(() => parseRuntimeSettings({ ...base, symbol: "XAUUSD&symbol=BTCUSD" }));
});

Deno.test("manual limits work without daily plan membership", () => {
  assertEquals(runtimeBlockReasons(settings, 0.629), ["ea_manual_gate"]);
  assertEquals(runtimeBlockReasons(settings, 0.63), []);
  assertEquals(runtimeBlockReasons(null, 0.40), []);
});

Deno.test("JST session is start-inclusive, end-exclusive, and crosses midnight", () => {
  const config = { ...settings, session_override: { mode: "custom", timezone: "Asia/Tokyo", windows: [{ start_jst: "22:00", end_jst: "07:00" }] } } as EaRuntimeSettings;
  assertEquals(runtimeBlockReasons(config, 0.7, new Date("2026-09-09T12:59:00Z")), ["ea_manual_session_closed"]);
  assertEquals(runtimeBlockReasons(config, 0.7, new Date("2026-09-09T13:00:00Z")), []);
  assertEquals(runtimeBlockReasons(config, 0.7, new Date("2026-09-09T21:59:00Z")), []);
  assertEquals(runtimeBlockReasons(config, 0.7, new Date("2026-09-09T22:00:00Z")), ["ea_manual_session_closed"]);
});

Deno.test("multiple JST windows and all-day override retain probability gate", () => {
  const config = { ...settings, ...parseRuntimeSettings({ ...base, session_override: { mode: "custom", timezone: "Asia/Tokyo", windows: [{ start_jst: "07:00", end_jst: "10:00" }, { start_jst: "16:00", end_jst: "20:00" }] } }) };
  assertEquals(runtimeBlockReasons(config, 0.7, new Date("2026-09-09T07:00:00Z")), []);
  assertEquals(runtimeBlockReasons(config, 0.7, new Date("2026-09-09T03:00:00Z")), ["ea_manual_session_closed"]);
  assertEquals(runtimeBlockReasons({ ...config, session_override: { mode: "all_day", timezone: "Asia/Tokyo" } }, 0.60), ["ea_manual_gate"]);
});

Deno.test("invalid or ambiguous session settings are rejected", () => {
  for (const session of [undefined, {}, { mode: "all_day", timezone: "UTC" }, { mode: "custom", timezone: "Asia/Tokyo", windows: [] }, { mode: "custom", timezone: "Asia/Tokyo", windows: [{ start_jst: "24:00", end_jst: "07:00" }] }, { mode: "custom", timezone: "Asia/Tokyo", windows: [{ start_jst: "07:00", end_jst: "07:00" }] }]) {
    assertThrows(() => parseRuntimeSettings({ ...base, session_override: session }));
  }
});

Deno.test("runtime overrides lower a daily gate without touching pause or other symbols", () => {
  const plan = { status: "paused", symbol_min_win_probs: { XAUUSD: 0.75, BTCUSD: 0.70 }, symbol_session_overrides: { XAUUSD: { mode: "custom" } } };
  const merged = overlayRuntimeOverrides(plan, "XAUUSD", { ...settings, min_win_prob: 0.60, session_override: { mode: "all_day", timezone: "Asia/Tokyo" } });
  assertEquals(merged.status, "paused");
  assertEquals(merged.symbol_min_win_probs, { XAUUSD: 0.60, BTCUSD: 0.70 });
  assertEquals(merged.symbol_session_overrides, { XAUUSD: { mode: "all_day", timezone: "Asia/Tokyo" } });
  assertEquals(plan.symbol_min_win_probs.XAUUSD, 0.75);
  assertEquals(overlayRuntimeOverrides(plan, "XAUUSD", { ...settings, min_win_prob: null }), plan);
});

const heartbeat = { instance_id: "private-terminal-and-chart", sym: "xauusd", strategy_mode: "scalp", version: "2.2.0", attached: true, broker_connected: true, auto_trading_enabled: true, current_positions: 0, max_open_trades: 1, base_lot_size: 0.10 };

Deno.test("heartbeat uses server time, hashes identity, and cannot modify settings", async () => {
  const instance = await parseHeartbeat({ ...heartbeat, min_win_prob: 0.10, last_seen_at: "2099-01-01T00:00:00Z" }, new Date("2026-09-09T01:00:00Z"));
  assertEquals(instance.last_seen_at, "2026-09-09T01:00:00.000Z");
  assertEquals(instance.id.length, 64);
  assertEquals("instance_id" in instance, false);
  assertEquals("min_win_prob" in instance, false);
  assertEquals(instance.timeframe, "M5");
  assertEquals(instance.symbol, "XAUUSD");
  assertEquals((await parseHeartbeat(heartbeat)).id, instance.id);
});

Deno.test("stale or disabled EA never displays as live", async () => {
  const time = new Date("2026-09-09T01:00:00Z");
  const instance = await parseHeartbeat(heartbeat, time);
  assertEquals(instanceStatus(instance, time), "online");
  assertEquals(instanceStatus({ ...instance, auto_trading_enabled: false }, time), "trading_disabled");
  assertEquals(instanceStatus({ ...instance, broker_connected: false }, time), "disconnected");
  assertEquals(instanceStatus(instance, new Date(time.getTime() + 6 * 60 * 1000 + 1)), "stale");
  assertEquals(instanceStatus({ ...instance, attached: false }, time), "detached");
  await assertRejects(() => parseHeartbeat({ ...heartbeat, auto_trading_enabled: "true" }));
});
