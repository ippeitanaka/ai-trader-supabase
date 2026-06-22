import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard";

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
