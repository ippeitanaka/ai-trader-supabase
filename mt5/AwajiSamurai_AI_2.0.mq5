//+------------------------------------------------------------------+
//| AwajiSamurai_AI_2.0.mq5  (ver 1.5.6)                            |
//| - Supabase: ai-signals(AI側) / ea-log                            |
//| - POST時の末尾NUL(0x00)除去対応                                  |
//| - ML学習用: ai_signalsへの取引記録・結果追跡機能                 |
//| - Fix: ポジション約定後の重複ログ出力を修正                      |
//| - Enhanced: ea-logに詳細なAI判断とトレード状況を記録             |
//| - New: ai-signals-update エンドポイントで約定価格を記録          |
//| - v1.3.0: 一目均衡表（Ichimoku）を統合 - Quad Fusion化           |
//| - v1.4.0: 全テクニカル指標の生データをAIに送信、真のQuadFusion実装|
//|          MACD追加、AI側で独自に4指標評価（トレンド・モメンタム    |
//|          ・ボラティリティ・一目）、EA判断は参考情報に             |
//| - v1.5.0: 動的ロット倍率システム実装 (ML学習データに基づく1-3倍) |
//|          Level 1-4の4段階評価で高勝率パターンは自動的にロット増加|
//| - v1.5.1: 🔧 重複ポジション完全防止パッチ（レースコンディション対策）|
//|          ペンディングオーダーもカウント、追跡中ポジション二重チェック|
//+------------------------------------------------------------------+
#property strict
#include <Trade/Trade.mqh>
CTrade trade;

// ===== 入力パラメータ =====
input bool   LockToChartSymbol = true;
input ENUM_TIMEFRAMES TF_Entry   = PERIOD_M15;
input ENUM_TIMEFRAMES TF_Recheck = PERIOD_H1;

input double MinWinProb          = 0.75;  // 🚨 0.75 = 75% (品質重視だが取引頻度も維持)
input double RiskATRmult         = 2.0;   // 🚨 ストップロス拡大（大損失防止）
input double RewardRR            = 1.5;   // 🚨 リスクリワード比改善
input double PendingOffsetATR    = 0.2;
input int    PendingExpiryMin    = 90;
input double Lots                = 0.10;
input double MaxLots             = 0.30;  // ロット倍率適用時の最大値（リスク管理）
input int    SlippagePoints      = 1000;
input long   Magic               = 26091501;
input int    MaxPositions        = 1;      // 同一銘柄の最大ポジション数

// MaxPositions のカウントに「ペンディングオーダー(約定待ち)」も含めるか
// true: 重複/レース抑止を優先（デフォルト）
// false: 同時保有を優先（pendingが残っていても新規が通る）
input bool   CountPendingOrdersInMaxPos = true;

// 複数ポジション運用時の追跡枠（ai_signals の更新・結果反映に必要）
// MaxPositions>1 の場合は、この数が小さすぎると一部が結果更新できず PENDING/FILLED が残り得る。
input int    TrackedMaxTrades    = 10;

input bool   DebugLogs           = true;
input int    LogCooldownSec      = 30;  // 0=全出力, >0=間引き, -1=完全OFF
input int    CooldownAfterCloseMin = 30; // TP/SL後のクールダウン（分）

// ===== H1 precheck tuning (market-only) =====
// 0=OFF, 1=SOFT(逆方向かつ高確度のみブロック), 2=STRICT(方向/閾値を必須)
input int    H1PrecheckMode      = 1;
input double H1PrecheckMinProb   = 0.65;
input double H1OppositeBlockProb = 0.78;
input bool   H1FailOpen          = true;

// ===== Virtual (paper/shadow) learning =====
input bool   UseAIForDirection = false;   // true: dirはAIに委譲（サーバでBUY/SELL両方向評価）
// Track selected SKIP reasons as paper trades and label TP/SL outcomes.
// This reduces learning blind spots without increasing real risk.
input bool   EnableVirtualLearning = true;
input bool   VirtualTrack_SkippedMaxPos = true;
input bool   VirtualTrack_SkippedTrackedPos = true;
// 60-69%帯は実行しないが、検証材料として仮想トレードを記録
input bool   VirtualTrack_LowBand = true;
input double VirtualLowBandMinProb = 0.60;
input double VirtualLowBandMaxProb = 0.69;

// Virtual watch capacity (too small => many is_virtual rows remain PENDING)
input int    VirtualMaxWatches     = 2000;

// ★ URLは自分のプロジェクトに合わせて設定
input string AI_Endpoint_URL     = "https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ai-trader";
input string EA_Log_URL          = "https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ea-log";
input string AI_Signals_URL      = "https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ai-signals";
input string AI_Signals_Update_URL = "https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ai-signals-update";

// ★ Supabase Functions 呼び出し用 (Bearer)
// - Dashboard の Project Settings -> API で取得
// - anon key / service_role key のどちらでも動くが、運用方針に合わせて設定
input string AI_Bearer_Token     = "";

// ★ ea-log は不正投稿防止のため、別トークン運用も可能
// - 空なら AI_Bearer_Token を使う
// - 推奨: ea-log専用のEA_LOG_BEARER_TOKENをSupabase secretsに設定し、EA側はパラメータで設定
//   （このソースにはトークンを直書きしない）
input string EA_Log_Bearer_Token = "";

// Bearerが未設定のまま誤って稼働させるのを防ぐ
input bool   RequireBearerToken  = true;

input string AI_EA_Instance      = "main";
input string AI_EA_Version       = "1.5.6";
input int    AI_Timeout_ms       = 10000;

// ===== 一目均衡表設定 =====
input bool   UseIchimoku         = true;   // 一目均衡表を使用
input int    Ichimoku_Tenkan     = 9;      // 転換線期間
input int    Ichimoku_Kijun      = 26;     // 基準線期間
input int    Ichimoku_Senkou     = 52;     // 先行スパン期間

// ===== 内部変数 =====
datetime g_lastBar_M15=0, g_lastBar_H1=0;
datetime g_lastLogTs=0;
ulong    g_pendingTicket=0;
int      g_pendingDir=0;
datetime g_pendingAt=0;
int      g_dynamicExpiryMin=PendingExpiryMin;
datetime g_cooldownUntil=0; // TP/SLクローズ後のクールダウン期限

// ポジション追跡用（ML学習用）
ulong    g_trackedPositionTicket=0;
ulong    g_trackedOrderTicket=0; // ai_signals.order_ticket に対応するキー（order ticket）
datetime g_trackedPositionOpenTime=0;
double   g_trackedPositionEntryPrice=0;
bool     g_trackedFillSent=false;
datetime g_trackedFillLastTry=0;

// 複数ポジション追跡（MaxPositions>1 対応）
struct TrackedTrade{
   ulong    position_ticket;
   ulong    order_ticket;
   datetime open_time;
   double   entry_price;
   bool     fill_sent;
   datetime fill_last_try;
};
TrackedTrade g_tracked[];

// ===== Tracking rehydrate (after restart) =====
// EAの再起動/再アタッチで g_tracked が初期化されると、
// 既存ポジションの WIN/LOSS 更新ができず ai_signals が FILLED で滞留することがある。
// そこで、現在のポジションを履歴(deals)から order_ticket に紐付け直して tracked に復元する。
void RehydrateTrackingFromExistingPositions()
{
   datetime now=TimeCurrent();
   // 過去の履歴範囲は広すぎると重いので、十分な安全マージンで 30日
   datetime from=now-(30*86400);
   bool hs=HistorySelect(from,now);
   int dealsTotal=(hs?HistoryDealsTotal():0);

   int added=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong posTicket=PositionGetTicket(i);
      if(posTicket<=0) continue;
      if(PositionGetString(POSITION_SYMBOL)!=_Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC)!=Magic) continue;
      if(IsPositionTracked(posTicket)) continue;

      datetime openTime=(datetime)PositionGetInteger(POSITION_TIME);
      double entryPrice=PositionGetDouble(POSITION_PRICE_OPEN);
      ulong ordTicket=0;

      // Find entry deal for this position to get original order ticket
      if(hs && dealsTotal>0)
      {
         for(int d=dealsTotal-1; d>=0; d--)
         {
            ulong dealTicket=HistoryDealGetTicket(d);
            if(dealTicket<=0) continue;
            if((ulong)HistoryDealGetInteger(dealTicket,DEAL_POSITION_ID)!=posTicket) continue;
            if(HistoryDealGetString(dealTicket,DEAL_SYMBOL)!=_Symbol) continue;
            if((long)HistoryDealGetInteger(dealTicket,DEAL_MAGIC)!=Magic) continue;
            if(HistoryDealGetInteger(dealTicket,DEAL_ENTRY)!=DEAL_ENTRY_IN) continue;

            ordTicket=(ulong)HistoryDealGetInteger(dealTicket,DEAL_ORDER);
            // Prefer deal time/price as they are definitive
            openTime=(datetime)HistoryDealGetInteger(dealTicket,DEAL_TIME);
            double dp=HistoryDealGetDouble(dealTicket,DEAL_PRICE);
            if(MathIsValidNumber(dp) && dp>0) entryPrice=dp;
            break;
         }
      }

      if(ordTicket>0)
      {
         if(AddTrackedTrade(posTicket,ordTicket,openTime,entryPrice))
         {
            added++;
            // legacy single-slot: set only if empty (MaxPositions<=1 前提での互換)
            if(g_trackedPositionTicket==0)
            {
               g_trackedPositionTicket=posTicket;
               g_trackedOrderTicket=ordTicket;
               g_trackedPositionOpenTime=openTime;
               g_trackedPositionEntryPrice=entryPrice;
               g_trackedFillSent=false;
               g_trackedFillLastTry=0;
            }
         }
      }
   }

   if(added>0)
   {
      SafePrint(StringFormat("[TRACK] Rehydrated %d position(s) from existing positions",added));
   }
}

void ClearTrackedSlot(const int idx)
{
   if(idx<0 || idx>=ArraySize(g_tracked)) return;
   g_tracked[idx].position_ticket=0;
   g_tracked[idx].order_ticket=0;
   g_tracked[idx].open_time=0;
   g_tracked[idx].entry_price=0;
   g_tracked[idx].fill_sent=false;
   g_tracked[idx].fill_last_try=0;
}

int FindFreeTrackedSlot()
{
   for(int i=0;i<ArraySize(g_tracked);i++)
   {
      if(g_tracked[i].position_ticket==0 && g_tracked[i].order_ticket==0) return i;
   }
   return -1;
}

int FindTrackedByPositionTicket(const ulong posTicket)
{
   if(posTicket==0) return -1;
   for(int i=0;i<ArraySize(g_tracked);i++)
   {
      if(g_tracked[i].position_ticket==posTicket) return i;
   }
   return -1;
}

bool IsPositionTracked(const ulong posTicket)
{
   return FindTrackedByPositionTicket(posTicket)>=0;
}

bool AddTrackedTrade(const ulong posTicket,const ulong ordTicket,const datetime openTime,const double entryPrice)
{
   if(posTicket==0) return false;
   if(IsPositionTracked(posTicket)) return true;
   int idx=FindFreeTrackedSlot();
   if(idx<0)
   {
      SafePrint(StringFormat("[TRACK] No free slot (cap=%d) pos=%s order=%s", ArraySize(g_tracked), ULongToString(posTicket), ULongToString(ordTicket)));
      return false;
   }
   g_tracked[idx].position_ticket=posTicket;
   g_tracked[idx].order_ticket=ordTicket;
   g_tracked[idx].open_time=openTime;
   g_tracked[idx].entry_price=entryPrice;
   g_tracked[idx].fill_sent=false;
   g_tracked[idx].fill_last_try=0;
   return true;
}

// ===== Virtual (paper/shadow) trade tracking =====
// Used to label SKIPPED-but-eligible signals with TP/SL outcome, without risking real capital.
enum VState { V_WAIT_FILL=0, V_IN_POSITION=1 };
struct VirtualWatch{
   long     signal_id;
   int      state;
   datetime created_at;
   datetime expiry_at;
   datetime filled_at;
   int      dir;
   int      order_type; // 0=market, else MT5 pending order type
   double   entry;
   double   sl;
   double   tp;
};
VirtualWatch g_virtual[];

// ===== string helpers =====
// #property strict では ulong を IntegerToString に直接渡すとコンパイルエラーになることがあるため、明示的に文字列化する。
string ULongToString(const ulong v)
{
   return StringFormat("%I64u", v);
}

// ===== ログ =====
void SafePrint(string msg)
{
   if(LogCooldownSec < 0) return;
   if(!DebugLogs) return;
   datetime now = TimeCurrent();
   if(LogCooldownSec == 0 || now - g_lastLogTs >= LogCooldownSec){
      Print(msg); g_lastLogTs = now;
   }
}

// クールダウン判定
bool InCooldown()
{
   return (g_cooldownUntil>0 && TimeCurrent()<g_cooldownUntil);
}

// ===== Volume (lots) normalization =====
int VolumeDigitsFromStep(const double step)
{
   if(step<=0) return 2;
   for(int d=0; d<=8; d++){
      if(MathAbs(NormalizeDouble(step,d)-step) < 1e-12) return d;
   }
   return 2;
}

