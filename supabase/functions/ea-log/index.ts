// EA Log Edge Function for EA v1.2.2// supabase/functions/ea-log/index.ts

// Receives POST requests from MT5 EA and inserts logs into ea-log table// -------------------------------------------------------------

// Handles NUL byte removal and fallback for missing columns// MQL5 からの POST を安全に受け取り、ea_logs に UPSERT する関数。

// ・JSONは text() で受けてクリーンアップ後に safeJsonParse

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";// ・bar_ts/at を ISO に正規化

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";// ・onConflict: bar_ts,sym,tf,account_login で重複吸収

// ・CORS あり（POST/OPTIONS）

// ====== Environment Variables ======// ・（任意）x-api-key チェック：EDGE_INGEST_KEY が未設定ならスキップ

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;// -------------------------------------------------------------

const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);// ====== 環境変数 ======

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");

// ====== Types ======const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

interface EALogEntry {const EDGE_INGEST_KEY = Deno.env.get("EDGE_INGEST_KEY") ?? ""; // 任意。設定したら x-api-key で検証

  at: string;const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  sym: string;// ====== ユーティリティ ======

  tf: string;function corsHeaders(extra = {}) {

  rsi?: number;  return {

  atr?: number;    "Access-Control-Allow-Origin": "*",

  price?: number;    "Access-Control-Allow-Headers": "*",

  action?: string;    "Access-Control-Allow-Methods": "POST,OPTIONS",

  win_prob?: number;    "Content-Type": "application/json",

  offset_factor?: number;  // Fallback field    ...extra

  expiry_minutes?: number; // Fallback field  };

  reason?: string;}

  instance?: string;// 末尾のゴミ(\0/改行/付帯文字)で JSON.parse が落ちないように安全にパース

  version?: string;function safeJsonParse(raw) {

  caller?: string;  const cleaned = raw.replace(/\u0000/g, "").trim();

}  try {

    return JSON.parse(cleaned);

// ====== Utility Functions ======  } catch (_e) {

function corsHeaders() {    // 最後の } or ] までを切り出して再トライ

  return {    const i = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));

    "Access-Control-Allow-Origin": "*",    if (i > 0) {

    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",      const sliced = cleaned.slice(0, i + 1);

    "Access-Control-Allow-Methods": "POST, OPTIONS",      return JSON.parse(sliced);

    "Content-Type": "application/json",    }

  };    throw _e;

}  }

}

// Remove trailing NUL bytes and parse JSON safely// epoch(s|ms)/ISO/未定義 を ISO 文字列に正規化

function safeJsonParse(raw: string): any {function toISO(x) {

  // Remove NUL bytes (\u0000) from the string  if (x === null || x === undefined) return new Date().toISOString();

  const cleaned = raw.replace(/\u0000/g, "").trim();  if (typeof x === "string") {

  try {    // ざっくり ISO っぽければそのまま

    return JSON.parse(cleaned);    if (/^\d{4}-\d{2}-\d{2}T/.test(x) || /^\d{4}\.\d{2}\.\d{2} /.test(x)) {

  } catch (e) {      const d = new Date(x);

    // Try to recover by finding the last valid JSON closing bracket      return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();

    const lastBrace = cleaned.lastIndexOf("}");    }

    const lastBracket = cleaned.lastIndexOf("]");    // 数字文字列の可能性

    const lastValid = Math.max(lastBrace, lastBracket);    const n = Number(x);

        if (!Number.isNaN(n)) return toISO(n);

    if (lastValid > 0) {    const d = new Date(x);

      const sliced = cleaned.slice(0, lastValid + 1);    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();

      return JSON.parse(sliced);  }

    }  if (typeof x === "number") {

    throw e;    const ms = x > 1e12 ? x : x * 1000; // 13桁ならms、10桁ならs扱い

  }    const d = new Date(ms);

}    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();

  }

// Normalize timestamp to ISO format  if (x instanceof Date) return x.toISOString();

function toISO(value: any): string {  return new Date().toISOString();

  if (!value) return new Date().toISOString();}

  // ====== ハンドラ ======

  if (typeof value === "string") {serve(async (req)=>{

    // Already ISO format  // CORS preflight

    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {  if (req.method === "OPTIONS") {

      const d = new Date(value);    return new Response(null, {

      return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();      headers: corsHeaders()

    }    });

    // Try parsing as date  }

    const d = new Date(value);  try {

    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();    if (req.method !== "POST") {

  }      return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: corsHeaders() });

      }

  if (typeof value === "number") {    // 任意の簡易キー検証（EDGE_INGEST_KEY を設定した場合のみ有効）

    // Assume Unix timestamp (seconds or milliseconds)    if (EDGE_INGEST_KEY) {

    const ms = value > 1e12 ? value : value * 1000;      const apiKey = req.headers.get("x-api-key");

    const d = new Date(ms);      if (apiKey !== EDGE_INGEST_KEY) {

    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders() });

  }      }

      }

  return new Date().toISOString();    // ★ まずは text() で受けて安全パース

}    const raw = await req.text();

    const parsed = safeJsonParse(raw);

