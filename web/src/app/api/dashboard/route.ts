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
      const status = body?.status === "paused" ? "paused" : "active";
      const note = typeof body?.note === "string" ? body.note : "";
      const result = await updateTradePlanOverrides(reportId, { status, note });
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