// Floors to the symbol's volume step and validates min/max.
// Returns false when the normalized volume is below the broker's min.
bool NormalizeLotsForSymbol(const double requested,double &normalized,string &why)
{
   double vmin=0.0,vmax=0.0,vstep=0.0;
   if(!SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN,vmin)) vmin=0.0;
   if(!SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX,vmax)) vmax=0.0;
   if(!SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP,vstep)) vstep=0.0;

   if(!MathIsValidNumber(requested) || requested<=0){
      why="requested<=0";
      return false;
   }
   if(vstep<=0) vstep=0.01;
   int vd=VolumeDigitsFromStep(vstep);

   double vol=MathFloor(requested/vstep)*vstep;
   vol=NormalizeDouble(vol,vd);
   if(vmax>0.0 && vol>vmax){
      vol=MathFloor(vmax/vstep)*vstep;
      vol=NormalizeDouble(vol,vd);
   }
   if(vmin>0.0 && vol<vmin){
      why=StringFormat("below min (req=%.4f norm=%.4f min=%.4f step=%.4f)",requested,vol,vmin,vstep);
      normalized=vol;
      return false;
   }
   normalized=vol;
   return true;
}

// ===== HTTPユーティリティ（★POSTはNUL無しで送る） =====
string BuildAuthHeader(const string bearer)
{
   if(bearer=="") return "";
   return "Authorization: Bearer "+bearer+"\r\n";
}

bool HttpPostJson(const string url,const string bearer,const string payload,string &resp,int timeout_ms=5000)
{
   uchar data[];
   // ★ UTF-8で丸ごと変換（WHOLE_ARRAY）→ 末尾のNUL(0x00)を削除
   int n = StringToCharArray(payload, data, 0, WHOLE_ARRAY, CP_UTF8);
   // 末尾の 0 を全部落とす（複数付くケースもケア）
   while(n > 0 && data[n-1] == 0) n--;
   if(n != ArraySize(data)) ArrayResize(data, n);

   string headers="Content-Type: application/json\r\n"+BuildAuthHeader(bearer);
   uchar result[]; string result_headers;
   int status=WebRequest("POST",url,headers,timeout_ms,data,result,result_headers);
   if(status==-1){ int ec=GetLastError(); PrintFormat("[HTTP] POST fail=%d url=%s", ec, url); return false; }
   resp=CharArrayToString(result,0,-1,CP_UTF8);
   if(status/100!=2){ PrintFormat("[HTTP] POST status=%d body=%s", status, resp); return false; }
   return true;
}

bool HttpGet(const string url,const string bearer,string &resp,int timeout_ms=5000)
{
   uchar dummyData[]; // GETでも第5引数は配列変数が必要
   string headers=BuildAuthHeader(bearer);
   uchar result[]; string result_headers;
   int status=WebRequest("GET",url,headers,timeout_ms,dummyData,result,result_headers);
   if(status==-1){ int ec=GetLastError(); PrintFormat("[HTTP] GET fail=%d url=%s", ec, url); return false; }
   resp=CharArrayToString(result,0,-1,CP_UTF8);
   if(status/100!=2){ PrintFormat("[HTTP] GET status=%d body=%s", status, resp); return false; }
   return true;
}

bool HttpPut(const string url,const string bearer,const string payload,string &resp,int timeout_ms=5000)
{
   uchar data[];
   int n = StringToCharArray(payload, data, 0, WHOLE_ARRAY, CP_UTF8);
   while(n > 0 && data[n-1] == 0) n--;
   if(n != ArraySize(data)) ArrayResize(data, n);

   string headers="Content-Type: application/json\r\n"+BuildAuthHeader(bearer);
   uchar result[]; string result_headers;
   int status=WebRequest("PUT",url,headers,timeout_ms,data,result,result_headers);
   if(status==-1){ int ec=GetLastError(); PrintFormat("[HTTP] PUT fail=%d url=%s", ec, url); return false; }
   resp=CharArrayToString(result,0,-1,CP_UTF8);
   if(status/100!=2){ PrintFormat("[HTTP] PUT status=%d body=%s", status, resp); return false; }
   return true;
}

// ===== JSON helper (very small, key:int only) =====
long JsonGetLong(const string json,const string key)
{
   string needle="\""+key+"\":";
   int p=StringFind(json,needle);
   if(p<0) return 0;
   p += (int)StringLen(needle);
   // skip whitespace
   while(p<(int)StringLen(json)){
      ushort ch=StringGetCharacter(json,p);
      if(ch!=' ' && ch!='\n' && ch!='\r' && ch!='\t') break;
      p++;
   }
   string digits="";
   while(p<(int)StringLen(json)){
      ushort ch=StringGetCharacter(json,p);
      if(ch>='0' && ch<='9'){ digits += CharToString((uchar)ch); p++; continue; }
      break;
   }
   if(digits=="") return 0;
   return (long)StringToInteger(digits);
}

int FindFreeVirtualSlot()
{
   for(int i=0;i<ArraySize(g_virtual);i++) if(g_virtual[i].signal_id==0) return i;
   return -1;
}

void PurgeExpiredVirtualWatches(datetime now)
{
   for(int i=0;i<ArraySize(g_virtual);i++)
   {
      if(g_virtual[i].signal_id==0) continue;
      if(g_virtual[i].state!=V_WAIT_FILL) continue;
      if(now<=g_virtual[i].expiry_at) continue;

      // If it is already expired, try cancelling it to prevent DB backlog.
      // Only free the slot when cancel succeeded; otherwise let CheckVirtualWatches retry.
      if(CancelSignalById(g_virtual[i].signal_id,"virtual_expired"))
      {
         g_virtual[i].signal_id=0;
      }
   }
}

int TrackVirtual(const VirtualWatch &w)
{
   int idx=FindFreeVirtualSlot();
   if(idx<0){
      PurgeExpiredVirtualWatches(TimeCurrent());
      idx=FindFreeVirtualSlot();
   }
   if(idx<0){
      SafePrint(StringFormat("[VIRTUAL] No free slot (cap=%d) -> cancelling signal_id=%d", ArraySize(g_virtual), w.signal_id));
      CancelSignalById(w.signal_id,"virtual_no_slot");
      return -1;
   }
   g_virtual[idx]=w;
   return idx;
}

// Update ai_signals by signal_id (virtual/paper trades)
bool UpdateSignalResultById(long signal_id,double exit_price,double profit_loss,const string result,bool sl_hit,bool tp_hit,datetime filled_at=0)
{
   datetime now=TimeCurrent();
   int duration=0;
   if(filled_at>0) duration=(int)((now-filled_at)/60);
   string payload="{"+
   "\"signal_id\":"+IntegerToString(signal_id)+","+
   "\"exit_price\":"+DoubleToString(exit_price,_Digits)+","+
   "\"profit_loss\":"+DoubleToString(profit_loss,2)+","+
   "\"actual_result\":\""+result+"\","+
   "\"closed_at\":\""+TimeToString(now,TIME_DATE|TIME_SECONDS)+"\","+
   "\"hold_duration_minutes\":"+IntegerToString(duration)+","+
   "\"sl_hit\":"+(sl_hit?"true":"false")+","+
   "\"tp_hit\":"+(tp_hit?"true":"false")+"}";
   string resp;
   if(!HttpPut(AI_Signals_URL,AI_Bearer_Token,payload,resp,3000)){
      SafePrint(StringFormat("[AI_SIGNALS] Failed to update virtual result (signal_id=%d)", signal_id));
      return false;
   }
   return true;
}

bool UpdateSignalVirtualFilled(long signal_id,double entry_price,datetime filled_at)
{
   string payload="{"+
   "\"signal_id\":"+IntegerToString(signal_id)+","+
   "\"entry_price\":"+DoubleToString(entry_price,_Digits)+","+
   "\"virtual_filled_at\":\""+TimeToString(filled_at,TIME_DATE|TIME_SECONDS)+"\","+
   "\"actual_result\":\"FILLED\"}";
   string resp;
   if(!HttpPut(AI_Signals_URL,AI_Bearer_Token,payload,resp,3000)){
      SafePrint(StringFormat("[AI_SIGNALS] Failed to mark virtual filled (signal_id=%d)", signal_id));
      return false;
   }
   return true;
}

bool CancelSignalById(long signal_id,const string reason)
{
   string payload="{"+
   "\"signal_id\":"+IntegerToString(signal_id)+","+
   "\"actual_result\":\"CANCELLED\","+
   "\"cancelled_reason\":\""+JsonEscape(reason)+"\"}";
   string resp;
   if(!HttpPut(AI_Signals_URL,AI_Bearer_Token,payload,resp,3000)){
      SafePrint(StringFormat("[AI_SIGNALS] Failed to cancel virtual (signal_id=%d reason=%s)", signal_id, reason));
      return false;
   }
   return true;
}

bool ShouldVirtualTrack(const string decision_code)
{
   if(!EnableVirtualLearning) return false;
   if(decision_code=="SKIPPED_MAX_POS") return VirtualTrack_SkippedMaxPos;
   if(decision_code=="SKIPPED_TRACKED_POS") return VirtualTrack_SkippedTrackedPos;
   if(decision_code=="SKIPPED_LOW_BAND") return VirtualTrack_LowBand;
   if(decision_code=="SKIPPED_ACTION_0") return VirtualTrack_LowBand;
   return false;
}

int GetUTCHour()
{
   MqlDateTime dt; TimeToStruct(TimeGMT(), dt);
   return dt.hour;
}

string JsonEscape(string s){
   StringReplace(s,"\\","\\\\");StringReplace(s,"\"","\\\"");
   StringReplace(s,"\n","\\n");StringReplace(s,"\r","\\r");
   return s;
}

// ===== Data readiness helpers =====
// MT5 indicators can intermittently fail (invalid handle / CopyBuffer<=0) when history isn't ready.
// These helpers preload bars and retry CopyBuffer to reduce "取り損ね".
bool EnsureBars(ENUM_TIMEFRAMES tf,int minBars)
{
   int bars=Bars(_Symbol,tf);
   if(bars>=minBars) return true;
   MqlRates rates[];
   int copied=CopyRates(_Symbol,tf,0,minBars,rates);
   return copied>=minBars;
}

bool CopyBuffer1Retry(const int h,const int buffer,const int shift,double &out)
{
   double buf[];
   for(int attempt=0; attempt<3; attempt++)
   {
      int bc=BarsCalculated(h);
      if(bc>shift)
      {
         if(CopyBuffer(h,buffer,shift,1,buf)>0)
         {
            out=buf[0];
            if(out!=EMPTY_VALUE) return true;
         }
      }
      Sleep(20);
   }
   return false;
}

// ===== 指標関数 =====
double RSIv(ENUM_TIMEFRAMES tf,int period=14,ENUM_APPLIED_PRICE price=PRICE_CLOSE,int shift=0)
{
 int h=iRSI(_Symbol,tf,period,price);
 if(h==INVALID_HANDLE) return EMPTY_VALUE;
 double v=EMPTY_VALUE;
 if(!EnsureBars(tf,period+shift+5) || !CopyBuffer1Retry(h,0,shift,v)) { IndicatorRelease(h); return EMPTY_VALUE; }
 IndicatorRelease(h); return v;
}

double ATRv(ENUM_TIMEFRAMES tf,int p=14,int s=0){int h=iATR(_Symbol,tf,p);if(h==INVALID_HANDLE)return EMPTY_VALUE;
 double v=EMPTY_VALUE;
 if(!EnsureBars(tf,p+s+5) || !CopyBuffer1Retry(h,0,s,v)) { IndicatorRelease(h); return EMPTY_VALUE; }
 IndicatorRelease(h);return v;}

double MA(ENUM_TIMEFRAMES tf,int period,ENUM_MA_METHOD method,ENUM_APPLIED_PRICE price,int shift=0)
{int h=iMA(_Symbol,tf,period,0,method,price);if(h==INVALID_HANDLE)return EMPTY_VALUE;
 double v=EMPTY_VALUE;
 if(!EnsureBars(tf,period+shift+5) || !CopyBuffer1Retry(h,0,shift,v)) { IndicatorRelease(h); return EMPTY_VALUE; }
 IndicatorRelease(h);return v;}

// MACD取得関数
bool GetMACD(ENUM_TIMEFRAMES tf,double &macd_main,double &macd_signal,double &macd_hist,int shift=0)
{
   // Need enough bars for slow EMA + shift margin
   EnsureBars(tf,26+9+shift+10);
   int h=iMACD(_Symbol,tf,12,26,9,PRICE_CLOSE);
   if(h==INVALID_HANDLE){
      Print("[MACD] Failed to create indicator handle");
      return false;
   }

   double m=EMPTY_VALUE,s=EMPTY_VALUE;
   bool ok=true;
   ok=ok&&CopyBuffer1Retry(h,0,shift,m);    // MACD Main
   ok=ok&&CopyBuffer1Retry(h,1,shift,s);    // Signal

   if(!ok || m==EMPTY_VALUE || s==EMPTY_VALUE){
      IndicatorRelease(h);
      Print("[MACD] Failed to copy buffers");
      return false;
   }

   macd_main=m;
   macd_signal=s;
   macd_hist=macd_main-macd_signal;
   
   IndicatorRelease(h);
   return true;
}