// ====== Main Handler ======    const rows = Array.isArray(parsed) ? parsed : [ parsed ];

serve(async (req: Request) => {    // 正規化（bar_ts/at は ISO に揃える）

  // Handle CORS preflight    const normalized = rows.map((r)=>{

  if (req.method === "OPTIONS") {      const nowIso = new Date().toISOString();

    return new Response(null, { status: 204, headers: corsHeaders() });      const barIso = toISO(r.bar_ts ?? r.at ?? nowIso);

  }      const atIso = toISO(r.at ?? nowIso);

        return { ...r, bar_ts: barIso, at: atIso };

  // Only accept POST    });

  if (req.method !== "POST") {    // DBへ upsert（重複は (bar_ts,sym,tf,account_login) で吸収）

    return new Response(    const { data, error } = await supabase

      JSON.stringify({ error: "Method not allowed, POST only" }),      .from("ea_logs")

      { status: 405, headers: corsHeaders() }      .upsert(normalized, { onConflict: "bar_ts,sym,tf,account_login", ignoreDuplicates: false })

    );      .select();

  }    if (error) {

        console.error("upsert error:", error);

  try {      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders() });

    // Read request body as text and remove NUL bytes    }

    const rawBody = await req.text();    return new Response(JSON.stringify({ ok: true, inserted: data?.length ?? 0 }), { status: 200, headers: corsHeaders() });

    const body = safeJsonParse(rawBody);  } catch (e) {

        console.error("handler error:", e);

    // Normalize the log entry    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders() });

    const logEntry: EALogEntry = {  }

      at: toISO(body.at),});

      sym: body.sym || "UNKNOWN",
      tf: body.tf || "UNKNOWN",
      rsi: body.rsi ? Number(body.rsi) : undefined,
      atr: body.atr ? Number(body.atr) : undefined,
      price: body.price ? Number(body.price) : undefined,
      action: body.action || undefined,
      win_prob: body.win_prob !== undefined ? Number(body.win_prob) : undefined,
      offset_factor: body.offset_factor !== undefined ? Number(body.offset_factor) : undefined,
      expiry_minutes: body.expiry_minutes !== undefined ? Number(body.expiry_minutes) : undefined,
      reason: body.reason || undefined,
      instance: body.instance || undefined,
      version: body.version || undefined,
      caller: body.caller || undefined,
    };
    
    // Insert into ea-log table
    const { error } = await supabase
      .from("ea-log")
      .insert(logEntry);
    
    if (error) {
      console.error("[ea-log] DB insert error:", error);
      return new Response(
        JSON.stringify({ error: "Database insert failed", details: error.message }),
        { status: 500, headers: corsHeaders() }
      );
    }
    
    // Log successful processing
    console.log(
      `[ea-log] at=${logEntry.at} sym=${logEntry.sym} tf=${logEntry.tf} ` +
      `caller=${logEntry.caller || "unknown"} win_prob=${logEntry.win_prob !== undefined ? logEntry.win_prob.toFixed(3) : "N/A"}`
    );
    
    return new Response(
      JSON.stringify({ ok: true, message: "Log entry created" }),
      { status: 200, headers: corsHeaders() }
    );
    
  } catch (error) {
    console.error("[ea-log] Error:", error);
    return new Response(
      JSON.stringify({ 
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error"
      }),
      { status: 500, headers: corsHeaders() }
    );
  }
});
