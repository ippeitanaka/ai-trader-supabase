import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ??
  "";

const supabase = createClient(
  SUPABASE_URL || "http://127.0.0.1",
  SUPABASE_SERVICE_ROLE_KEY || "invalid",
);

function htmlHeaders() {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Language": "ja",
  });
}

function htmlResponse(body: string, status = 200) {
  return new Response(new TextEncoder().encode(body), {
    status,
    headers: htmlHeaders(),
  });
}

function escapeHtml(input: unknown): string {
  return String(input ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function badgeClass(confidence: string) {
  switch (confidence) {
    case "high":
      return "badge high";
    case "medium":
      return "badge medium";
    default:
      return "badge low";
  }
}

function confidenceLabel(confidence: string) {
  switch (confidence) {
    case "high":
      return "信頼度 高";
    case "medium":
      return "信頼度 中";
    default:
      return "信頼度 低";
  }
}

function cadenceLabel(cadence: string) {
  switch (cadence) {
    case "weekly":
      return "週次";
    case "daily":
      return "日次";
    default:
      return cadence;
  }
}

function formatNumber(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return new Intl.NumberFormat("ja-JP").format(Math.round(num));
}

function formatSignedNumber(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  const prefix = num > 0 ? "+" : "";
  return `${prefix}${new Intl.NumberFormat("ja-JP").format(Math.round(num))}`;
}

function translateCaution(caution: unknown) {
  switch (String(caution ?? "")) {
    case "sample_small":
      return "サンプル数が少ないため参考度は低めです";
    default:
      return String(caution ?? "");
  }
}

function formatReason(reason: unknown) {
  const text = String(reason ?? "").trim();
  const match = text.match(/recent real=(\d+), win_rate=([\d.]+)%, pnl=([-\d.]+)/i);
  if (match) {
    const [, trades, winRate, pnl] = match;
    return `直近実トレード ${formatNumber(trades)}回 / 勝率 ${winRate}% / 損益 ${formatSignedNumber(pnl)}`;
  }

  if (text === "Fallback selection based on recent realized performance and sample size.") {
    return "直近の実トレード成績とサンプル数をもとに選定しています。";
  }

  return text;
}

function renderPairCard(pair: any, tone: "good" | "neutral" | "bad") {
  const symbol = escapeHtml(pair?.symbol);
  const score = escapeHtml(pair?.score ?? "-");
  const confidence = String(pair?.confidence ?? "low");
  const reason = escapeHtml(formatReason(pair?.reason ?? ""));
  const caution = pair?.caution ? `<div class="caution">注意: ${escapeHtml(translateCaution(pair.caution))}</div>` : "";
  return `
    <article class="pair-card ${tone}">
      <div class="pair-head">
        <h3>${symbol}</h3>
        <div class="score">${score}</div>
      </div>
      <div class="meta-row">
        <span class="${badgeClass(confidence)}">${escapeHtml(confidenceLabel(confidence))}</span>
      </div>
      <p class="reason">${reason}</p>
      ${caution}
    </article>
  `;
}

function renderSection(title: string, subtitle: string, pairs: any[], tone: "good" | "neutral" | "bad") {
  const cards = pairs.length > 0
    ? pairs.map((pair) => renderPairCard(pair, tone)).join("\n")
    : `<div class="empty">該当なし</div>`;
  return `
    <section class="group">
      <div class="group-head">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(subtitle)}</p>
      </div>
      <div class="card-grid">
        ${cards}
      </div>
    </section>
  `;
}

function renderPage(report: any) {
  const generatedAt = report?.generated_at ? new Date(report.generated_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "-";
  const cadence = escapeHtml(cadenceLabel(String(report?.cadence ?? "daily")));
  const timeframe = escapeHtml(report?.timeframe ?? "M15");
  const lookbackDays = escapeHtml(report?.lookback_days ?? "-");
  const summary = escapeHtml(formatReason(report?.summary ?? ""));
  const topPicks = Array.isArray(report?.top_picks) ? report.top_picks : [];
  const recommended = Array.isArray(report?.recommended_pairs) ? report.recommended_pairs : [];
  const neutral = Array.isArray(report?.neutral_pairs) ? report.neutral_pairs : [];
  const avoided = Array.isArray(report?.avoided_pairs) ? report.avoided_pairs : [];
  const jsonUrl = `${SUPABASE_URL}/functions/v1/pair-selector?limit=1`;

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>今日の推奨ペア</title>
  <style>
    :root {
      --bg: #f3efe6;
      --paper: #fffaf0;
      --ink: #1f1a17;
      --muted: #6e6256;
      --line: #d5c6b7;
      --good: #dcefdc;
      --good-border: #7aa57a;
      --neutral: #efe6d4;
      --neutral-border: #a68e67;
      --bad: #f3d9d9;
      --bad-border: #b56b6b;
      --accent: #a54b2a;
      --shadow: 0 10px 30px rgba(45, 31, 18, 0.10);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Hiragino Mincho ProN", "Yu Mincho", serif;
      background:
        radial-gradient(circle at top right, rgba(165,75,42,0.12), transparent 30%),
        linear-gradient(180deg, #f7f2e9 0%, var(--bg) 100%);
      color: var(--ink);
    }
    .wrap {
      width: min(1120px, calc(100% - 32px));
      margin: 32px auto 56px;
    }
    .hero {
      background: rgba(255,250,240,0.86);
      border: 1px solid var(--line);
      border-radius: 28px;
      padding: 28px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(10px);
    }
    .eyebrow {
      font-size: 12px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 8px;
    }
    h1 {
      font-size: clamp(30px, 4vw, 54px);
      margin: 0 0 12px;
      line-height: 1.04;
    }
    .summary {
      font-size: 18px;
      line-height: 1.7;
      color: var(--muted);
      margin: 0 0 20px;
      max-width: 70ch;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .meta-chip {
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 10px 14px;
      font-size: 14px;
    }
    .legend {
      margin-top: 18px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
    }
    .legend-card {
      background: rgba(255,255,255,0.7);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 14px 16px;
    }
    .legend-card strong {
      display: block;
      margin-bottom: 6px;
      font-size: 14px;
    }
    .legend-card p {
      margin: 0;
      font-size: 13px;
      line-height: 1.6;
      color: var(--muted);
    }
    .actions {
      margin-top: 16px;
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .button {
      display: inline-block;
      text-decoration: none;
      background: var(--accent);
      color: #fff;
      padding: 12px 16px;
      border-radius: 999px;
      font-size: 14px;
    }
    .button.secondary {
      background: transparent;
      color: var(--accent);
      border: 1px solid var(--accent);
    }
    .group {
      margin-top: 26px;
      background: rgba(255,250,240,0.82);
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 22px;
      box-shadow: var(--shadow);
    }
    .group-head h2 {
      margin: 0 0 6px;
      font-size: 28px;
    }
    .group-head p {
      margin: 0 0 18px;
      color: var(--muted);
    }
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
    }
    .pair-card {
      border-radius: 20px;
      padding: 18px;
      border: 1px solid transparent;
      min-height: 170px;
    }
    .pair-card.good { background: var(--good); border-color: var(--good-border); }
    .pair-card.neutral { background: var(--neutral); border-color: var(--neutral-border); }
    .pair-card.bad { background: var(--bad); border-color: var(--bad-border); }
    .pair-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
    }
    .pair-head h3 {
      margin: 0;
      font-size: 24px;
    }
    .score {
      font-size: 34px;
      font-weight: 700;
      line-height: 1;
    }
    .meta-row { margin-top: 10px; }
    .badge {
      display: inline-block;
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      background: rgba(255,255,255,0.7);
    }
    .badge.high { color: #1d6c1d; }
    .badge.medium { color: #8a660d; }
    .badge.low { color: #8a3d3d; }
    .reason {
      margin: 14px 0 0;
      line-height: 1.6;
      font-size: 15px;
    }
    .caution {
      margin-top: 10px;
      font-size: 13px;
      color: var(--muted);
    }
    .empty {
      border: 1px dashed var(--line);
      border-radius: 16px;
      padding: 20px;
      color: var(--muted);
      background: rgba(255,255,255,0.45);
    }
    @media (max-width: 700px) {
      .wrap { width: min(100% - 20px, 1120px); margin: 18px auto 34px; }
      .hero, .group { padding: 18px; border-radius: 18px; }
      .pair-head h3 { font-size: 20px; }
      .score { font-size: 28px; }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <div class="eyebrow">AI Pair Selector</div>
      <h1>今日の推奨ペア</h1>
      <p class="summary">${summary}</p>
      <div class="meta">
        <div class="meta-chip">生成日時: ${escapeHtml(generatedAt)}</div>
        <div class="meta-chip">時間足: ${timeframe}</div>
        <div class="meta-chip">周期: ${cadence}</div>
        <div class="meta-chip">参照期間: ${lookbackDays}日</div>
      </div>
      <div class="legend">
        <div class="legend-card">
          <strong>スコア</strong>
          <p>0から100で相性を表します。高いほど、今のロジックと直近成績の相性が良い想定です。</p>
        </div>
        <div class="legend-card">
          <strong>信頼度</strong>
          <p>直近の実トレード件数が多いほど高くなります。低い場合は参考情報として見てください。</p>
        </div>
        <div class="legend-card">
          <strong>見方</strong>
          <p>おすすめを優先し、避けるは今日のEAセット対象から外す、という使い方を想定しています。</p>
        </div>
      </div>
      <div class="actions">
        <a class="button" href="" onclick="location.reload(); return false;">再読み込み</a>
        <a class="button secondary" href="${escapeHtml(jsonUrl)}" target="_blank" rel="noreferrer">JSONを開く</a>
      </div>
    </section>
    ${renderSection("おすすめ", "今日EAを優先的にセットする候補", recommended, "good")}
    ${renderSection("中立", "データ不足または優位性が弱い候補", neutral, "neutral")}
    ${renderSection("避ける", "直近で相性が悪く、今日は外したい候補", avoided, "bad")}
    ${renderSection("最優先", "今すぐ見るべき上位候補", topPicks, "good")}
  </main>
</body>
</html>`;
}

function errorPage(message: string) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pair Selector</title></head><body style="font-family: sans-serif; padding: 24px;"><h1>表示できません</h1><p>${escapeHtml(message)}</p></body></html>`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: htmlHeaders() });
  }

  if (req.method !== "GET") {
    return htmlResponse(errorPage("このページはGETのみ対応です"), 405);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return htmlResponse(errorPage("Supabase環境変数が不足しています"), 500);
  }

  try {
    const { data, error } = await supabase
      .from("pair_selection_reports")
      .select("id, created_at, generated_at, cadence, timeframe, lookback_days, top_n, summary, selected_pairs, avoided_pairs, candidate_stats")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return htmlResponse(errorPage("まだペア選定レポートがありません"), 404);
    }

    const candidateStats = Array.isArray(data.candidate_stats) ? data.candidate_stats : [];
    const selectedPairs = Array.isArray(data.selected_pairs) ? data.selected_pairs : [];
    const avoidedPairs = Array.isArray(data.avoided_pairs) ? data.avoided_pairs : [];

    const enriched = {
      ...data,
      top_picks: selectedPairs.slice(0, Math.min(Number(data.top_n ?? 3), selectedPairs.length)),
      recommended_pairs: selectedPairs,
      avoided_pairs: avoidedPairs,
      neutral_pairs: candidateStats
        .filter((s: any) => {
          const symbol = s?.symbol;
          return !selectedPairs.some((p: any) => p?.symbol === symbol) && !avoidedPairs.some((p: any) => p?.symbol === symbol);
        })
        .map((s: any) => ({
          symbol: s.symbol,
          score: Math.round(Number(s.compatibility_score ?? 50)),
          confidence: s.real_trades >= 12 ? "high" : s.real_trades >= 6 ? "medium" : "low",
          reason: `recent real=${s.real_trades ?? 0}, win_rate=${(((Number(s.real_win_rate) || 0) * 100)).toFixed(1)}%, pnl=${(Number(s.real_total_profit_loss) || 0).toFixed(0)}`,
          caution: (Number(s.real_trades) || 0) < 5 ? "sample_small" : undefined,
        })),
    };

    return htmlResponse(renderPage(enriched), 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return htmlResponse(errorPage(message), 500);
  }
});