// ADX（トレンド強度）取得: main(ADX), +DI, -DI
bool GetADX(ENUM_TIMEFRAMES tf,double &adx_main,double &di_plus,double &di_minus,int shift=0)
{
   EnsureBars(tf,14+shift+10);
   int h=iADX(_Symbol,tf,14);
   if(h==INVALID_HANDLE){
      Print("[ADX] Failed to create indicator handle");
      return false;
   }

   double a=EMPTY_VALUE,dp=EMPTY_VALUE,dm=EMPTY_VALUE;
   bool ok=true;
   ok=ok&&CopyBuffer1Retry(h,0,shift,a);       // ADX
   ok=ok&&CopyBuffer1Retry(h,1,shift,dp);      // +DI
   ok=ok&&CopyBuffer1Retry(h,2,shift,dm);      // -DI

   if(!ok || a==EMPTY_VALUE || dp==EMPTY_VALUE || dm==EMPTY_VALUE){
      IndicatorRelease(h);
      Print("[ADX] Failed to copy buffers");
      return false;
   }

   adx_main=a;
   di_plus=dp;
   di_minus=dm;

   IndicatorRelease(h);
   return true;
}

// ボリンジャーバンド幅（スクイーズ判定用途）: (Upper-Lower)/Middle
bool GetBollingerWidth(ENUM_TIMEFRAMES tf,double &bb_width,double &bb_upper,double &bb_middle,double &bb_lower,int shift=0)
{
   EnsureBars(tf,20+shift+10);
   int h=iBands(_Symbol,tf,20,2.0,0,PRICE_CLOSE);
   if(h==INVALID_HANDLE){
      Print("[BB] Failed to create indicator handle");
      return false;
   }

   double up=EMPTY_VALUE,mid=EMPTY_VALUE,low=EMPTY_VALUE;
   bool ok=true;
   ok=ok&&CopyBuffer1Retry(h,0,shift,up);
   ok=ok&&CopyBuffer1Retry(h,1,shift,mid);
   ok=ok&&CopyBuffer1Retry(h,2,shift,low);

   if(!ok || up==EMPTY_VALUE || mid==EMPTY_VALUE || low==EMPTY_VALUE){
      IndicatorRelease(h);
      Print("[BB] Failed to copy buffers");
      return false;
   }

   bb_upper=up;
   bb_middle=mid;
   bb_lower=low;
   if(bb_middle<=0 || !MathIsValidNumber(bb_middle)){
      IndicatorRelease(h);
      Print("[BB] Middle band is zero");
      return false;
   }

   // Basic sanity: upper should be above lower, and width should be finite and positive.
   // NOTE: upper==lower can happen in extreme flat/low-vol regimes; treat it as width=0 (valid).
   if(!MathIsValidNumber(bb_upper) || !MathIsValidNumber(bb_lower) || bb_upper<bb_lower){
      IndicatorRelease(h);
      Print("[BB] Invalid band values");
      return false;
   }

   bb_width=(bb_upper-bb_lower)/bb_middle;
   // width==0 is a valid squeeze; only reject NaN/inf/negative.
   if(!MathIsValidNumber(bb_width) || bb_width<0){
      IndicatorRelease(h);
      Print("[BB] Invalid bb_width");
      return false;
   }

   IndicatorRelease(h);
   return true;
}

// 一目均衡表の各ライン取得
struct IchimokuValues{
   double tenkan;    // 転換線
   double kijun;     // 基準線
   double senkou_a;  // 先行スパンA
   double senkou_b;  // 先行スパンB
   double chikou;    // 遅行スパン
};

bool GetIchimoku(ENUM_TIMEFRAMES tf,IchimokuValues &ich,int shift=0)
{
   // Need enough bars for Tenkan/Kijun/Senkou + chikou reference
   EnsureBars(tf,Ichimoku_Kijun+Ichimoku_Senkou+shift+50);
   int h=iIchimoku(_Symbol,tf,Ichimoku_Tenkan,Ichimoku_Kijun,Ichimoku_Senkou);
   if(h==INVALID_HANDLE){
      Print("[Ichimoku] Failed to create indicator handle");
      return false;
   }

   double t=EMPTY_VALUE,k=EMPTY_VALUE,a=EMPTY_VALUE,b=EMPTY_VALUE;
   // 0:Tenkan, 1:Kijun, 2:SpanA, 3:SpanB, 4:Chikou
   bool ok=true;
   ok=ok&&CopyBuffer1Retry(h,0,shift,t);
   ok=ok&&CopyBuffer1Retry(h,1,shift,k);
   ok=ok&&CopyBuffer1Retry(h,2,shift,a);
   ok=ok&&CopyBuffer1Retry(h,3,shift,b);

   if(!ok || t==EMPTY_VALUE || k==EMPTY_VALUE || a==EMPTY_VALUE || b==EMPTY_VALUE){
      IndicatorRelease(h);
      Print("[Ichimoku] Failed to copy buffers");
      return false;
   }

   ich.tenkan=t;
   ich.kijun=k;
   ich.senkou_a=a;
   ich.senkou_b=b;

   // Chikou(遅行スパン)は「終値を Ichimoku_Kijun 期間だけ過去にシフト」して描画されるため、
   // shift=0 のバッファ値が EMPTY_VALUE になり得る。
   // 学習/検証用スナップショットでは「shift+Ichimoku_Kijun の終値」を保存して異常値を避ける。
   int need=shift+Ichimoku_Kijun;
   int bars=Bars(_Symbol,tf);
   if(bars>need) ich.chikou=iClose(_Symbol,tf,need);
   else {
      IndicatorRelease(h);
      Print("[Ichimoku] Not enough bars for chikou");
      return false;
   }
   
   IndicatorRelease(h);
   return true;
}

// 一目均衡表のシグナル判定
int IchimokuSignal(ENUM_TIMEFRAMES tf,double current_price)
{
   if(!UseIchimoku) return 0;
   
   IchimokuValues ich;
   if(!GetIchimoku(tf,ich,0)) return 0;
   
   int signal=0;
   int score=0;
   
   // 1. 転換線と基準線のクロス（最も重要）
   if(ich.tenkan>ich.kijun) score+=2;      // 強い買いシグナル
   else if(ich.tenkan<ich.kijun) score-=2; // 強い売りシグナル
   
   // 2. 価格と雲の位置関係
   double kumo_top=MathMax(ich.senkou_a,ich.senkou_b);
   double kumo_bottom=MathMin(ich.senkou_a,ich.senkou_b);
   
   if(current_price>kumo_top) score+=1;       // 価格が雲の上 -> 買い優勢
   else if(current_price<kumo_bottom) score-=1; // 価格が雲の下 -> 売り優勢
   
   // 3. 雲の厚さ（薄い雲は突破しやすい）
   double kumo_thickness=MathAbs(ich.senkou_a-ich.senkou_b);
   double atr=ATRv(tf,14,0);
   if(atr>0 && kumo_thickness<atr*0.5){
      // 薄い雲 -> 中立（トレンド転換の可能性）
      score=0;
   }
   
   // 4. 雲の色（先行スパンAとBの関係）
   if(ich.senkou_a>ich.senkou_b) score+=1;    // 上昇雲（陽転）
   else if(ich.senkou_a<ich.senkou_b) score-=1; // 下降雲（陰転）
   
   // スコアからシグナルを決定
   if(score>=3) signal=1;       // 強い買い
   else if(score<=-3) signal=-1; // 強い売り
   
   return signal;
}

// ===== テクニカルシグナル =====
struct TechSignal{int dir;string reason;double atr;double ref;double ichimoku_score;};
TechSignal Evaluate(ENUM_TIMEFRAMES tf)
{
   TechSignal s; s.dir=0; s.reason=""; s.atr=ATRv(tf,14,0); s.ichimoku_score=0;
   double mid=(SymbolInfoDouble(_Symbol,SYMBOL_BID)+SymbolInfoDouble(_Symbol,SYMBOL_ASK))/2.0;
   s.ref=mid;
   
   // 移動平均線のシグナル
   double fast=MA(tf,25,MODE_EMA,PRICE_CLOSE,0);
   double slow=MA(tf,100,MODE_SMA,PRICE_CLOSE,0);
   int ma_signal=0;
   if(fast>slow) ma_signal=1;
   else if(fast<slow) ma_signal=-1;
   
   // 一目均衡表のシグナル
   int ichimoku_signal=IchimokuSignal(tf,mid);
   
   // 総合判定（両方が一致する場合は強いシグナル）
   if(UseIchimoku){
      if(ma_signal==1 && ichimoku_signal==1){
         s.dir=1; 
         s.reason="MA↑+一目買";
         s.ichimoku_score=1.0;
      }
      else if(ma_signal==-1 && ichimoku_signal==-1){
         s.dir=-1; 
         s.reason="MA↓+一目売";
         s.ichimoku_score=1.0;
      }
      else if(ma_signal==1 && ichimoku_signal==0){
         s.dir=1; 
         s.reason="MA↑";
         s.ichimoku_score=0.5;
      }
      else if(ma_signal==-1 && ichimoku_signal==0){
         s.dir=-1; 
         s.reason="MA↓";
         s.ichimoku_score=0.5;
      }
      else if(ma_signal==0 && ichimoku_signal==1){
         s.dir=1; 
         s.reason="一目買";
         s.ichimoku_score=0.7;
      }
      else if(ma_signal==0 && ichimoku_signal==-1){
         s.dir=-1; 
         s.reason="一目売";
         s.ichimoku_score=0.7;
      }
      else if(ma_signal!=0 && ichimoku_signal!=0 && ma_signal!=ichimoku_signal){
         // シグナルが矛盾 -> 見送り
         s.dir=0; 
         s.reason="シグナル矛盾";
         s.ichimoku_score=0;
      }
   }
   else{
      // 一目均衡表を使わない場合は従来通り
      if(ma_signal==1){s.dir=1;s.reason="MA↑";}
      else if(ma_signal==-1){s.dir=-1;s.reason="MA↓";}
   }
   
   return s;
}

// ===== AI連携 =====
struct AIOut{
   double win_prob;int action;double offset_factor;int expiry_min;string reasoning;string confidence;
   int suggested_dir;            // action=0でも、AIがより良いと見た方向（1/-1）
   double buy_win_prob;          // dir=0（両方向評価）でのBUY勝率（0-1）。未提供時は-1
   double sell_win_prob;         // dir=0（両方向評価）でのSELL勝率（0-1）。未提供時は-1
   // Dynamic gating / EV
   double recommended_min_win_prob; // 0.60-0.75 (server may suggest lower)
   double expected_value_r;         // EV in R-multiples (loss=-1R, win=+1.5R)
   string skip_reason;
   // Execution style (market-only)
   string entry_method;          // market
   string method_selected_by;    // Manual
   string method_reason;
   // 動的ロット倍率（ML学習データに基づく）
   double lot_multiplier;        // 1.0-3.0x (Level 1-4)
   string lot_level;             // Level説明
   string lot_reason;            // 倍率の理由
   // ML pattern tracking
   bool   ml_pattern_used;       // MLパターンが使用されたか
   long   ml_pattern_id;         // パターンID
   string ml_pattern_name;       // パターン名
   double ml_pattern_confidence; // パターン信頼度 (%)
};
bool ExtractJsonNumber(const string json,const string key,double &out){
   string pat="\""+key+"\":";int pos=StringFind(json,pat);if(pos<0)return false;
   pos+=StringLen(pat);int end=pos;while(end<StringLen(json)){
      ushort c=StringGetCharacter(json,end);
      if((c>='0'&&c<='9')||c=='-'||c=='+'||c=='.'||c=='e'||c=='E') end++; else break;}
   string num=StringSubstr(json,pos,end-pos);out=StringToDouble(num);return true;}
bool ExtractJsonInt(const string json,const string key,int &out){double d;if(!ExtractJsonNumber(json,key,d))return false;out=(int)MathRound(d);return true;}
bool ExtractJsonBool(const string json,const string key,bool &out){
   string pat="\""+key+"\":";int pos=StringFind(json,pat);if(pos<0)return false;
   pos+=StringLen(pat);
   // Skip whitespace
   while(pos<StringLen(json) && (StringGetCharacter(json,pos)==' '||StringGetCharacter(json,pos)=='\t')) pos++;
   // Check for "true" or "false"
   if(StringSubstr(json,pos,4)=="true"){out=true;return true;}
   if(StringSubstr(json,pos,5)=="false"){out=false;return true;}
   return false;}
bool ExtractJsonString(const string json,const string key,string &out){
   string pat="\""+key+"\":\"";int pos=StringFind(json,pat);if(pos<0)return false;
   pos+=StringLen(pat);int end=pos;while(end<StringLen(json)){
      ushort c=StringGetCharacter(json,end);
      if(c=='\"'&&(end==pos||StringGetCharacter(json,end-1)!='\\'))break;
      end++;}
   out=StringSubstr(json,pos,end-pos);
   StringReplace(out,"\\\"","\"");StringReplace(out,"\\\\","\\");
   StringReplace(out,"\\n","\n");StringReplace(out,"\\r","\r");
   return true;}

