import { NextResponse } from "next/server";
import { getDashboardData, triggerPairSelectorRefresh, updateTradePlanOverrides } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") ?? "30";
    const data = await getDashboardData(period);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "refresh";

    if (action === "plan_override") {
      const reportId = Number(body?.report_id);
      if (!Number.isFinite(reportId) || reportId <= 0) {
        return NextResponse.json({ error: "report_id is required" }, { status: 400 });
      }
      const status = body?.status === "paused" ? "paused" : body?.status === "active" ? "active" : undefined;
      const allowedAdjustments = new Set([-0.1, -0.05, 0, 0.05, 0.1]);
      const gateAdjustment = allowedAdjustments.has(Number(body?.gate_adjustment))
        ? Number(body.gate_adjustment) as -0.10 | -0.05 | 0 | 0.05 | 0.10
        : undefined;
      const rawSymbolAdjustments = body?.symbol_gate_adjustments;
      const symbolGateAdjustments: Record<string, -0.10 | -0.05 | 0 | 0.05 | 0.10> = {};
      if (rawSymbolAdjustments && typeof rawSymbolAdjustments === "object" && !Array.isArray(rawSymbolAdjustments)) {
        for (const [symbol, value] of Object.entries(rawSymbolAdjustments)) {
          const normalizedSymbol = symbol.trim().toUpperCase();
          const numeric = Number(value);
          if (normalizedSymbol && allowedAdjustments.has(numeric)) {
            symbolGateAdjustments[normalizedSymbol] = numeric as -0.10 | -0.05 | 0 | 0.05 | 0.10;
          }
        }
      }
      const rawSessionOverrides = body?.symbol_session_overrides;
      const symbolSessionOverrides: Record<string, {
        mode: "custom" | "all_day";
        timezone: "Asia/Tokyo";
        windows?: Array<{ label?: string; start_jst: string; end_jst: string }>;
      }> = {};
      if (rawSessionOverrides && typeof rawSessionOverrides === "object" && !Array.isArray(rawSessionOverrides)) {
        const validTime = (value: unknown) => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
        for (const [symbol, rawOverride] of Object.entries(rawSessionOverrides)) {
          const normalizedSymbol = symbol.trim().toUpperCase();
          if (!normalizedSymbol || !rawOverride || typeof rawOverride !== "object" || Array.isArray(rawOverride)) continue;
          const override = rawOverride as Record<string, unknown>;
          if (override.mode === "all_day") {
            symbolSessionOverrides[normalizedSymbol] = {
              mode: "all_day",
              timezone: "Asia/Tokyo",
            };
            continue;
          }
          const windows = Array.isArray(override.windows)
            ? override.windows
                .filter((window): window is Record<string, unknown> => Boolean(window) && typeof window === "object" && !Array.isArray(window))
                .map((window) => ({
                  label: typeof window.label === "string" ? window.label.slice(0, 40) : "手動設定",
                  start_jst: window.start_jst,
                  end_jst: window.end_jst,
                }))
                .filter((window): window is { label: string; start_jst: string; end_jst: string } =>
                  validTime(window.start_jst) && validTime(window.end_jst)
                )
                .slice(0, 3)
            : [];
          if (override.mode === "custom" && windows.length > 0) {
            symbolSessionOverrides[normalizedSymbol] = {
              mode: "custom",
              timezone: "Asia/Tokyo",
              windows,
            };
          }
        }
      }
      const note = typeof body?.note === "string" ? body.note : "";
      const result = await updateTradePlanOverrides(reportId, {
        ...(status ? { status } : {}),
        ...(gateAdjustment !== undefined
          ? {
              gate_adjustment: gateAdjustment,
              gate_mode: gateAdjustment === 0.1
                ? "very_cautious"
                : gateAdjustment === 0.05
                ? "cautious"
                : gateAdjustment === -0.1
                ? "more_active"
                : gateAdjustment === -0.05
                ? "active"
                : "ai",
            }
          : {}),
        ...(rawSymbolAdjustments && typeof rawSymbolAdjustments === "object"
          ? { symbol_gate_adjustments: symbolGateAdjustments }
          : {}),
        ...(rawSessionOverrides && typeof rawSessionOverrides === "object"
          ? { symbol_session_overrides: symbolSessionOverrides }
          : {}),
        note,
      });
      return NextResponse.json({ ok: true, result }, { status: 200 });
    }

    const cadence = typeof body?.cadence === "string" ? body.cadence : undefined;
    const lookbackDays = Number.isFinite(body?.lookback_days) ? Number(body.lookback_days) : undefined;
    const topN = Number.isFinite(body?.top_n) ? Number(body.top_n) : undefined;

    const result = await triggerPairSelectorRefresh({ cadence, lookbackDays, topN });
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
