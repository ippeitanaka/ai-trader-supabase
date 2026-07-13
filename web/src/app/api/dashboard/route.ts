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
      const allowedAdjustments = new Set([0, 0.05, 0.1]);
      const gateAdjustment = allowedAdjustments.has(Number(body?.gate_adjustment))
        ? Number(body.gate_adjustment) as 0 | 0.05 | 0.10
        : undefined;
      const rawSymbolAdjustments = body?.symbol_gate_adjustments;
      const symbolGateAdjustments: Record<string, 0 | 0.05 | 0.10> = {};
      if (rawSymbolAdjustments && typeof rawSymbolAdjustments === "object" && !Array.isArray(rawSymbolAdjustments)) {
        for (const [symbol, value] of Object.entries(rawSymbolAdjustments)) {
          const normalizedSymbol = symbol.trim().toUpperCase();
          const numeric = Number(value);
          if (normalizedSymbol && allowedAdjustments.has(numeric)) {
            symbolGateAdjustments[normalizedSymbol] = numeric as 0 | 0.05 | 0.10;
          }
        }
      }
      const note = typeof body?.note === "string" ? body.note : "";
      const result = await updateTradePlanOverrides(reportId, {
        ...(status ? { status } : {}),
        ...(gateAdjustment !== undefined
          ? {
              gate_adjustment: gateAdjustment,
              gate_mode: gateAdjustment === 0.1 ? "very_cautious" : gateAdjustment === 0.05 ? "cautious" : "ai",
            }
          : {}),
        ...(rawSymbolAdjustments && typeof rawSymbolAdjustments === "object"
          ? { symbol_gate_adjustments: symbolGateAdjustments }
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