// entry_params のセクションを取り出す（簡易）
bool ExtractJsonObjectSection(const string json,const string objKey,string &section){
   string pat="\""+objKey+"\":"; int pos=StringFind(json,pat); if(pos<0) return false;
   // 最初の '{' を探す
   int bracePos=StringFind(json,"{",pos);
   if(bracePos<0) return false;
   int depth=0; int i=bracePos; int n=StringLen(json);
   for(; i<n; i++){
      ushort c=StringGetCharacter(json,i);
      if(c=='{') depth++;
      else if(c=='}'){
         depth--; if(depth==0){ i++; break; }
      }
   }
   if(depth!=0) return false;
   section=StringSubstr(json,bracePos,i-bracePos);
   return true;
}

bool ExtractJsonInSectionNumber(const string section,const string key,double &out){
   string pat="\""+key+"\":"; int pos=StringFind(section,pat); if(pos<0) return false;
   pos+=StringLen(pat); int end=pos; while(end<StringLen(section)){
      ushort c=StringGetCharacter(section,end);
      if((c>='0'&&c<='9')||c=='-'||c=='+'||c=='.'||c=='e'||c=='E') end++; else break; }
   string num=StringSubstr(section,pos,end-pos); out=StringToDouble(num); return true;
}

bool ExtractJsonInSectionString(const string section,const string key,string &out){
   string pat="\""+key+"\":\""; int pos=StringFind(section,pat); if(pos<0) return false;
   pos+=StringLen(pat); int end=pos; while(end<StringLen(section)){
      ushort c=StringGetCharacter(section,end);
      if(c=='\"'&&(end==pos||StringGetCharacter(section,end-1)!='\\')) break; end++; }
   out=StringSubstr(section,pos,end-pos); StringReplace(out,"\\\"","\""); StringReplace(out,"\\\\","\\"); return true;
}

bool ValidateAIResponse(const AIOut &ai,string &why)
{
   if(!MathIsValidNumber(ai.win_prob) || ai.win_prob<0.0 || ai.win_prob>1.0){
      why="invalid win_prob";
      return false;
   }
   if(!(ai.action==0 || ai.action==1 || ai.action==-1)){
      why="invalid action";
      return false;
   }
   if(!MathIsValidNumber(ai.lot_multiplier) || ai.lot_multiplier<1.0 || ai.lot_multiplier>3.0){
      why="invalid lot_multiplier";
      return false;
   }
   if(ai.buy_win_prob>=0.0 && (!MathIsValidNumber(ai.buy_win_prob) || ai.buy_win_prob<0.0 || ai.buy_win_prob>1.0)){
      why="invalid buy_win_prob";
      return false;
   }
   if(ai.sell_win_prob>=0.0 && (!MathIsValidNumber(ai.sell_win_prob) || ai.sell_win_prob<0.0 || ai.sell_win_prob>1.0)){
      why="invalid sell_win_prob";
      return false;
   }
   if(ai.recommended_min_win_prob>0.0 && (!MathIsValidNumber(ai.recommended_min_win_prob) || ai.recommended_min_win_prob<0.0 || ai.recommended_min_win_prob>1.0)){
      why="invalid recommended_min_win_prob";
      return false;
   }
   if(ai.expected_value_r>-900.0 && !MathIsValidNumber(ai.expected_value_r)){
      why="invalid expected_value_r";
      return false;
   }
   if(ai.ml_pattern_confidence>0.0 && (!MathIsValidNumber(ai.ml_pattern_confidence) || ai.ml_pattern_confidence<0.0 || ai.ml_pattern_confidence>100.0)){
      why="invalid ml_pattern_confidence";
      return false;
   }
   return true;
}

bool QueryAI(const string tf_label,int dir,double rsi,double atr,double price,const string reason,double ichimoku_score,AIOut &out_ai)
{
   // default init (ExtractJson* が失敗しても未初期化値を使わない)
   out_ai.win_prob=0.0;
   out_ai.action=0;
   out_ai.offset_factor=0.0;
   out_ai.expiry_min=0;
   out_ai.reasoning="";
   out_ai.confidence="";
   out_ai.suggested_dir=0;
   out_ai.buy_win_prob=-1.0;
   out_ai.sell_win_prob=-1.0;
   out_ai.recommended_min_win_prob=0.0;
   out_ai.expected_value_r=-999.0;
   out_ai.skip_reason="";
   out_ai.entry_method="market";
   out_ai.method_selected_by="Manual";
   out_ai.method_reason="market-only execution";
   out_ai.lot_multiplier=1.0;
   out_ai.lot_level="";
   out_ai.lot_reason="";
   out_ai.ml_pattern_used=false;
   out_ai.ml_pattern_id=0;
   out_ai.ml_pattern_name="";
   out_ai.ml_pattern_confidence=0.0;

   // ★ テクニカル指標の詳細データを取得
   ENUM_TIMEFRAMES tf=(tf_label=="M15")?TF_Entry:TF_Recheck;
   double ema_25=MA(tf,25,MODE_EMA,PRICE_CLOSE,0);
   double sma_100=MA(tf,100,MODE_SMA,PRICE_CLOSE,0);
   double sma_200=MA(tf,200,MODE_SMA,PRICE_CLOSE,0);
   double sma_800=MA(tf,800,MODE_SMA,PRICE_CLOSE,0);

   // クロス系は「状態(常時±1)」ではなく「発生イベント(±1/0)」として送る
   // QuadFusion側がクロス時に加点するため、常時±1だと常にバイアスが乗る
   double ema_25_prev=MA(tf,25,MODE_EMA,PRICE_CLOSE,1);
   double sma_100_prev=MA(tf,100,MODE_SMA,PRICE_CLOSE,1);
   int ma_cross=0;
   if(ema_25> sma_100 && ema_25_prev<=sma_100_prev) ma_cross=1;
   else if(ema_25< sma_100 && ema_25_prev>=sma_100_prev) ma_cross=-1;
   
   // MACD取得
   double macd_main=0,macd_signal=0,macd_hist=0;
   bool has_macd=GetMACD(tf,macd_main,macd_signal,macd_hist,0);

   double macd_main_prev=0,macd_signal_prev=0,macd_hist_prev=0;
   bool has_macd_prev=GetMACD(tf,macd_main_prev,macd_signal_prev,macd_hist_prev,1);
   int macd_cross=0;
   if(has_macd && has_macd_prev){
      if(macd_main>macd_signal && macd_main_prev<=macd_signal_prev) macd_cross=1;
      else if(macd_main<macd_signal && macd_main_prev>=macd_signal_prev) macd_cross=-1;
   }
   
   // 一目均衡表取得
   IchimokuValues ich;
   ich.tenkan=0; ich.kijun=0; ich.senkou_a=0; ich.senkou_b=0; ich.chikou=0;
   bool has_ichimoku=GetIchimoku(tf,ich,0);

   IchimokuValues ich_prev;
   ich_prev.tenkan=0; ich_prev.kijun=0; ich_prev.senkou_a=0; ich_prev.senkou_b=0; ich_prev.chikou=0;
   bool has_ichimoku_prev=GetIchimoku(tf,ich_prev,1);

   int tk_cross=0;
   if(has_ichimoku && has_ichimoku_prev){
      if(ich.tenkan>ich.kijun && ich_prev.tenkan<=ich_prev.kijun) tk_cross=1;
      else if(ich.tenkan<ich.kijun && ich_prev.tenkan>=ich_prev.kijun) tk_cross=-1;
   }

   // 雲の色は「ほぼ同値(薄い雲)」のときは 0 に落としてノイズを減らす
   int cloud_color=0;
   if(has_ichimoku){
      double atr_for_eps = (atr>0?atr:ATRv(tf,14,0));
      double kumo_thickness = MathAbs(ich.senkou_a-ich.senkou_b);
      double eps = (atr_for_eps>0 ? atr_for_eps*0.10 : 0);
      if(eps>0 && kumo_thickness<=eps) cloud_color=0;
      else cloud_color = (ich.senkou_a>ich.senkou_b ? 1 : (ich.senkou_a<ich.senkou_b ? -1 : 0));
   }

   // ADX取得
   double adx_main=0, di_plus=0, di_minus=0;
   bool has_adx=GetADX(tf,adx_main,di_plus,di_minus,0);

   // ボリンジャーバンド幅
   double bb_width=0, bb_upper=0, bb_middle=0, bb_lower=0;
   bool has_bb=GetBollingerWidth(tf,bb_width,bb_upper,bb_middle,bb_lower,0);
   // Guard: treat bb_width as optional; send only when it is a sane positive finite value.
   // Some backends reject 0 / too-small values as invalid_optional.
   if(has_bb){
      if(!MathIsValidNumber(bb_width) || bb_width<1e-6 || bb_width>1.0){
         has_bb=false;
      }
   }

   // ATR (send-safe)
   // - サーバ側は costR=spread/(atr*risk_atr_mult) を使うため、atr=0 だとコストが過小評価される。
   // - 指標取得が不安定な場合もあるので、tf上のATRを優先しつつ、ダメなら引数 atr にフォールバック。
   double atr_tf = ATRv(tf,14,0);
   double atr_send = atr_tf;
   if(!MathIsValidNumber(atr_send) || atr_send==EMPTY_VALUE || atr_send<=0.0)
      atr_send = atr;
   if(!MathIsValidNumber(atr_send) || atr_send==EMPTY_VALUE || atr_send<=0.0)
      atr_send = 0.0;

   // 正規化ATR（ATR/価格）
   double atr_norm=(price>0?atr_send/price:0);
   
   // 価格情報 (send-safe)
   double bid=0.0, ask=0.0;
   MqlTick tick;
   if(SymbolInfoTick(_Symbol,tick))
   {
      bid=tick.bid;
      ask=tick.ask;
   }
   if(!MathIsValidNumber(bid) || !MathIsValidNumber(ask) || bid<=0.0 || ask<=0.0 || ask<bid)
   {
      bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
      ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   }
   if(!MathIsValidNumber(bid) || !MathIsValidNumber(ask) || bid<=0.0 || ask<=0.0 || ask<bid)
   {
      // 最後の保険（サーバ側で assumed cost に落ちる）
      bid=0.0;
      ask=0.0;
   }
   
   // ★ すべての生データをAIに送信
   int dir_to_send = (UseAIForDirection ? 0 : dir);
   string payload="{"+
   "\"symbol\":\""+JsonEscape(_Symbol)+"\","+
   "\"timeframe\":\""+JsonEscape(tf_label)+"\","+

   // EA設定（サーバ側の action 判定がEAの最小勝率より厳しくならないように共有）
   "\"min_win_prob\":"+DoubleToString(MinWinProb,3)+","+
   
   // 価格情報
   "\"price\":"+DoubleToString(price,_Digits)+","+
   "\"bid\":"+DoubleToString(bid,_Digits)+","+
   "\"ask\":"+DoubleToString(ask,_Digits)+","+
   
   // 移動平均線（生データ）
   "\"ema_25\":"+DoubleToString(ema_25,_Digits)+","+
   "\"sma_100\":"+DoubleToString(sma_100,_Digits)+","+
   "\"sma_200\":"+DoubleToString(sma_200,_Digits)+","+
   "\"sma_800\":"+DoubleToString(sma_800,_Digits)+","+
   "\"ma_cross\":"+IntegerToString(ma_cross)+","+
   
   // RSI & ATR
   "\"rsi\":"+DoubleToString(rsi,2)+","+
   "\"atr\":"+DoubleToString(atr_send,5)+","+

   // レジーム判定用（追加特徴量）
   "\"atr_norm\":"+DoubleToString(atr_norm,8)+","+
   (has_adx ? "\"adx\":"+DoubleToString(adx_main,2)+","+"\"di_plus\":"+DoubleToString(di_plus,2)+","+"\"di_minus\":"+DoubleToString(di_minus,2)+"," : "")+
   (has_bb ? "\"bb_width\":"+DoubleToString(bb_width,8)+"," : "")+
   
   // MACD（生データ）
   (has_macd ? ("\"macd\":{"+
      "\"main\":"+DoubleToString(macd_main,5)+","+
      "\"signal\":"+DoubleToString(macd_signal,5)+","+
      "\"histogram\":"+DoubleToString(macd_hist,5)+","+
      "\"cross\":"+IntegerToString(macd_cross)+
   "},") : "")+
   
   // 一目均衡表（全ライン）
   (has_ichimoku ? ("\"ichimoku\":{"+
      "\"tenkan\":"+DoubleToString(ich.tenkan,_Digits)+","+
      "\"kijun\":"+DoubleToString(ich.kijun,_Digits)+","+
      "\"senkou_a\":"+DoubleToString(ich.senkou_a,_Digits)+","+
      "\"senkou_b\":"+DoubleToString(ich.senkou_b,_Digits)+","+
      "\"chikou\":"+DoubleToString(ich.chikou,_Digits)+","+
      "\"tk_cross\":"+IntegerToString(tk_cross)+","+
      "\"cloud_color\":"+IntegerToString(cloud_color)+","+
      "\"price_vs_cloud\":"+
         (price>MathMax(ich.senkou_a,ich.senkou_b)?"1":
          (price<MathMin(ich.senkou_a,ich.senkou_b)?"-1":"0"))+
   "},") : "")+
   
   // EA側の判断（参考情報として）
   "\"ea_suggestion\":{"+
      "\"dir\":"+IntegerToString(dir_to_send)+","+
      "\"tech_dir\":"+IntegerToString(dir)+","+
      "\"reason\":\""+JsonEscape(reason)+"\","+
      "\"ichimoku_score\":"+DoubleToString(ichimoku_score,2)+
   "},"+
   
   "\"instance\":\""+JsonEscape(AI_EA_Instance)+"\","+
   "\"version\":\""+JsonEscape(AI_EA_Version)+"\"}";

   string resp;
   if(!HttpPostJson(AI_Endpoint_URL,AI_Bearer_Token,payload,resp,AI_Timeout_ms)){
      SafePrint("[AI] HTTP request failed");
      return false;
   }

   ExtractJsonNumber(resp,"win_prob",out_ai.win_prob);
   ExtractJsonInt(resp,"action",out_ai.action);
   int sdir; if(ExtractJsonInt(resp,"suggested_dir",sdir)) out_ai.suggested_dir=sdir; else out_ai.suggested_dir=0;
   double bwp; if(ExtractJsonNumber(resp,"buy_win_prob",bwp)) out_ai.buy_win_prob=bwp; else out_ai.buy_win_prob=-1.0;
   double swp; if(ExtractJsonNumber(resp,"sell_win_prob",swp)) out_ai.sell_win_prob=swp; else out_ai.sell_win_prob=-1.0;
   ExtractJsonNumber(resp,"offset_factor",out_ai.offset_factor);
   double tmp; if(ExtractJsonNumber(resp,"expiry_minutes",tmp)) out_ai.expiry_min=(int)MathRound(tmp);
   ExtractJsonString(resp,"reasoning",out_ai.reasoning);
   ExtractJsonString(resp,"reasoning",out_ai.reasoning);
   ExtractJsonString(resp,"confidence",out_ai.confidence);

   // Dynamic gating / EV
   double rmin; if(ExtractJsonNumber(resp,"recommended_min_win_prob",rmin)) out_ai.recommended_min_win_prob=rmin; else out_ai.recommended_min_win_prob=0.0;
   double evr; if(ExtractJsonNumber(resp,"expected_value_r",evr)) out_ai.expected_value_r=evr; else out_ai.expected_value_r=-999.0;
   ExtractJsonString(resp,"skip_reason",out_ai.skip_reason);
   // Execution is market-only (ignore any entry method/params from server)
   out_ai.entry_method = "market";
   out_ai.method_selected_by = "Manual";
   out_ai.method_reason = "market-only execution";
   
   // ロット倍率（ML学習データに基づく）
   double lm;
   if(ExtractJsonNumber(resp,"lot_multiplier",lm)){
      if(!MathIsValidNumber(lm) || lm<=0.0) lm=1.0;
      // v1.5.0 design: 1-3x only (avoid unexpected downsizing that can violate broker min lot)
      if(lm<1.0) lm=1.0;
      if(lm>3.0) lm=3.0;
      out_ai.lot_multiplier=lm;
   }else out_ai.lot_multiplier=1.0;
   ExtractJsonString(resp,"lot_level",out_ai.lot_level);
   ExtractJsonString(resp,"lot_reason",out_ai.lot_reason);
   
   // ML pattern tracking
   if(!ExtractJsonBool(resp,"ml_pattern_used",out_ai.ml_pattern_used)) out_ai.ml_pattern_used=false;
   int mlId=0; if(ExtractJsonInt(resp,"ml_pattern_id",mlId)) out_ai.ml_pattern_id=(long)mlId; else out_ai.ml_pattern_id=0;
   ExtractJsonString(resp,"ml_pattern_name",out_ai.ml_pattern_name);
   double mlConf; if(ExtractJsonNumber(resp,"ml_pattern_confidence",mlConf)) out_ai.ml_pattern_confidence=mlConf; else out_ai.ml_pattern_confidence=0.0;

   // response validation (safe-side skip)
   string vwhy="";
   if(!ValidateAIResponse(out_ai,vwhy)){
      SafePrint(StringFormat("[AI] Invalid response: %s (prob=%.3f action=%d)", vwhy, out_ai.win_prob, out_ai.action));
      return false;
   }

   return true;
}

