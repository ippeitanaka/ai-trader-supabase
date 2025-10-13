// EA Log Edge Function for EA v1.2.2// EA Log Edge Function for EA v1.2.2// supabase/functions/ea-log/index.ts

// Receives log entries from MT5 EA and stores them in ea-log table

// Features: NUL byte removal, column fallback, CORS support, console logging// Receives POST requests from MT5 EA and inserts logs into ea-log table// -------------------------------------------------------------



import { serve } from "https://deno.land/std@0.224.0/http/server.ts";// Handles NUL byte removal and fallback for missing columns// MQL5 からの POST を安全に受け取り、ea_logs に UPSERT する関数。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ・JSONは text() で受けてクリーンアップ後に safeJsonParse

// ====== Environment Variables ======

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;import { serve } from "https://deno.land/std@0.224.0/http/server.ts";// ・bar_ts/at を ISO に正規化

const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";// ・onConflict: bar_ts,sym,tf,account_login で重複吸収

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ・CORS あり（POST/OPTIONS）

// ====== Types ======

interface EALogEntry {// ====== Environment Variables ======// ・（任意）x-api-key チェック：EDGE_INGEST_KEY が未設定ならスキップ

  at: string;

  sym: string;const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;// -------------------------------------------------------------

  tf: string;

  rsi?: number;const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

  atr?: number;

  price?: number;import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

  action?: string;

  win_prob?: number;const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);// ====== 環境変数 ======

  offset_factor?: number;  // May not exist in older table versions

  expiry_minutes?: number; // May not exist in older table versionsconst SUPABASE_URL = Deno.env.get("SUPABASE_URL");

  reason?: string;

  instance?: string;// ====== Types ======const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  version?: string;

  caller?: string;interface EALogEntry {const EDGE_INGEST_KEY = Deno.env.get("EDGE_INGEST_KEY") ?? ""; // 任意。設定したら x-api-key で検証

}

  at: string;const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ====== Utility Functions ======

