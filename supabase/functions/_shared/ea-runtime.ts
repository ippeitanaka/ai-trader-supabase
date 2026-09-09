export type EaStrategyMode = "standard" | "scalp";

export type EaSessionOverride = {
  mode: "custom" | "all_day";
  timezone: "Asia/Tokyo";
  windows?: Array<{ start_jst: string; end_jst: string }>;
};

export type EaRuntimeSettings = {
  symbol: string;
  strategy_mode: EaStrategyMode;
  min_win_prob: number | null;
  session_override: EaSessionOverride | null;
  updated_at: string;
};

export type EaInstance = {
  id: string;
  symbol: string;
  strategy_mode: EaStrategyMode;
  timeframe: string;
  ea_version: string;
  last_seen_at: string;
  attached: boolean;
  broker_connected: boolean;
  auto_trading_enabled: boolean;
  current_positions: number;
  base_lot_size: number;
  max_open_trades: number;
};

export function runtimeKey(symbol: string, mode: EaStrategyMode): string {
  return `${symbol.trim().toUpperCase()}:${mode}`;
}

export function parseRuntimeIdentity(value: Record<string, unknown>): { symbol: string; strategy_mode: EaStrategyMode } {
  const symbol = typeof value.symbol === "string" ? value.symbol.trim().toUpperCase() : "";
  if (!/^[A-Z0-9._#-]{1,40}$/.test(symbol)) throw new Error("Invalid symbol");
  const mode = value.strategy_mode;
  if (mode !== "standard" && mode !== "scalp") throw new Error("Invalid strategy mode");
  return { symbol, strategy_mode: mode };
}

export function parseRuntimeSettings(value: Record<string, unknown>) {
  const identity = parseRuntimeIdentity(value);
  const probability = value.min_win_prob;
  if (probability !== null && (
    typeof probability !== "number" || !Number.isFinite(probability) ||
    probability < 0.50 || probability > 0.90 ||
    Math.abs(probability * 100 - Math.round(probability * 100)) > 1e-8
  )) throw new Error("勝率ゲートは50%から90%の1%刻みで指定してください。");

  let session: EaSessionOverride | null = null;
  if (value.session_override !== null) {
    const raw = value.session_override;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid session");
    const input = raw as Record<string, unknown>;
    if (input.timezone !== "Asia/Tokyo") throw new Error("取引時間は日本時間で指定してください。");
    if (input.mode === "all_day") session = { mode: "all_day", timezone: "Asia/Tokyo" };
    else if (input.mode === "custom" && Array.isArray(input.windows) && input.windows.length >= 1 && input.windows.length <= 3) {
      const validTime = (time: unknown): time is string => typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
      const windows = input.windows.map((window: unknown) => {
        if (!window || typeof window !== "object") throw new Error("Invalid session window");
        const { start_jst, end_jst } = window as Record<string, unknown>;
        if (!validTime(start_jst) || !validTime(end_jst) || start_jst === end_jst) {
          throw new Error("開始・終了時刻を指定してください。終日の場合は終日許可を選択してください。");
        }
        return { start_jst, end_jst };
      });
      session = { mode: "custom", timezone: "Asia/Tokyo", windows };
    } else throw new Error("Invalid session mode");
  }
  return { ...identity, min_win_prob: probability as number | null, session_override: session };
}

export function runtimeBlockReasons(
  settings: Pick<EaRuntimeSettings, "min_win_prob" | "session_override"> | null | undefined,
  probability: number,
  now = new Date(),
): string[] {
  if (!settings) return [];
  const reasons: string[] = [];
  if (settings.min_win_prob !== null && probability < settings.min_win_prob) reasons.push("ea_manual_gate");
  if (settings.session_override?.mode === "custom") {
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const current = jst.getUTCHours() * 60 + jst.getUTCMinutes();
    const toMinute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const inside = settings.session_override.windows?.some(({ start_jst, end_jst }) => {
      const start = toMinute(start_jst), end = toMinute(end_jst);
      return start < end ? current >= start && current < end : current >= start || current < end;
    });
    if (!inside) reasons.push("ea_manual_session_closed");
  }
  return reasons;
}

export function overlayRuntimeOverrides(
  overrides: Record<string, unknown> | undefined,
  symbol: string,
  settings: EaRuntimeSettings | null | undefined,
): Record<string, unknown> {
  const result = { ...overrides };
  const key = symbol.toUpperCase();
  if (settings?.min_win_prob != null) {
    result.symbol_min_win_probs = { ...(result.symbol_min_win_probs as object ?? {}), [key]: settings.min_win_prob };
  }
  if (settings?.session_override) {
    result.symbol_session_overrides = { ...(result.symbol_session_overrides as object ?? {}), [key]: settings.session_override };
  }
  return result;
}

export function instanceStatus(instance: EaInstance, now = new Date()): "online" | "trading_disabled" | "disconnected" | "stale" | "detached" {
  if (!instance.attached) return "detached";
  const seen = Date.parse(instance.last_seen_at);
  if (!Number.isFinite(seen) || now.getTime() - seen > 6 * 60 * 1000) return "stale";
  if (!instance.broker_connected) return "disconnected";
  return instance.auto_trading_enabled ? "online" : "trading_disabled";
}

export async function parseHeartbeat(body: Record<string, unknown>, now = new Date()): Promise<EaInstance> {
  const identity = parseRuntimeIdentity({ symbol: body.sym, strategy_mode: body.strategy_mode });
  if (typeof body.instance_id !== "string" || body.instance_id.length < 1 || body.instance_id.length > 256) throw new Error("Invalid instance ID");
  for (const field of ["attached", "broker_connected", "auto_trading_enabled"]) {
    if (typeof body[field] !== "boolean") throw new Error(`Invalid ${field}`);
  }
  for (const field of ["current_positions", "max_open_trades"]) {
    if (typeof body[field] !== "number" || !Number.isInteger(body[field]) || Number(body[field]) < 0 || Number(body[field]) > 1000) throw new Error(`Invalid ${field}`);
  }
  if (Number(body.max_open_trades) < 1) throw new Error("Invalid max_open_trades");
  if (typeof body.base_lot_size !== "number" || !Number.isFinite(body.base_lot_size) || body.base_lot_size <= 0) throw new Error("Invalid lot size");
  if (typeof body.version !== "string" || !/^[\d.]{1,24}$/.test(body.version)) throw new Error("Invalid EA version");
  // Keep terminal/account identifiers out of stored records and dashboard responses.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.instance_id));
  const id = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    ...identity, id, timeframe: identity.strategy_mode === "scalp" ? "M5" : "M15",
    ea_version: body.version, last_seen_at: now.toISOString(),
    attached: body.attached as boolean, broker_connected: body.broker_connected as boolean,
    auto_trading_enabled: body.auto_trading_enabled as boolean,
    current_positions: body.current_positions as number, max_open_trades: body.max_open_trades as number,
    base_lot_size: body.base_lot_size,
  };
}