// ea-logに詳細記録（トレード判定情報含む）
// dir: 実行方向（ai.action など）
// tech_dir: テクニカル起点の方向（検証用）
void LogAIDecision(const string tf_label,int dir,double rsi,double atr,double price,const string reason,const AIOut &ai,const string trade_decision,bool threshold_met,int current_pos,ulong ticket=0,int tech_dir=0,double executed_lot=0.0)
{
   string logPayload="{"+
   "\"at\":\""+TimeToString(TimeCurrent(),TIME_DATE|TIME_SECONDS)+"\","+
   "\"sym\":\""+_Symbol+"\","+
   "\"tf\":\""+tf_label+"\","+
   "\"rsi\":"+DoubleToString(rsi,2)+","+
   "\"atr\":"+DoubleToString(atr,5)+","+
   "\"price\":"+DoubleToString(price,_Digits)+","+
   "\"action\":\""+(dir>0?"BUY":(dir<0?"SELL":"HOLD"))+"\","+
   (tech_dir!=0?"\"tech_action\":\""+(tech_dir>0?"BUY":(tech_dir<0?"SELL":"HOLD"))+"\",":"")+
   (ai.suggested_dir!=0?"\"suggested_action\":\""+(ai.suggested_dir>0?"BUY":(ai.suggested_dir<0?"SELL":"HOLD"))+"\",":"")+
   (ai.suggested_dir!=0?"\"suggested_dir\":"+IntegerToString(ai.suggested_dir)+",":"")+
   (ai.buy_win_prob>=0?"\"buy_win_prob\":"+DoubleToString(ai.buy_win_prob,3)+",":"")+
   (ai.sell_win_prob>=0?"\"sell_win_prob\":"+DoubleToString(ai.sell_win_prob,3)+",":"")+
   "\"win_prob\":"+DoubleToString(ai.win_prob,3)+","+
   "\"recommended_min_win_prob\":"+DoubleToString(ai.recommended_min_win_prob,3)+","+
   "\"expected_value_r\":"+DoubleToString(ai.expected_value_r,3)+","+
   "\"skip_reason\":\""+JsonEscape(ai.skip_reason)+"\","+
   "\"ai_confidence\":\""+(ai.confidence!=""?JsonEscape(ai.confidence):"unknown")+"\","+
   "\"ai_reasoning\":\""+(ai.reasoning!=""?JsonEscape(ai.reasoning):"N/A")+"\","+
   "\"entry_method\":\""+JsonEscape(ai.entry_method)+"\","+
   "\"method_selected_by\":\""+JsonEscape(ai.method_selected_by)+"\","+
   "\"method_reason\":\""+JsonEscape(ai.method_reason)+"\","+
   "\"trade_decision\":\""+JsonEscape(trade_decision)+"\","+
   "\"threshold_met\":"+(threshold_met?"true":"false")+","+
   "\"current_positions\":"+IntegerToString(current_pos)+","+
   "\"lot_multiplier\":"+DoubleToString(ai.lot_multiplier,2)+","+
   "\"lot_level\":"+(ai.lot_level!=""?"\""+JsonEscape(ai.lot_level)+"\"":"null")+","+
   "\"lot_reason\":"+(ai.lot_reason!=""?"\""+JsonEscape(ai.lot_reason)+"\"":"null")+","+
   (ticket>0?"\"order_ticket\":\""+ULongToString(ticket)+"\",":"")+
   (executed_lot>0?"\"executed_lot\":"+DoubleToString(executed_lot,2)+",":"")+
   "\"offset_factor\":"+DoubleToString(ai.offset_factor,3)+","+
   "\"expiry_minutes\":"+IntegerToString(ai.expiry_min)+","+
   "\"reason\":\""+JsonEscape(reason)+"\","+
   "\"instance\":\""+AI_EA_Instance+"\","+
   "\"version\":\""+AI_EA_Version+"\","+
   "\"caller\":\""+tf_label+"\"}";
   const string bearer=(EA_Log_Bearer_Token!=""?EA_Log_Bearer_Token:AI_Bearer_Token);
   string dummy; HttpPostJson(EA_Log_URL,bearer,logPayload,dummy,3000);
}