function corsHeaders() {  sym: string;// ====== ユーティリティ ======

  return {

    "Access-Control-Allow-Origin": "*",  tf: string;function corsHeaders(extra = {}) {

    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",

    "Access-Control-Allow-Methods": "POST, OPTIONS",  rsi?: number;  return {

    "Content-Type": "application/json",

  };  atr?: number;    "Access-Control-Allow-Origin": "*",

}

  price?: number;    "Access-Control-Allow-Headers": "*",

// Normalize timestamp to ISO format

function toISO(value: any): string {  action?: string;    "Access-Control-Allow-Methods": "POST,OPTIONS",

  if (!value) return new Date().toISOString();

    win_prob?: number;    "Content-Type": "application/json",

  if (typeof value === "string") {

    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {  offset_factor?: number;  // Fallback field    ...extra

      const d = new Date(value);

      return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();  expiry_minutes?: number; // Fallback field  };

    }

    const d = new Date(value);  reason?: string;}

    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();

  }  instance?: string;// 末尾のゴミ(\0/改行/付帯文字)で JSON.parse が落ちないように安全にパース

  

  if (typeof value === "number") {  version?: string;function safeJsonParse(raw) {

    const ms = value > 1e12 ? value : value * 1000;

    const d = new Date(ms);  caller?: string;  const cleaned = raw.replace(/\u0000/g, "").trim();

    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();

  }}  try {

  

  return new Date().toISOString();    return JSON.parse(cleaned);

}

// ====== Utility Functions ======  } catch (_e) {

// ====== Main Handler ======

serve(async (req: Request) => {function corsHeaders() {    // 最後の } or ] までを切り出して再トライ

  // Handle CORS preflight

  if (req.method === "OPTIONS") {  return {    const i = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));

    return new Response(null, { status: 204, headers: corsHeaders() });

  }    "Access-Control-Allow-Origin": "*",    if (i > 0) {

  

  // Only accept POST    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",      const sliced = cleaned.slice(0, i + 1);

  if (req.method !== "POST") {

    return new Response(    "Access-Control-Allow-Methods": "POST, OPTIONS",      return JSON.parse(sliced);

      JSON.stringify({ error: "Method not allowed, POST only" }),

      { status: 405, headers: corsHeaders() }    "Content-Type": "application/json",    }

    );

  }  };    throw _e;

  

  try {}  }

    // Read request body as text and remove trailing NUL bytes

    const raw = await req.text();}

    const safe = raw.replace(/\u0000+$/g, "");  // Remove trailing NUL

    const body = JSON.parse(safe);// Remove trailing NUL bytes and parse JSON safely// epoch(s|ms)/ISO/未定義 を ISO 文字列に正規化

    

    // Normalize the log entryfunction safeJsonParse(raw: string): any {function toISO(x) {

    const logEntry: EALogEntry = {

      at: toISO(body.at),  // Remove NUL bytes (\u0000) from the string  if (x === null || x === undefined) return new Date().toISOString();

      sym: body.sym || "UNKNOWN",

      tf: body.tf || "UNKNOWN",  const cleaned = raw.replace(/\u0000/g, "").trim();  if (typeof x === "string") {

      rsi: body.rsi !== undefined ? Number(body.rsi) : undefined,

      atr: body.atr !== undefined ? Number(body.atr) : undefined,  try {    // ざっくり ISO っぽければそのまま

      price: body.price !== undefined ? Number(body.price) : undefined,

      action: body.action || undefined,    return JSON.parse(cleaned);    if (/^\d{4}-\d{2}-\d{2}T/.test(x) || /^\d{4}\.\d{2}\.\d{2} /.test(x)) {

      win_prob: body.win_prob !== undefined ? Number(body.win_prob) : undefined,

      offset_factor: body.offset_factor !== undefined ? Number(body.offset_factor) : undefined,  } catch (e) {      const d = new Date(x);

      expiry_minutes: body.expiry_minutes !== undefined ? Number(body.expiry_minutes) : undefined,

      reason: body.reason || undefined,    // Try to recover by finding the last valid JSON closing bracket      return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();

      instance: body.instance || undefined,

      version: body.version || undefined,    const lastBrace = cleaned.lastIndexOf("}");    }

      caller: body.caller || undefined,

    };    const lastBracket = cleaned.lastIndexOf("]");    // 数字文字列の可能性

    

    // Try to insert with all columns    const lastValid = Math.max(lastBrace, lastBracket);    const n = Number(x);

    let { error } = await supabase

      .from("ea-log")        if (!Number.isNaN(n)) return toISO(n);

      .insert(logEntry);

        if (lastValid > 0) {    const d = new Date(x);

    // Fallback: If insert fails due to missing columns (offset_factor/expiry_minutes)

    // retry without those columns      const sliced = cleaned.slice(0, lastValid + 1);    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();

    if (error && (error.message.includes("offset_factor") || error.message.includes("expiry_minutes"))) {

      console.warn("[ea-log] Retrying without offset_factor/expiry_minutes columns");      return JSON.parse(sliced);  }

      

      const fallbackEntry = { ...logEntry };    }  if (typeof x === "number") {

      delete fallbackEntry.offset_factor;

      delete fallbackEntry.expiry_minutes;    throw e;    const ms = x > 1e12 ? x : x * 1000; // 13桁ならms、10桁ならs扱い

      

      const result = await supabase  }    const d = new Date(ms);

        .from("ea-log")

        .insert(fallbackEntry);}    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();

      

      error = result.error;  }

    }

    // Normalize timestamp to ISO format  if (x instanceof Date) return x.toISOString();

    if (error) {

      console.error("[ea-log] DB insert error:", error);function toISO(value: any): string {  return new Date().toISOString();

      return new Response(

        JSON.stringify({ error: "Database insert failed", details: error.message }),  if (!value) return new Date().toISOString();}

        { status: 500, headers: corsHeaders() }

      );  // ====== ハンドラ ======

    }

      if (typeof value === "string") {serve(async (req)=>{

    // Log successful processing (required by spec)

    console.log(    // Already ISO format  // CORS preflight

      `[ea-log] at=${logEntry.at} sym=${logEntry.sym} tf=${logEntry.tf} ` +

      `caller=${logEntry.caller ?? "-"} win_prob=${logEntry.win_prob !== undefined ? logEntry.win_prob.toFixed(3) : "N/A"}`    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {  if (req.method === "OPTIONS") {

    );

          const d = new Date(value);    return new Response(null, {

    return new Response(

      JSON.stringify({ ok: true, message: "Log entry created" }),      return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();      headers: corsHeaders()

      { status: 200, headers: corsHeaders() }

    );    }    });

    

  } catch (error) {    // Try parsing as date  }

    console.error("[ea-log] Error:", error);

    return new Response(    const d = new Date(value);  try {

      JSON.stringify({ 

        error: "Internal server error",    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();    if (req.method !== "POST") {

        message: error instanceof Error ? error.message : "Unknown error"

      }),  }      return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: corsHeaders() });

      { status: 500, headers: corsHeaders() }

    );      }

  }

});  if (typeof value === "number") {    // 任意の簡易キー検証（EDGE_INGEST_KEY を設定した場合のみ有効）


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
