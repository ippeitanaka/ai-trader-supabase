// supabase/functions/ea-log/index.ts
// -------------------------------------------------------------
// MQL5 からの POST を安全に受け取り、ea_logs に UPSERT する関数。
// ・JSONは text() で受けてクリーンアップ後に safeJsonParse
// ・bar_ts/at を ISO に正規化
// ・onConflict: bar_ts,sym,tf,account_login で重複吸収
// ・CORS あり（POST/OPTIONS）
// ・（任意）x-api-key チェック：EDGE_INGEST_KEY が未設定ならスキップ
// -------------------------------------------------------------
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ====== 環境変数 ======
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const EDGE_INGEST_KEY = Deno.env.get("EDGE_INGEST_KEY") ?? ""; // 任意。設定したら x-api-key で検証
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
// ====== ユーティリティ ======
function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Content-Type": "application/json",
    ...extra
  };
}
// 末尾のゴミ(\0/改行/付帯文字)で JSON.parse が落ちないように安全にパース
function safeJsonParse(raw) {
  const cleaned = raw.replace(/\u0000/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (_e) {
    // 最後の } or ] までを切り出して再トライ
    const i = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (i > 0) {
      const sliced = cleaned.slice(0, i + 1);
      return JSON.parse(sliced);
    }
    throw _e;
  }
}
// epoch(s|ms)/ISO/未定義 を ISO 文字列に正規化
function toISO(x) {
  if (x === null || x === undefined) return new Date().toISOString();
  if (typeof x === "string") {
    // ざっくり ISO っぽければそのまま
    if (/^\d{4}-\d{2}-\d{2}T/.test(x) || /^\d{4}\.\d{2}\.\d{2} /.test(x)) {
      const d = new Date(x);
      return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    }
    // 数字文字列の可能性
    const n = Number(x);
    if (!Number.isNaN(n)) return toISO(n);
    const d = new Date(x);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  if (typeof x === "number") {
    const ms = x > 1e12 ? x : x * 1000; // 13桁ならms、10桁ならs扱い
    const d = new Date(ms);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  if (x instanceof Date) return x.toISOString();
  return new Date().toISOString();
}
// ====== ハンドラ ======
serve(async (req)=>{
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders()
    });
  }
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: corsHeaders() });
    }
    // 任意の簡易キー検証（EDGE_INGEST_KEY を設定した場合のみ有効）
    if (EDGE_INGEST_KEY) {
      const apiKey = req.headers.get("x-api-key");
      if (apiKey !== EDGE_INGEST_KEY) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders() });
      }
    }
    // ★ まずは text() で受けて安全パース
    const raw = await req.text();
    const parsed = safeJsonParse(raw);
    const rows = Array.isArray(parsed) ? parsed : [ parsed ];
    // 正規化（bar_ts/at は ISO に揃える）
    const normalized = rows.map((r)=>{
      const nowIso = new Date().toISOString();
      const barIso = toISO(r.bar_ts ?? r.at ?? nowIso);
      const atIso = toISO(r.at ?? nowIso);
      return { ...r, bar_ts: barIso, at: atIso };
    });
    // DBへ upsert（重複は (bar_ts,sym,tf,account_login) で吸収）
    const { data, error } = await supabase
      .from("ea_logs")
      .upsert(normalized, { onConflict: "bar_ts,sym,tf,account_login", ignoreDuplicates: false })
      .select();
    if (error) {
      console.error("upsert error:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders() });
    }
    return new Response(JSON.stringify({ ok: true, inserted: data?.length ?? 0 }), { status: 200, headers: corsHeaders() });
  } catch (e) {
    console.error("handler error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders() });
  }
});