// ===== AI Signals記録（ML学習用） =====
long RecordSignal(const string tf_label,int dir,double rsi,double atr,double price,const string reason,const AIOut &ai,ulong ticket=0,double entry_price=0,bool mark_filled=false,bool is_virtual=false,double planned_entry=0,double planned_sl=0,double planned_tp=0,int planned_order_type=-1,int expiry_minutes=0,double lot_multiplier=1.0,const string lot_level="",const string lot_reason="",double executed_lot=0.0)
{
   // レジーム判定用の追加特徴量（QueryAIと同様にEA側で計算して保存する）
   ENUM_TIMEFRAMES tf=(tf_label=="M15")?TF_Entry:TF_Recheck;

   // 価格情報
   double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);

   // 移動平均（QueryAIと同一）
   double ema_25=MA(tf,25,MODE_EMA,PRICE_CLOSE,0);
   double sma_100=MA(tf,100,MODE_SMA,PRICE_CLOSE,0);
   double ema_25_prev=MA(tf,25,MODE_EMA,PRICE_CLOSE,1);
   double sma_100_prev=MA(tf,100,MODE_SMA,PRICE_CLOSE,1);
   int ma_cross=0;
   if(ema_25> sma_100 && ema_25_prev<=sma_100_prev) ma_cross=1;
   else if(ema_25< sma_100 && ema_25_prev>=sma_100_prev) ma_cross=-1;

   // MACD（生データ + クロス）
   double macd_main=0,macd_signal=0,macd_hist=0;
   bool has_macd=GetMACD(tf,macd_main,macd_signal,macd_hist,0);
   double macd_main_prev=0,macd_signal_prev=0,macd_hist_prev=0;
   bool has_macd_prev=GetMACD(tf,macd_main_prev,macd_signal_prev,macd_hist_prev,1);
   int macd_cross=0;
   if(has_macd && has_macd_prev){
      if(macd_main>macd_signal && macd_main_prev<=macd_signal_prev) macd_cross=1;
      else if(macd_main<macd_signal && macd_main_prev>=macd_signal_prev) macd_cross=-1;
   }

   // 一目均衡表（全ライン + クロス/雲色/雲位置）
   IchimokuValues ich;
   ich.tenkan=0; ich.kijun=0; ich.senkou_a=0; ich.senkou_b=0; ich.chikou=0;
   bool has_ichimoku=GetIchimoku(tf,ich,0);
   IchimokuValues ich_prev;
   ich_prev.tenkan=0; ich_prev.kijun=0; ich_prev.senkou_a=0; ich_prev.senkou_b=0; ich_prev.chikou=0;
   bool has_ichimoku_prev=GetIchimoku(tf,ich_prev,1);

   int tk_cross=0;
   if(has_ichimoku && has_ichimoku_prev){
      if(ich.tenkan>ich.kijun && ich_prev.tenkan<=ich_prev.kijun) tk_cross=1;
      else if(ich.tenkan<ich.kijun && ich_prev.tenkan>=ich_prev.kijun) tk_cross=-1;
   }

   int cloud_color=0;
   if(has_ichimoku){
      double atr_for_eps = (atr>0?atr:ATRv(tf,14,0));
      double kumo_thickness = MathAbs(ich.senkou_a-ich.senkou_b);
      double eps = (atr_for_eps>0 ? atr_for_eps*0.10 : 0);
      if(eps>0 && kumo_thickness<=eps) cloud_color=0;
      else cloud_color = (ich.senkou_a>ich.senkou_b ? 1 : (ich.senkou_a<ich.senkou_b ? -1 : 0));
   }

   int price_vs_cloud=0;
   if(has_ichimoku){
      if(price>MathMax(ich.senkou_a,ich.senkou_b)) price_vs_cloud=1;
      else if(price<MathMin(ich.senkou_a,ich.senkou_b)) price_vs_cloud=-1;
      else price_vs_cloud=0;
   }

   double atr_norm=(price>0?atr/price:0);
   double adx_main=0, di_plus=0, di_minus=0;
   bool has_adx=GetADX(tf,adx_main,di_plus,di_minus,0);
   double bb_width=0, bb_upper=0, bb_middle=0, bb_lower=0;
   bool has_bb=GetBollingerWidth(tf,bb_width,bb_upper,bb_middle,bb_lower,0);
   // Guard: keep bb_width truly optional in ai_signals payload as well.
   if(has_bb){
      if(!MathIsValidNumber(bb_width) || bb_width<1e-6 || bb_width>1.0){
         has_bb=false;
      }
   }

   string payload="{"+
   "\"symbol\":\""+JsonEscape(_Symbol)+"\","+
   "\"timeframe\":\""+JsonEscape(tf_label)+"\","+
   "\"dir\":"+IntegerToString(dir)+","+
   "\"win_prob\":"+DoubleToString(ai.win_prob,3)+","+
   "\"bid\":"+DoubleToString(bid,_Digits)+","+
   "\"ask\":"+DoubleToString(ask,_Digits)+","+
   "\"rsi\":"+DoubleToString(rsi,2)+","+
   "\"atr\":"+DoubleToString(atr,5)+","+
   "\"atr_norm\":"+DoubleToString(atr_norm,8)+","+
   (has_adx ? "\"adx\":"+DoubleToString(adx_main,2)+","+"\"di_plus\":"+DoubleToString(di_plus,2)+","+"\"di_minus\":"+DoubleToString(di_minus,2)+"," : "")+
   (has_bb ? "\"bb_width\":"+DoubleToString(bb_width,8)+"," : "")+
   "\"price\":"+DoubleToString(price,_Digits)+","+
   "\"ema_25\":"+DoubleToString(ema_25,_Digits)+","+
   "\"sma_100\":"+DoubleToString(sma_100,_Digits)+","+
   "\"ma_cross\":"+IntegerToString(ma_cross)+","+
   (has_macd ? ("\"macd\":{"+
      "\"main\":"+DoubleToString(macd_main,5)+","+
      "\"signal\":"+DoubleToString(macd_signal,5)+","+
      "\"histogram\":"+DoubleToString(macd_hist,5)+","+
      "\"cross\":"+IntegerToString(macd_cross)+
   "},") : "")+
   (has_ichimoku ? ("\"ichimoku\":{"+
      "\"tenkan\":"+DoubleToString(ich.tenkan,_Digits)+","+
      "\"kijun\":"+DoubleToString(ich.kijun,_Digits)+","+
      "\"senkou_a\":"+DoubleToString(ich.senkou_a,_Digits)+","+
      "\"senkou_b\":"+DoubleToString(ich.senkou_b,_Digits)+","+
      "\"chikou\":"+DoubleToString(ich.chikou,_Digits)+","+
      "\"tk_cross\":"+IntegerToString(tk_cross)+","+
      "\"cloud_color\":"+IntegerToString(cloud_color)+","+
      "\"price_vs_cloud\":"+IntegerToString(price_vs_cloud)+
   "},") : "")+
   "\"reason\":\""+JsonEscape(reason)+"\","+
   "\"instance\":\""+JsonEscape(AI_EA_Instance)+"\","+
   "\"model_version\":\""+JsonEscape(AI_EA_Version)+"\","+
   "\"entry_method\":\""+JsonEscape(ai.entry_method)+"\","+
   "\"method_selected_by\":\""+JsonEscape(ai.method_selected_by)+"\","+
   "\"method_reason\":\""+JsonEscape(ai.method_reason)+"\","+
   "\"ml_pattern_used\":"+(ai.ml_pattern_used?"true":"false")+","+
   "\"ml_pattern_id\":"+(ai.ml_pattern_id>0?IntegerToString(ai.ml_pattern_id):"null")+","+
   "\"ml_pattern_name\":\""+(ai.ml_pattern_name!=""?JsonEscape(ai.ml_pattern_name):"null")+"\","+
   "\"ml_pattern_confidence\":"+(ai.ml_pattern_confidence>0?DoubleToString(ai.ml_pattern_confidence,2):"null")+","+
   "\"lot_multiplier\":"+DoubleToString(lot_multiplier,2)+","+
   "\"lot_level\":"+(lot_level!=""?"\""+JsonEscape(lot_level)+"\"":"null")+","+
   "\"lot_reason\":"+(lot_reason!=""?"\""+JsonEscape(lot_reason)+"\"":"null")+","+
   "\"executed_lot\":"+(executed_lot>0?DoubleToString(executed_lot,2):"null")+","+
   "\"is_virtual\":"+(is_virtual?"true":"false")+"";

   if(planned_entry>0) payload+=",\"planned_entry_price\":"+DoubleToString(planned_entry,_Digits);
   if(planned_sl>0) payload+=",\"planned_sl\":"+DoubleToString(planned_sl,_Digits);
   if(planned_tp>0) payload+=",\"planned_tp\":"+DoubleToString(planned_tp,_Digits);
   if(planned_order_type>=0) payload+=",\"planned_order_type\":"+IntegerToString(planned_order_type);

   if(ticket>0){
      payload+=",\"order_ticket\":\""+ULongToString(ticket)+"\"";
      if(entry_price>0) payload+=",\"entry_price\":"+DoubleToString(entry_price,_Digits);
   }
   // Only mark FILLED when we have a real broker ticket.
   // Otherwise we would create FILLED rows without order_ticket/entry_price, and they cannot be updated later.
   if(mark_filled && ticket>0){ payload+=",\"actual_result\":\"FILLED\""; }
   payload+="}";

   string resp;
   if(!HttpPostJson(AI_Signals_URL,AI_Bearer_Token,payload,resp,3000)){
      SafePrint("[AI_SIGNALS] Failed to record signal");
      return 0;
   }

   long sid=JsonGetLong(resp,"signal_id");
   return sid;
}

// ===== Virtual watch loop =====
void CheckVirtualWatches()
{
   double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   datetime now=TimeCurrent();

   for(int i=0;i<ArraySize(g_virtual);i++)
   {
      if(g_virtual[i].signal_id==0) continue;

      if(g_virtual[i].state==V_WAIT_FILL)
      {
         if(now>g_virtual[i].expiry_at)
         {
            CancelSignalById(g_virtual[i].signal_id,"virtual_expired");
            g_virtual[i].signal_id=0;
            continue;
         }

         bool filled=false;

         // pending fill simulation (limit/stop)
         if(g_virtual[i].order_type==ORDER_TYPE_BUY_LIMIT) filled = (ask<=g_virtual[i].entry);
         else if(g_virtual[i].order_type==ORDER_TYPE_SELL_LIMIT) filled = (bid>=g_virtual[i].entry);
         else if(g_virtual[i].order_type==ORDER_TYPE_BUY_STOP) filled = (ask>=g_virtual[i].entry);
         else if(g_virtual[i].order_type==ORDER_TYPE_SELL_STOP) filled = (bid<=g_virtual[i].entry);
         else if(g_virtual[i].order_type==ORDER_TYPE_BUY || g_virtual[i].order_type==ORDER_TYPE_SELL) filled = true; // market

         if(filled)
         {
            g_virtual[i].state=V_IN_POSITION;
            g_virtual[i].filled_at=now;
            UpdateSignalVirtualFilled(g_virtual[i].signal_id,g_virtual[i].entry,now);
         }
      }
      else if(g_virtual[i].state==V_IN_POSITION)
      {
         bool sl_hit=false, tp_hit=false;
         double exit_price=0;

         if(g_virtual[i].dir>0)
         {
            if(bid<=g_virtual[i].sl){ sl_hit=true; exit_price=g_virtual[i].sl; }
            else if(bid>=g_virtual[i].tp){ tp_hit=true; exit_price=g_virtual[i].tp; }
         }
         else if(g_virtual[i].dir<0)
         {
            if(ask>=g_virtual[i].sl){ sl_hit=true; exit_price=g_virtual[i].sl; }
            else if(ask<=g_virtual[i].tp){ tp_hit=true; exit_price=g_virtual[i].tp; }
         }

         if(sl_hit || tp_hit)
         {
            string result = tp_hit?"WIN":"LOSS";
            // normalized P/L in R-multiples (virtual only)
            double pl = tp_hit? RewardRR : -1.0;
            UpdateSignalResultById(g_virtual[i].signal_id,exit_price,pl,result,sl_hit,tp_hit,g_virtual[i].filled_at);
            g_virtual[i].signal_id=0;
         }
      }
   }
}

void UpdateSignalResultWithOpenTime(ulong ticket,double exit_price,double profit_loss,const string result,bool sl_hit,bool tp_hit,datetime open_time)
{
   datetime now=TimeCurrent();
   int duration=0;
   if(open_time>0) duration=(int)((now-open_time)/60);
   
   string payload="{"+
   "\"order_ticket\":\""+ULongToString(ticket)+"\","+
   "\"exit_price\":"+DoubleToString(exit_price,_Digits)+","+
   "\"profit_loss\":"+DoubleToString(profit_loss,2)+","+
   "\"actual_result\":\""+result+"\","+
   "\"closed_at\":\""+TimeToString(now,TIME_DATE|TIME_SECONDS)+"\","+
   "\"hold_duration_minutes\":"+IntegerToString(duration)+","+
   "\"sl_hit\":"+(sl_hit?"true":"false")+","+
   "\"tp_hit\":"+(tp_hit?"true":"false")+"}";
   
   string resp;
   if(!HttpPut(AI_Signals_URL,AI_Bearer_Token,payload,resp,3000)){
      SafePrint("[AI_SIGNALS] Failed to update result");
   }else{
      SafePrint(StringFormat("[AI_SIGNALS] Updated: ticket=%s result=%s P/L=%.2f",ULongToString(ticket),result,profit_loss));
   }
}

void UpdateSignalResult(ulong ticket,double exit_price,double profit_loss,const string result,bool sl_hit,bool tp_hit)
{
   UpdateSignalResultWithOpenTime(ticket,exit_price,profit_loss,result,sl_hit,tp_hit,g_trackedPositionOpenTime);
}

void CancelSignal(ulong ticket,const string reason)
{
   string payload="{"+
   "\"order_ticket\":\""+ULongToString(ticket)+"\","+
   "\"actual_result\":\"CANCELLED\","+
   "\"cancelled_reason\":\""+JsonEscape(reason)+"\"}";
   
   string resp;
   HttpPut(AI_Signals_URL,AI_Bearer_Token,payload,resp,3000);
}

// ===== 注文関連 =====
void MaybeRecordVirtualSkip(const string decision_code,const TechSignal &t,double rsi,const AIOut &ai,int expiry_min)
{
   if(!ShouldVirtualTrack(decision_code)) return;

   double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID), ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   double slDist=t.atr*RiskATRmult, tpDist=slDist*RewardRR;
   double planned_entry=0, planned_sl=0, planned_tp=0; int planned_type=-1;
   if(t.dir>0){ planned_entry=ask; planned_sl=ask-slDist; planned_tp=ask+tpDist; planned_type=ORDER_TYPE_BUY; }
   else if(t.dir<0){ planned_entry=bid; planned_sl=bid+slDist; planned_tp=bid-tpDist; planned_type=ORDER_TYPE_SELL; }
   else return;

   long sid=RecordSignal("M15",t.dir,rsi,t.atr,t.ref,t.reason,ai,0,0,false,true,planned_entry,planned_sl,planned_tp,planned_type,expiry_min);
   if(sid<=0) return;

   VirtualWatch w;
   w.signal_id=sid;
   w.state=V_WAIT_FILL;
   w.created_at=TimeCurrent();
   w.expiry_at=w.created_at+(expiry_min*60);
   w.filled_at=0;
   w.dir=t.dir;
   w.order_type=planned_type;
   w.entry=planned_entry;
   w.sl=planned_sl;
   w.tp=planned_tp;

   int vidx=TrackVirtual(w);
   if(vidx>=0){
      // market-style virtual = immediately filled
      g_virtual[vidx].state=V_IN_POSITION;
      g_virtual[vidx].filled_at=g_virtual[vidx].created_at;
      UpdateSignalVirtualFilled(g_virtual[vidx].signal_id,g_virtual[vidx].entry,g_virtual[vidx].filled_at);
   }
}

// Parse timeframe string to ENUM_TIMEFRAMES
ENUM_TIMEFRAMES ParseTF(const string s){
   if(s=="M1") return PERIOD_M1;
   if(s=="M5") return PERIOD_M5;
   if(s=="M15") return PERIOD_M15;
   if(s=="M30") return PERIOD_M30;
   if(s=="H1") return PERIOD_H1;
   if(s=="H4") return PERIOD_H4;
   if(s=="D1") return PERIOD_D1;
   return PERIOD_M5;
}

bool OrderAlive(ulong t){if(t==0)return false;if(!OrderSelect(t))return false;long ty;OrderGetInteger(ORDER_TYPE,ty);
   return(ty==ORDER_TYPE_BUY_LIMIT||ty==ORDER_TYPE_SELL_LIMIT||ty==ORDER_TYPE_BUY_STOP||ty==ORDER_TYPE_SELL_STOP);} 
bool Expired(){return g_pendingTicket>0&&(TimeCurrent()-g_pendingAt)>(g_dynamicExpiryMin*60);}
void Cancel(string why){if(g_pendingTicket==0)return;if(OrderSelect(g_pendingTicket)){
   trade.OrderDelete(g_pendingTicket);SafePrint("[ORDER] canceled: "+why);}
   g_pendingTicket=0;g_pendingDir=0;g_pendingAt=0;}

// ポジション数チェック（アクティブポジション + (任意) ペンディングオーダー）
int CountPositions()
{
   int count=0;
   
   // アクティブポジションをカウント
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong ticket=PositionGetTicket(i);
      if(ticket<=0) continue;
      if(PositionGetString(POSITION_SYMBOL)!=_Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC)!=Magic) continue;
      count++;
   }
   
   if(CountPendingOrdersInMaxPos)
   {
      // ペンディングオーダーもカウント（約定待ちも含める）
      for(int i=OrdersTotal()-1;i>=0;i--)
      {
         ulong ticket=OrderGetTicket(i);
         if(ticket<=0) continue;
         if(OrderGetString(ORDER_SYMBOL)!=_Symbol) continue;
         if(OrderGetInteger(ORDER_MAGIC)!=Magic) continue;
         
         // ペンディングオーダーのみ（約定待ち）
         long order_type=OrderGetInteger(ORDER_TYPE);
         if(order_type==ORDER_TYPE_BUY_LIMIT || 
            order_type==ORDER_TYPE_SELL_LIMIT ||
            order_type==ORDER_TYPE_BUY_STOP || 
            order_type==ORDER_TYPE_SELL_STOP)
         {
            count++;
         }
      }
   }
   
   return count;
}

// ===== バー処理 =====
void OnM15NewBar()
{
   // TP/SL後のクールダウン中は一切の新規アクションを停止
   if(InCooldown()){
      SafePrint(StringFormat("[M15] cooldown active for %d sec",(int)(g_cooldownUntil-TimeCurrent())));
      return;
   }
   
   TechSignal t=Evaluate(TF_Entry); if(t.dir==0)return;
   int tech_dir=t.dir;
   double rsi=RSIv(PERIOD_M15,14,PRICE_CLOSE,0);
   AIOut ai; if(!QueryAI("M15",t.dir,rsi,t.atr,t.ref,t.reason,t.ichimoku_score,ai))return;

   int suggested_dir = (ai.suggested_dir!=0?ai.suggested_dir:tech_dir);
   int decision_dir = ai.action; // 0なら見送り

   int posCount=CountPositions();
   // Dynamic threshold (lowering only) + EV gate
   double effectiveMin=MinWinProb;
   if(ai.recommended_min_win_prob>0.0 && ai.recommended_min_win_prob<effectiveMin) effectiveMin=ai.recommended_min_win_prob;
   double ev_r = (ai.expected_value_r>-100.0 ? ai.expected_value_r : (ai.win_prob*RewardRR - (1.0-ai.win_prob)*1.0));
   double ev_gate = (effectiveMin*RewardRR - (1.0-effectiveMin)*1.0);
   // 二重ガード:
   // 1) Functions側が action=0 を返した場合は必ず見送る
   // 2) EA設定の MinWinProb 未満では絶対に発注しない（誤作動防止）
   bool threshold_met=(ai.action!=0 && ai.win_prob>=MinWinProb);

   // derive expiry minutes for virtual tracking
   int expiry_min = PendingExpiryMin;
   if(ai.expiry_min>0) expiry_min=ai.expiry_min;
   
   if(threshold_met){
      // 以降の注文・仮想・記録は方向を統一
      TechSignal t_exec=t; t_exec.dir=decision_dir;
      TechSignal t_plan=t; t_plan.dir=suggested_dir;

      // market-only 運用向け H1 事前チェック（約定数を落としすぎないよう調整可能）
      if(H1PrecheckMode>0)
      {
         TechSignal h1t=Evaluate(TF_Recheck);
         int h1_tech_dir=(h1t.dir!=0?h1t.dir:decision_dir);
         double h1_rsi=RSIv(PERIOD_H1,14,PRICE_CLOSE,0);
         AIOut h1ai;
         bool h1_ok=QueryAI("H1",h1_tech_dir,h1_rsi,h1t.atr,h1t.ref,h1t.reason,h1t.ichimoku_score,h1ai);
         if(!h1_ok){
            LogAIDecision("H1",0,h1_rsi,h1t.atr,h1t.ref,h1t.reason,h1ai,"H1_QUERY_FAIL",false,posCount,0,h1_tech_dir);
            if(!H1FailOpen){
               SafePrint("[M15] skip: H1 precheck query failed (fail-open=false)");
               return;
            }
            SafePrint("[M15] H1 precheck query failed -> continue (fail-open)");
         }
         else
         {
            int h1_suggested_dir=(h1ai.suggested_dir!=0?h1ai.suggested_dir:h1ai.action);
            bool h1_opposite=(h1_suggested_dir!=0 && h1_suggested_dir!=decision_dir);
            bool h1_prob_ok=(h1ai.win_prob>=H1PrecheckMinProb);
            bool block=false;

            if(H1PrecheckMode==1)
            {
               // SOFT: 強い逆方向シグナルのときだけブロック
               if(h1_opposite && h1ai.action!=0 && h1ai.win_prob>=H1OppositeBlockProb) block=true;
            }
            else
            {
               // STRICT: H1の方向一致 + 最低確率を必須化
               if(h1ai.action==0 || !h1_prob_ok || h1_opposite) block=true;
            }

            if(block)
            {
               LogAIDecision("H1",h1ai.action,h1_rsi,h1t.atr,h1t.ref,h1t.reason,h1ai,"SKIPPED_H1_PRECHECK",h1_prob_ok,posCount,0,h1_tech_dir);
               SafePrint(StringFormat("[M15] skip: H1 precheck blocked (mode=%d h1_action=%d h1_prob=%.0f%% h1_dir=%d m15_dir=%d)",
                  H1PrecheckMode,h1ai.action,h1ai.win_prob*100,h1_suggested_dir,decision_dir));
               return;
            }

            LogAIDecision("H1",h1ai.action,h1_rsi,h1t.atr,h1t.ref,h1t.reason,h1ai,"H1_PRECHECK_OK",h1_prob_ok,posCount,0,h1_tech_dir);
         }
      }

      // ポジション数チェック（ペンディングは設定で任意）
      if(posCount>=MaxPositions){
         LogAIDecision("M15",decision_dir,rsi,t.atr,t.ref,t.reason,ai,"SKIPPED_MAX_POS",threshold_met,posCount,0,tech_dir);
         if(CountPendingOrdersInMaxPos)
            SafePrint(StringFormat("[M15] skip: already %d position(s) or pending order(s)",posCount));
         else
            SafePrint(StringFormat("[M15] skip: already %d position(s)",posCount));
         MaybeRecordVirtualSkip("SKIPPED_MAX_POS",t_plan,rsi,ai,expiry_min);
         return;
      }
      
      // 単一運用(MaxPositions<=1)のときだけ、追跡中ポジションがあれば新規を止める（重複防止）
      // MaxPositions>1 の場合は複数追跡に切り替えるため、ここで止めない。
      if(MaxPositions<=1)
      {
         if(g_trackedPositionTicket>0 && PositionSelectByTicket(g_trackedPositionTicket)){
            LogAIDecision("M15",decision_dir,rsi,t.atr,t.ref,t.reason,ai,"SKIPPED_TRACKED_POS",threshold_met,1,g_trackedPositionTicket,tech_dir);
            SafePrint(StringFormat("[M15] skip: tracked position active (ticket=%s)",ULongToString(g_trackedPositionTicket)));
            MaybeRecordVirtualSkip("SKIPPED_TRACKED_POS",t_plan,rsi,ai,expiry_min);
            return;
         }
      }
      
      if(OrderAlive(g_pendingTicket)){
         CancelSignal(g_pendingTicket,"replace");
         Cancel("replace");
      }

      trade.SetExpertMagicNumber(Magic);
      trade.SetDeviationInPoints(SlippagePoints);

      // ⭐ ML学習データに基づくロット倍率を適用（最大値制限あり）
      double finalLots = MathMin(Lots * ai.lot_multiplier, MaxLots);
      double normLots=finalLots; string lotWhy="";
      if(!NormalizeLotsForSymbol(finalLots,normLots,lotWhy)){
         LogAIDecision("M15",decision_dir,rsi,t.atr,t.ref,t.reason,ai,"SKIPPED_INVALID_LOT",threshold_met,posCount,0,tech_dir);
         SafePrint(StringFormat("[LOT] skip: %s",lotWhy));
         return;
      }
      finalLots=normLots;
      if(ai.lot_multiplier > 1.0){
         SafePrint(StringFormat("[M15] Dynamic Lot Sizing: %.2fx (%.2f → %.2f) - %s",
                   ai.lot_multiplier, Lots, finalLots, ai.lot_level));
      }

      // Market-only execution
      double slDist=t_exec.atr*RiskATRmult, tpDist=slDist*RewardRR;
      double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID), ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
      double planned_entry=0, planned_sl=0, planned_tp=0; int planned_type=-1;
      bool ok=false; double entry=0.0; ulong posTicket=0; ulong ordTicket=0;

      if(t_exec.dir>0){ planned_entry=ask; planned_sl=ask-slDist; planned_tp=ask+tpDist; planned_type=ORDER_TYPE_BUY; }
      else{ planned_entry=bid; planned_sl=bid+slDist; planned_tp=bid-tpDist; planned_type=ORDER_TYPE_SELL; }

      if(t_exec.dir>0){
         ok=trade.Buy(finalLots,_Symbol,0,planned_sl,planned_tp);
         if(ok){
            ordTicket=trade.ResultOrder();
            if(PositionSelect(_Symbol)){
               posTicket=(ulong)PositionGetInteger(POSITION_TICKET);
               entry=PositionGetDouble(POSITION_PRICE_OPEN);
            }
         }
      }else{
         ok=trade.Sell(finalLots,_Symbol,0,planned_sl,planned_tp);
         if(ok){
            ordTicket=trade.ResultOrder();
            if(PositionSelect(_Symbol)){
               posTicket=(ulong)PositionGetInteger(POSITION_TICKET);
               entry=PositionGetDouble(POSITION_PRICE_OPEN);
            }
         }
      }

      if(ok && posTicket>0 && ordTicket>0){
         datetime openTime=0;
         if(PositionSelectByTicket(posTicket)) openTime=(datetime)PositionGetInteger(POSITION_TIME);
         AddTrackedTrade(posTicket,ordTicket,openTime,entry);

         // legacy single-slot (last executed)
         g_trackedPositionTicket=posTicket;
         g_trackedOrderTicket=ordTicket;
         g_trackedPositionOpenTime=openTime;
         g_trackedPositionEntryPrice=entry;
         g_trackedFillSent=false;
         g_trackedFillLastTry=0;

         // ai_signals.order_ticket is the order ticket key
         RecordSignal("M15",t_exec.dir,rsi,t_exec.atr,t_exec.ref,t_exec.reason,ai,ordTicket,entry,true,false,planned_entry,planned_sl,planned_tp,planned_type,expiry_min,ai.lot_multiplier,ai.lot_level,ai.lot_reason,finalLots);
         LogAIDecision("M15",decision_dir,rsi,t_exec.atr,t_exec.ref,t_exec.reason,ai,"EXECUTED_MARKET",threshold_met,posCount,ordTicket,tech_dir,finalLots);
         SafePrint(StringFormat("[M15] market executed dir=%d prob=%.0f%% lot=%.2f",t_exec.dir,ai.win_prob*100,finalLots));
      }else{
         SafePrint("[M15] market execution failed");
      }
   }else{
      TechSignal t_plan=t; t_plan.dir=(ai.suggested_dir!=0?ai.suggested_dir:tech_dir);
      LogAIDecision("M15",ai.action,rsi,t.atr,t.ref,t.reason,ai,"SKIPPED_LOW_PROB",threshold_met,posCount,0,tech_dir);
      if(ai.action==0){
         SafePrint(StringFormat("[M15] skip: server action=0 (prob=%.0f%% eff=%.0f%% ev=%.2f gate=%.2f method=%s reason=%s)",
            ai.win_prob*100,effectiveMin*100,ev_r,ev_gate,ai.entry_method,ai.skip_reason));
      }else{
         SafePrint(StringFormat("[M15] skip: below threshold (prob=%.0f%% < eff=%.0f%% and ev=%.2f < gate=%.2f)",
            ai.win_prob*100,effectiveMin*100,ev_r,ev_gate));
      }

      // 検証用: 「実トレード閾値未満」だが一定以上の勝率帯は仮想トレードとして記録（実トレードはしない）
      // 上限は MT5設定 + サーバ推奨(下げ方向のみ) を反映した effectiveMin に追従させる
      // ガード由来（entry_method=none / skip_reason=guard）は除外
      double vUpper = MathMin(effectiveMin, VirtualLowBandMaxProb);
      if(vUpper>VirtualLowBandMinProb && ai.win_prob>=VirtualLowBandMinProb && ai.win_prob<vUpper && ai.entry_method!="none" && ai.skip_reason!="guard")
      {
         MaybeRecordVirtualSkip("SKIPPED_LOW_BAND",t_plan,rsi,ai,expiry_min);
      }

      // action=0（サーバ側で最終見送り）でも高勝率なら仮想として残す
      // 例: ML高品質パターン vs テクニカル矛盾など。検証/後学習/説明用にスナップショットが必要。
      if(ai.action==0 && ai.win_prob>=VirtualLowBandMaxProb && ai.entry_method!="none" && ai.skip_reason!="guard")
      {
         MaybeRecordVirtualSkip("SKIPPED_ACTION_0",t_plan,rsi,ai,expiry_min);
      }
   }
}

void OnH1NewBar()
{
   // クールダウン中は再チェック・キャンセル等も行わない
   if(InCooldown()){
      SafePrint(StringFormat("[H1] cooldown active for %d sec",(int)(g_cooldownUntil-TimeCurrent())));
      return;
   }
   
   if(g_pendingTicket==0)return;
   if(!OrderAlive(g_pendingTicket)){Cancel("filled");return;}
   if(Expired()){
      CancelSignal(g_pendingTicket,"expired");
      Cancel("expired");
      return;
   }
   TechSignal t=Evaluate(TF_Recheck);
   int tech_dir=t.dir;
   double rsi=RSIv(PERIOD_H1,14,PRICE_CLOSE,0);
   AIOut ai; if(!QueryAI("H1",t.dir,rsi,t.atr,t.ref,t.reason,t.ichimoku_score,ai))return;
   
   int posCount=CountPositions();
   double effectiveMin=MinWinProb;
   if(ai.recommended_min_win_prob>0.0 && ai.recommended_min_win_prob<effectiveMin) effectiveMin=ai.recommended_min_win_prob;
   double ev_r = (ai.expected_value_r>-100.0 ? ai.expected_value_r : (ai.win_prob*RewardRR - (1.0-ai.win_prob)*1.0));
   double ev_gate = (effectiveMin*RewardRR - (1.0-effectiveMin)*1.0);
   // 二重ガード（H1再判定でも同様）
   bool threshold_met=(ai.action!=0 && ai.win_prob>=MinWinProb);
   int suggested_dir = (ai.suggested_dir!=0?ai.suggested_dir:tech_dir);
   bool rev=(suggested_dir!=0 && suggested_dir!=g_pendingDir);
   
   if(rev&&!threshold_met){
      LogAIDecision("H1",ai.action,rsi,t.atr,t.ref,t.reason,ai,"CANCELLED_REVERSAL",threshold_met,posCount,g_pendingTicket,tech_dir);
      CancelSignal(g_pendingTicket,"trend-reversed");
      Cancel("trend-reversed");
   }else{
      LogAIDecision("H1",ai.action,rsi,t.atr,t.ref,t.reason,ai,"RECHECK_OK",threshold_met,posCount,g_pendingTicket,tech_dir);
      SafePrint("[H1] still valid");
   }
}

// ===== ポジション監視（ML学習用） =====
void CheckPositionStatus()
{
   // Ensure entry_price is recorded for tracked positions (market orders can report entry_price=0 right after OrderSend)
   datetime now=TimeCurrent();
   for(int ti=0; ti<ArraySize(g_tracked); ti++)
   {
      if(g_tracked[ti].order_ticket==0 || g_tracked[ti].position_ticket==0) continue;
      if(g_tracked[ti].fill_sent) continue;
      // try at most once per 60 seconds per trade
      if(g_tracked[ti].fill_last_try!=0 && (now - g_tracked[ti].fill_last_try) < 60) continue;
      g_tracked[ti].fill_last_try=now;

      if(PositionSelectByTicket(g_tracked[ti].position_ticket))
      {
         double ep=PositionGetDouble(POSITION_PRICE_OPEN);
         if(MathIsValidNumber(ep) && ep>0)
         {
            g_tracked[ti].entry_price=ep;
            string payload="{\"order_ticket\":\""+ULongToString(g_tracked[ti].order_ticket)+"\""+
                           ",\"entry_price\":"+DoubleToString(ep,_Digits)+
                           ",\"actual_result\":\"FILLED\"}";
            string resp;
            if(HttpPostJson(AI_Signals_Update_URL,AI_Bearer_Token,payload,resp,3000))
            {
               g_tracked[ti].fill_sent=true;
               SafePrint(StringFormat("[AI_SIGNALS_UPDATE] Filled confirmed order=%s entry=%.5f",ULongToString(g_tracked[ti].order_ticket),ep));
            }
         }
      }
   }

   // ペンディングオーダーが約定したかチェック
   if(g_pendingTicket>0 && !OrderAlive(g_pendingTicket)){
      // NOTE: Order ticket != Position ticket. When the pending order is filled, find the new position by symbol+magic.
      ulong posTicket=0;
      datetime openTime=0;
      double entryPrice=0.0;

      // Prefer exact mapping via deals history: DEAL_ORDER == g_pendingTicket
      datetime now=TimeCurrent();
      if(HistorySelect(now-7*86400, now))
      {
         int total=HistoryDealsTotal();
         for(int i=total-1;i>=0;i--)
         {
            ulong dealTicket=HistoryDealGetTicket(i);
            if(dealTicket<=0) continue;
            if((ulong)HistoryDealGetInteger(dealTicket,DEAL_ORDER) != g_pendingTicket) continue;
            if(HistoryDealGetString(dealTicket,DEAL_SYMBOL) != _Symbol) continue;
            if((long)HistoryDealGetInteger(dealTicket,DEAL_MAGIC) != Magic) continue;
            if(HistoryDealGetInteger(dealTicket,DEAL_ENTRY) != DEAL_ENTRY_IN) continue;

            posTicket=(ulong)HistoryDealGetInteger(dealTicket,DEAL_POSITION_ID);
            openTime=(datetime)HistoryDealGetInteger(dealTicket,DEAL_TIME);
            entryPrice=HistoryDealGetDouble(dealTicket,DEAL_PRICE);
            break;
         }
      }

      // Fallback: pick newest untracked position by symbol+magic
      if(posTicket==0)
      {
         datetime newest=0;
         for(int i=PositionsTotal()-1;i>=0;i--)
         {
            ulong t=PositionGetTicket(i);
            if(t<=0) continue;
            if(PositionGetString(POSITION_SYMBOL)!=_Symbol) continue;
            if(PositionGetInteger(POSITION_MAGIC)!=Magic) continue;
            if(IsPositionTracked(t)) continue;
            datetime ot=(datetime)PositionGetInteger(POSITION_TIME);
            if(posTicket==0 || ot>newest){ posTicket=t; newest=ot; }
         }
         if(posTicket>0 && PositionSelectByTicket(posTicket))
         {
            openTime=(datetime)PositionGetInteger(POSITION_TIME);
            entryPrice=PositionGetDouble(POSITION_PRICE_OPEN);
         }
      }

      if(posTicket>0){
         AddTrackedTrade(posTicket,g_pendingTicket,openTime,entryPrice);

         // legacy single-slot (last filled)
         g_trackedPositionTicket=posTicket;
         g_trackedOrderTicket=g_pendingTicket;
         g_trackedPositionOpenTime=openTime;
         g_trackedPositionEntryPrice=entryPrice;
         g_trackedFillSent=false;
         g_trackedFillLastTry=0;

         // シグナル更新（エントリー価格を記録） - order_ticketキーで更新
         string payload="{\"order_ticket\":\""+ULongToString(g_trackedOrderTicket)+"\""+
                        ",\"entry_price\":"+DoubleToString(g_trackedPositionEntryPrice,_Digits)+
                        ",\"actual_result\":\"FILLED\"}";
         string resp;
         HttpPostJson(AI_Signals_Update_URL,AI_Bearer_Token,payload,resp,3000);

         SafePrint(StringFormat("[POSITION] Filled order=%s pos=%s at %.5f",ULongToString(g_trackedOrderTicket),ULongToString(g_trackedPositionTicket),g_trackedPositionEntryPrice));
      }else{
         // Order disappeared but no position exists -> treat as cancelled to avoid stale PENDING rows.
         CancelSignal(g_pendingTicket,"filled_not_found");
      }

      // ペンディングチケットをリセット（重複ログ防止）
      g_pendingTicket=0;
      g_pendingDir=0;
      g_pendingAt=0;
   }
   
   // 追跡中のポジションがクローズされたかチェック
   for(int ti=0; ti<ArraySize(g_tracked); ti++)
   {
      if(g_tracked[ti].position_ticket==0) continue;
      if(PositionSelectByTicket(g_tracked[ti].position_ticket)) continue;

      // ポジションがクローズされた - 履歴から結果を取得
      if(HistorySelectByPosition(g_tracked[ti].position_ticket))
      {
         int total=HistoryDealsTotal();
         for(int i=total-1;i>=0;i--)
         {
            ulong dealTicket=HistoryDealGetTicket(i);
            if(dealTicket>0 && (ulong)HistoryDealGetInteger(dealTicket,DEAL_POSITION_ID)==g_tracked[ti].position_ticket)
            {
               if(HistoryDealGetInteger(dealTicket,DEAL_ENTRY)==DEAL_ENTRY_OUT)
               {
                  double exit_price=HistoryDealGetDouble(dealTicket,DEAL_PRICE);
                  double profit=HistoryDealGetDouble(dealTicket,DEAL_PROFIT);
                  long deal_reason=HistoryDealGetInteger(dealTicket,DEAL_REASON);

                  bool sl_hit=(deal_reason==DEAL_REASON_SL);
                  bool tp_hit=(deal_reason==DEAL_REASON_TP);

                  string result="BREAK_EVEN";
                  if(profit>0.01) result="WIN";
                  else if(profit<-0.01) result="LOSS";

                  ulong keyTicket=(g_tracked[ti].order_ticket>0?g_tracked[ti].order_ticket:g_tracked[ti].position_ticket);
                  UpdateSignalResultWithOpenTime(keyTicket,exit_price,profit,result,sl_hit,tp_hit,g_tracked[ti].open_time);

                  // ★ TP/SL時のみクールダウンを設定
                  if(sl_hit || tp_hit){
                     g_cooldownUntil = TimeCurrent() + (CooldownAfterCloseMin*60);
                     SafePrint(StringFormat("[COOLDOWN] Start %d min after %s (pos=%s)",
                        CooldownAfterCloseMin, (tp_hit?"TP":"SL"), ULongToString(g_tracked[ti].position_ticket)));
                  }

                  // legacy single-slot reset if it matches
                  if(g_trackedPositionTicket==g_tracked[ti].position_ticket){
                     g_trackedPositionTicket=0;
                     g_trackedOrderTicket=0;
                     g_trackedPositionOpenTime=0;
                     g_trackedPositionEntryPrice=0;
                     g_trackedFillSent=false;
                     g_trackedFillLastTry=0;
                  }

                  ClearTrackedSlot(ti);
                  break;
               }
            }
         }
      }
   }

   // Virtual (paper) trade tracking loop
   CheckVirtualWatches();
}

// ===== メイン =====
int OnInit(){
   trade.SetExpertMagicNumber(Magic);

   if(RequireBearerToken && AI_Bearer_Token=="" && EA_Log_Bearer_Token==""){
      Alert("ERROR: Bearer token is not set! (RequireBearerToken=true)");
      Print("[INIT] ERROR: AI_Bearer_Token and EA_Log_Bearer_Token are empty");
      return(INIT_FAILED);
   }

   int cap=(VirtualMaxWatches<10?10:VirtualMaxWatches);
   ArrayResize(g_virtual,cap);

   int tcap=(TrackedMaxTrades<1?1:TrackedMaxTrades);
   ArrayResize(g_tracked,tcap);
   for(int i=0;i<ArraySize(g_tracked);i++) ClearTrackedSlot(i);

   // Rehydrate tracking so WIN/LOSS updates won't stall after restart.
   RehydrateTrackingFromExistingPositions();

   SafePrint(StringFormat("[INIT] AwajiSamurai_AI_2.0 %s start (build %s)", AI_EA_Version, __DATE__));
   SafePrint(StringFormat("[CONFIG] Using EA properties -> MinWinProb=%.0f%%, Risk=%.2f, RR=%.2f, Lots=%.2f, MaxPos=%d",
      MinWinProb*100,RiskATRmult,RewardRR,Lots,MaxPositions));
   SafePrint("[INFO] Sending EMA25, SMA100, SMA200, SMA800, MACD, RSI, ATR, Ichimoku (all lines) to AI");
   SafePrint("[FIX] v1.5.1: Enhanced duplicate position prevention (pending orders + tracked positions)");
   SafePrint(StringFormat("[VIRTUAL] Enabled=%s (MAX_POS=%s, TRACKED_POS=%s)",
      (EnableVirtualLearning?"true":"false"),
      (VirtualTrack_SkippedMaxPos?"true":"false"),
      (VirtualTrack_SkippedTrackedPos?"true":"false")
   ));
   SafePrint(StringFormat("[VIRTUAL] Watch capacity=%d", ArraySize(g_virtual)));
   SafePrint(StringFormat("[TRACK] Multi tracking capacity=%d (CountPendingInMaxPos=%s)", ArraySize(g_tracked), (CountPendingOrdersInMaxPos?"true":"false")));
   return(INIT_SUCCEEDED);
}
void OnTick()
{
   if(LockToChartSymbol && _Symbol!=Symbol())return;
   
   // ポジション状態監視（ML学習用）
   CheckPositionStatus();
   
   if(iTime(_Symbol,TF_Entry,0)!=g_lastBar_M15){g_lastBar_M15=iTime(_Symbol,TF_Entry,0);OnM15NewBar();}
   if(iTime(_Symbol,TF_Recheck,0)!=g_lastBar_H1){g_lastBar_H1=iTime(_Symbol,TF_Recheck,0);OnH1NewBar();}
}
void OnDeinit(const int reason){SafePrint("[DEINIT] stopped;");}
