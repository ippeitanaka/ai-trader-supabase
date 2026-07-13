//+------------------------------------------------------------------+
//| AwajiSamurai_AI_2.0.mq5  (ver 1.7.0)                            |
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
//| - v1.5.x: 重複ポジション防止と追跡機能を強化                   |
//| - v1.6.0: サーバー v2.7.0 対応 (STREAK_GUARD / RECENT_PERF /    |
//|          RSI_MR_BONUS / CALIBRATION)。skip_reasonに streak_guard  |
//|          タグが追加される。AI_EA_Versionを1.6.0に更新。          |
//| - v1.7.0: 固定ロット・market-only化、H1を監査専用へ変更         |
//+------------------------------------------------------------------+
#property strict
#include <Trade/Trade.mqh>
CTrade trade;

// ===== 運用者が設定する項目 =====
input group "01 資金・建玉管理"
input double BaseLotSize             = 0.10;
input int    MaxSlippagePoints       = 1000;
input long   ExpertMagicNumber       = 26091501;
input int    MaxOpenTrades           = 1;

input group "02 API 認証"
input string AIBearerToken           = "";
input string EALogBearerToken        = "";

// ===== システム管理設定（MT5プロパティから変更不可） =====
#define TF_Entry PERIOD_M15
#define TF_Recheck PERIOD_H1
#define MinWinProb 0.50
#define ServerMinWinProb 0.55
#define RiskATRmult 2.0
#define RewardRR 1.5
#define PendingExpiryMin 90
#define Lots BaseLotSize
#define SlippagePoints MaxSlippagePoints
#define Magic ExpertMagicNumber
#define MaxPositions MaxOpenTrades
#define TrackedMaxTrades 10
#define DebugLogs true
#define LogCooldownSec 30
#define CooldownAfterCloseMin 30
#define H1AuditEnabled true
#define H1OppositeBlockProb 0.78
#define UseAIForDirection false
#define CandleBarsToSend 12
#define EnableVirtualLearning true
#define VirtualMaxWatches 2000
#define AI_Endpoint_URL "https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ai-trader"
#define EA_Log_URL "https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ea-log"
#define AI_Signals_URL "https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ai-signals"
#define AI_Signals_Update_URL "https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ai-signals-update"
#define AI_Bearer_Token AIBearerToken
#define EA_Log_Bearer_Token EALogBearerToken
#define AI_EA_Instance "main"
#define AI_EA_Version "1.7.0"
#define AI_Timeout_ms 10000
#define UseIchimoku true
#define Ichimoku_Tenkan 9
#define Ichimoku_Kijun 26
#define Ichimoku_Senkou 52

// ===== 内部変数 =====
datetime g_lastBar_M15=0;
datetime g_lastLogTs=0;
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
   double   mfe_r;
   double   mae_r;
   double   reward_rr;
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
bool UpdateSignalResultById(long signal_id,double exit_price,double profit_loss,const string result,bool sl_hit,bool tp_hit,datetime filled_at=0,double mfe_r=0.0,double mae_r=0.0)
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
   "\"mfe_r\":"+DoubleToString(mfe_r,3)+","+
   "\"mae_r\":"+DoubleToString(mae_r,3)+","+
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
   return (EnableVirtualLearning && StringLen(decision_code)>0);
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

// ===== Candle pattern helpers =====
struct CandleFeatures{
   int bull_engulfing;
   int bear_engulfing;
   int bull_pinbar;
   int bear_pinbar;
   int inside_bar;
   int inside_break_dir;
   int strict_engulfing_dir;
   int strict_inside_break_dir;
   int three_up;
   int three_down;
   int bull_reversal_score;
   int bear_reversal_score;
   int bull_continuation_score;
   int bear_continuation_score;
};

bool GetOHLC(const ENUM_TIMEFRAMES tf,const int shift,double &o,double &h,double &l,double &c)
{
   o=iOpen(_Symbol,tf,shift);
   h=iHigh(_Symbol,tf,shift);
   l=iLow(_Symbol,tf,shift);
   c=iClose(_Symbol,tf,shift);
   if(!MathIsValidNumber(o) || !MathIsValidNumber(h) || !MathIsValidNumber(l) || !MathIsValidNumber(c)) return false;
   if(h<=0 || l<=0 || o<=0 || c<=0) return false;
   if(h<l) return false;
   return true;
}

double BodySize(const double o,const double c)
{
   return MathAbs(c-o);
}

double CandleRangeValue(const double h,const double l)
{
   return MathAbs(h-l);
}

CandleFeatures AnalyzeCandleFeatures(const ENUM_TIMEFRAMES tf)
{
   CandleFeatures cf;
   cf.bull_engulfing=0;
   cf.bear_engulfing=0;
   cf.bull_pinbar=0;
   cf.bear_pinbar=0;
   cf.inside_bar=0;
   cf.inside_break_dir=0;
   cf.strict_engulfing_dir=0;
   cf.strict_inside_break_dir=0;
   cf.three_up=0;
   cf.three_down=0;
   cf.bull_reversal_score=0;
   cf.bear_reversal_score=0;
   cf.bull_continuation_score=0;
   cf.bear_continuation_score=0;

   double o1,h1,l1,c1,o2,h2,l2,c2,o3,h3,l3,c3;
   if(!GetOHLC(tf,1,o1,h1,l1,c1)) return cf;
   if(!GetOHLC(tf,2,o2,h2,l2,c2)) return cf;
   if(!GetOHLC(tf,3,o3,h3,l3,c3)) return cf;

   double body1=BodySize(o1,c1), body2=BodySize(o2,c2), body3=BodySize(o3,c3);
   double range1=CandleRangeValue(h1,l1), range2=CandleRangeValue(h2,l2), range3=CandleRangeValue(h3,l3);
   double eps=MathMax(range1,range2)*0.05;

   // Engulfing (strict real-body engulf + dominant close)
   bool prev_bear=(c2<o2), prev_bull=(c2>o2);
   bool curr_bear=(c1<o1), curr_bull=(c1>o1);
   if(range1>0 && range2>0)
   {
      double close_pos=(c1-l1)/range1;
      double close_pos_bear=(h1-c1)/range1;
      bool bull_strict = prev_bear && curr_bull &&
         body2>=range2*0.35 &&
         body1>=range1*0.45 &&
         body1>=body2*1.10 &&
         o1<=c2+eps &&
         c1>=o2+eps &&
         close_pos>=0.70;
      bool bear_strict = prev_bull && curr_bear &&
         body2>=range2*0.35 &&
         body1>=range1*0.45 &&
         body1>=body2*1.10 &&
         o1>=c2-eps &&
         c1<=o2-eps &&
         close_pos_bear>=0.70;

      if(bull_strict){
         cf.bull_engulfing=1;
         cf.strict_engulfing_dir=1;
      }
      if(bear_strict){
         cf.bear_engulfing=1;
         cf.strict_engulfing_dir=-1;
      }
   }

   // Pin bar (wick/body based)
   double body=body1;
   double range=range1;
   if(range>0)
   {
      double upper_wick=h1-MathMax(o1,c1);
      double lower_wick=MathMin(o1,c1)-l1;
      if(lower_wick>=body*2.5 && upper_wick<=range*0.20 && body<=range*0.35) cf.bull_pinbar=1;
      if(upper_wick>=body*2.5 && lower_wick<=range*0.20 && body<=range*0.35) cf.bear_pinbar=1;
   }

   // Inside bar breakout uses 3 closed candles:
   // bar3=mother bar, bar2=inside bar, bar1=breakout bar
   if(range2>0 && range3>0)
   {
      double inside_margin=range3*0.02;
      bool has_inside=(h2<h3-inside_margin && l2>l3+inside_margin && range2<=range3*0.85);
      if(has_inside) cf.inside_bar=1;

      double breakout_eps=range3*0.05;
      bool bull_break = has_inside && curr_bull && body1>=range1*0.45 && range1>=range2*1.05 && c1>h3+breakout_eps;
      bool bear_break = has_inside && curr_bear && body1>=range1*0.45 && range1>=range2*1.05 && c1<l3-breakout_eps;
      if(bull_break){
         cf.inside_break_dir=1;
         cf.strict_inside_break_dir=1;
      }
      else if(bear_break){
         cf.inside_break_dir=-1;
         cf.strict_inside_break_dir=-1;
      }
   }

   // Simple 3-bar continuation sequence
   if(c1>o1 && c2>o2 && c3>o3 && c1>c2 && c2>c3 && l1>=l2 && l2>=l3 && body1>=range1*0.40 && body2>=range2*0.35) cf.three_up=1;
   if(c1<o1 && c2<o2 && c3<o3 && c1<c2 && c2<c3 && h1<=h2 && h2<=h3 && body1>=range1*0.40 && body2>=range2*0.35) cf.three_down=1;

   cf.bull_reversal_score = cf.bull_engulfing + cf.bull_pinbar + (cf.strict_inside_break_dir>0?1:0);
   cf.bear_reversal_score = cf.bear_engulfing + cf.bear_pinbar + (cf.strict_inside_break_dir<0?1:0);
   cf.bull_continuation_score = cf.three_up + (cf.strict_inside_break_dir>0?1:0);
   cf.bear_continuation_score = cf.three_down + (cf.strict_inside_break_dir<0?1:0);

   return cf;
}

string BuildRecentCandlesJson(const ENUM_TIMEFRAMES tf,const int requestedBars)
{
   int bars=requestedBars;
   if(bars<3) bars=3;
   if(bars>32) bars=32;

   MqlRates rates[];
   // start_pos=1 -> current forming barを除外して確定足のみ送る
   int copied=CopyRates(_Symbol,tf,1,bars,rates);
   if(copied<=0) return "[]";

   string out="[";
   bool first=true;
   for(int i=copied-1;i>=0;i--)
   {
      double o=rates[i].open;
      double h=rates[i].high;
      double l=rates[i].low;
      double c=rates[i].close;
      if(!MathIsValidNumber(o) || !MathIsValidNumber(h) || !MathIsValidNumber(l) || !MathIsValidNumber(c)) continue;
      if(o<=0 || h<=0 || l<=0 || c<=0 || h<l) continue;

      double body=MathAbs(c-o);
      double range=h-l;
      string t=TimeToString((datetime)rates[i].time,TIME_DATE|TIME_MINUTES);
      if(!first) out+=",";
      out+="{"+
         "\"t\":\""+JsonEscape(t)+"\","+
         "\"o\":"+DoubleToString(o,_Digits)+","+
         "\"h\":"+DoubleToString(h,_Digits)+","+
         "\"l\":"+DoubleToString(l,_Digits)+","+
         "\"c\":"+DoubleToString(c,_Digits)+","+
         "\"tv\":"+IntegerToString((int)rates[i].tick_volume)+","+
         "\"rv\":"+IntegerToString((int)rates[i].real_volume)+","+
         "\"body\":"+DoubleToString(body,_Digits)+","+
         "\"range\":"+DoubleToString(range,_Digits)+
      "}";
      first=false;
   }
   out+="]";
   return out;
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
struct TechSignal{
   int dir;
   string reason;
   double atr;
   double ref;
   double ichimoku_score;
   CandleFeatures candle;
};
TechSignal Evaluate(ENUM_TIMEFRAMES tf)
{
   TechSignal s; s.dir=0; s.reason=""; s.atr=ATRv(tf,14,0); s.ichimoku_score=0;
   double mid=(SymbolInfoDouble(_Symbol,SYMBOL_BID)+SymbolInfoDouble(_Symbol,SYMBOL_ASK))/2.0;
   s.ref=mid;
   s.candle=AnalyzeCandleFeatures(tf);
   
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

string JsonNum(const double v,const int digits)
{
   if(!MathIsValidNumber(v) || v==EMPTY_VALUE) return "null";
   return DoubleToString(v,digits);
}

int CurrentUtcHour()
{
   MqlDateTime dt;
   TimeToStruct(TimeGMT(),dt);
   return dt.hour;
}

int CurrentUtcDayOfWeek()
{
   MqlDateTime dt;
   TimeToStruct(TimeGMT(),dt);
   return dt.day_of_week;
}

string MarketSessionLabel()
{
   int h=CurrentUtcHour();
   if(h>=0 && h<6) return "tokyo";
   if(h>=6 && h<12) return "london";
   if(h>=12 && h<17) return "london_ny_overlap";
   if(h>=17 && h<22) return "ny";
   return "rollover";
}

string BuildHtfSnapshotJson(const string label,const ENUM_TIMEFRAMES tf)
{
   double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   double price=(bid+ask)/2.0;
   double ema=MA(tf,25,MODE_EMA,PRICE_CLOSE,0);
   double emaPrev=MA(tf,25,MODE_EMA,PRICE_CLOSE,1);
   double sma=MA(tf,100,MODE_SMA,PRICE_CLOSE,0);
   double atr=ATRv(tf,14,0);
   double rsi=RSIv(tf,14,PRICE_CLOSE,0);
   double adx=0,diPlus=0,diMinus=0;
   bool hasAdx=GetADX(tf,adx,diPlus,diMinus,0);

   int trend=0;
   if(MathIsValidNumber(ema) && MathIsValidNumber(sma) && ema!=EMPTY_VALUE && sma!=EMPTY_VALUE){
      if(ema>sma) trend=1;
      else if(ema<sma) trend=-1;
   }

   double emaSlopeAtr=EMPTY_VALUE;
   double priceVsEmaAtr=EMPTY_VALUE;
   if(MathIsValidNumber(atr) && atr!=EMPTY_VALUE && atr>0){
      if(MathIsValidNumber(ema) && MathIsValidNumber(emaPrev) && ema!=EMPTY_VALUE && emaPrev!=EMPTY_VALUE)
         emaSlopeAtr=(ema-emaPrev)/atr;
      if(MathIsValidNumber(price) && MathIsValidNumber(ema) && ema!=EMPTY_VALUE)
         priceVsEmaAtr=(price-ema)/atr;
   }

   int priceVsCloud=0;
   IchimokuValues ich;
   if(GetIchimoku(tf,ich,0)){
      if(price>MathMax(ich.senkou_a,ich.senkou_b)) priceVsCloud=1;
      else if(price<MathMin(ich.senkou_a,ich.senkou_b)) priceVsCloud=-1;
   }

   return "{"+
      "\"timeframe\":\""+JsonEscape(label)+"\","+
      "\"trend_dir\":"+IntegerToString(trend)+","+
      "\"ema_slope_atr\":"+JsonNum(emaSlopeAtr,5)+","+
      "\"price_vs_ema25_atr\":"+JsonNum(priceVsEmaAtr,5)+","+
      "\"adx\":"+(hasAdx?JsonNum(adx,2):"null")+","+
      "\"di_plus\":"+(hasAdx?JsonNum(diPlus,2):"null")+","+
      "\"di_minus\":"+(hasAdx?JsonNum(diMinus,2):"null")+","+
      "\"rsi\":"+JsonNum(rsi,2)+","+
      "\"atr_norm\":"+((MathIsValidNumber(atr) && atr!=EMPTY_VALUE && price>0)?JsonNum(atr/price,8):"null")+","+
      "\"price_vs_cloud\":"+IntegerToString(priceVsCloud)+
   "}";
}

string BuildHigherTimeframesJson()
{
   return "{"+
      "\"h1\":"+BuildHtfSnapshotJson("H1",PERIOD_H1)+","+
      "\"h4\":"+BuildHtfSnapshotJson("H4",PERIOD_H4)+","+
      "\"d1\":"+BuildHtfSnapshotJson("D1",PERIOD_D1)+
   "}";
}

double HighestHigh(ENUM_TIMEFRAMES tf,const int startShift,const int count)
{
   double high=-1.0e100;
   int n=0;
   for(int i=startShift;i<startShift+count;i++){
      double v=iHigh(_Symbol,tf,i);
      if(MathIsValidNumber(v) && v!=EMPTY_VALUE){
         if(v>high) high=v;
         n++;
      }
   }
   return n>0 ? high : EMPTY_VALUE;
}

double LowestLow(ENUM_TIMEFRAMES tf,const int startShift,const int count)
{
   double low=1.0e100;
   int n=0;
   for(int i=startShift;i<startShift+count;i++){
      double v=iLow(_Symbol,tf,i);
      if(MathIsValidNumber(v) && v!=EMPTY_VALUE){
         if(v<low) low=v;
         n++;
      }
   }
   return n>0 ? low : EMPTY_VALUE;
}

double AverageRange(ENUM_TIMEFRAMES tf,const int startShift,const int count)
{
   double sum=0.0;
   int n=0;
   for(int i=startShift;i<startShift+count;i++){
      double h=iHigh(_Symbol,tf,i);
      double l=iLow(_Symbol,tf,i);
      if(MathIsValidNumber(h) && MathIsValidNumber(l) && h!=EMPTY_VALUE && l!=EMPTY_VALUE && h>=l){
         sum+=(h-l);
         n++;
      }
   }
   return n>0 ? sum/n : EMPTY_VALUE;
}

double AverageTickVolume(ENUM_TIMEFRAMES tf,const int startShift,const int count)
{
   double sum=0.0;
   int n=0;
   for(int i=startShift;i<startShift+count;i++){
      long v=iVolume(_Symbol,tf,i);
      if(v>0){
         sum+=(double)v;
         n++;
      }
   }
   return n>0 ? sum/n : EMPTY_VALUE;
}

double AtrPercentile(ENUM_TIMEFRAMES tf,const double currentAtr,const int lookback)
{
   if(!MathIsValidNumber(currentAtr) || currentAtr<=0 || currentAtr==EMPTY_VALUE) return EMPTY_VALUE;
   int below=0;
   int n=0;
   for(int i=1;i<=lookback;i++){
      double v=ATRv(tf,14,i);
      if(MathIsValidNumber(v) && v!=EMPTY_VALUE && v>0){
         if(v<=currentAtr) below++;
         n++;
      }
   }
   return n>0 ? (double)below/(double)n : EMPTY_VALUE;
}

string BuildLevelDistancesJson(const double price,const double atr)
{
   if(!MathIsValidNumber(price) || price<=0 || !MathIsValidNumber(atr) || atr<=0 || atr==EMPTY_VALUE)
      return "{}";

   double prevHigh=iHigh(_Symbol,PERIOD_D1,1);
   double prevLow=iLow(_Symbol,PERIOD_D1,1);
   double dayHigh=iHigh(_Symbol,PERIOD_D1,0);
   double dayLow=iLow(_Symbol,PERIOD_D1,0);

   return "{"+
      "\"prev_day_high_dist_atr\":"+JsonNum((prevHigh-price)/atr,3)+","+
      "\"prev_day_low_dist_atr\":"+JsonNum((price-prevLow)/atr,3)+","+
      "\"day_high_dist_atr\":"+JsonNum((dayHigh-price)/atr,3)+","+
      "\"day_low_dist_atr\":"+JsonNum((price-dayLow)/atr,3)+
   "}";
}

string BuildChartStructureJson(const ENUM_TIMEFRAMES tf,const double price,const double atr)
{
   if(!MathIsValidNumber(price) || price<=0 || !MathIsValidNumber(atr) || atr<=0 || atr==EMPTY_VALUE)
      return "{}";

   const int lookback=20;
   double recentHigh=HighestHigh(tf,1,lookback);
   double recentLow=LowestLow(tf,1,lookback);
   double priorHigh=HighestHigh(tf,lookback+1,lookback);
   double priorLow=LowestLow(tf,lookback+1,lookback);
   double close1=iClose(_Symbol,tf,1);
   double closeN=iClose(_Symbol,tf,lookback);
   bool hasRecent=(MathIsValidNumber(recentHigh) && recentHigh!=EMPTY_VALUE && MathIsValidNumber(recentLow) && recentLow!=EMPTY_VALUE);
   bool hasPrior=(MathIsValidNumber(priorHigh) && priorHigh!=EMPTY_VALUE && MathIsValidNumber(priorLow) && priorLow!=EMPTY_VALUE);

   int swingDir=0;
   if(hasRecent && hasPrior){
      if(recentHigh>priorHigh && recentLow>priorLow) swingDir=1;
      else if(recentHigh<priorHigh && recentLow<priorLow) swingDir=-1;
   }

   int lastBreakDir=0;
   if(hasRecent){
      if(price>recentHigh) lastBreakDir=1;
      else if(price<recentLow) lastBreakDir=-1;
   }

   double rangePosition=EMPTY_VALUE;
   if(hasRecent && recentHigh>recentLow)
      rangePosition=(price-recentLow)/(recentHigh-recentLow);

   double impulseAtr=EMPTY_VALUE;
   if(MathIsValidNumber(close1) && MathIsValidNumber(closeN) && close1!=EMPTY_VALUE && closeN!=EMPTY_VALUE)
      impulseAtr=(close1-closeN)/atr;

   double nearestResistanceDistAtr=(hasRecent ? (recentHigh-price)/atr : EMPTY_VALUE);
   double nearestSupportDistAtr=(hasRecent ? (price-recentLow)/atr : EMPTY_VALUE);

   return "{"+
      "\"lookback_bars\":"+IntegerToString(lookback)+","+
      "\"swing_dir\":"+IntegerToString(swingDir)+","+
      "\"last_break_dir\":"+IntegerToString(lastBreakDir)+","+
      "\"recent_high\":"+JsonNum(recentHigh,_Digits)+","+
      "\"recent_low\":"+JsonNum(recentLow,_Digits)+","+
      "\"prior_high\":"+JsonNum(priorHigh,_Digits)+","+
      "\"prior_low\":"+JsonNum(priorLow,_Digits)+","+
      "\"nearest_resistance_dist_atr\":"+JsonNum(nearestResistanceDistAtr,3)+","+
      "\"nearest_support_dist_atr\":"+JsonNum(nearestSupportDistAtr,3)+","+
      "\"range_position\":"+JsonNum(rangePosition,3)+","+
      "\"impulse_20_atr\":"+JsonNum(impulseAtr,3)+
   "}";
}

string BuildVolatilityContextJson(const ENUM_TIMEFRAMES tf,const double atr,const double bbWidth)
{
   double atrPct=AtrPercentile(tf,atr,100);
   double avgRange=AverageRange(tf,1,20);
   double currentRange=iHigh(_Symbol,tf,1)-iLow(_Symbol,tf,1);
   double rangeExpansion=EMPTY_VALUE;
   if(MathIsValidNumber(avgRange) && avgRange!=EMPTY_VALUE && avgRange>0 && MathIsValidNumber(currentRange) && currentRange>=0)
      rangeExpansion=currentRange/avgRange;

   int volRegime=0;
   if(MathIsValidNumber(atrPct) && atrPct!=EMPTY_VALUE){
      if(atrPct>=0.75) volRegime=1;
      else if(atrPct<=0.25) volRegime=-1;
   }

   return "{"+
      "\"atr_percentile_100\":"+JsonNum(atrPct,3)+","+
      "\"range_expansion_20\":"+JsonNum(rangeExpansion,3)+","+
      "\"volatility_regime\":"+IntegerToString(volRegime)+","+
      "\"bb_width\":"+JsonNum(bbWidth,8)+
   "}";
}

string BuildCostContextJson(const ENUM_TIMEFRAMES tf,const double atr,const double bid,const double ask)
{
   double spread=ask-bid;
   double point=SymbolInfoDouble(_Symbol,SYMBOL_POINT);
   double spreadPoints=(point>0 ? spread/point : EMPTY_VALUE);
   double spreadAtr=(MathIsValidNumber(atr) && atr>0 && atr!=EMPTY_VALUE ? spread/atr : EMPTY_VALUE);
   double avgVol=AverageTickVolume(tf,2,20);
   double lastVol=(double)iVolume(_Symbol,tf,1);
   double tickVolRatio=(MathIsValidNumber(avgVol) && avgVol!=EMPTY_VALUE && avgVol>0 && lastVol>0 ? lastVol/avgVol : EMPTY_VALUE);

   return "{"+
      "\"spread_points\":"+JsonNum(spreadPoints,2)+","+
      "\"spread_atr\":"+JsonNum(spreadAtr,5)+","+
      "\"last_tick_volume\":"+JsonNum(lastVol,0)+","+
      "\"tick_volume_ratio_20\":"+JsonNum(tickVolRatio,3)+
   "}";
}

// ===== AI連携 =====
struct AIOut{
   double win_prob;int action;double offset_factor;int expiry_min;string reasoning;string confidence;
   double win_prob_raw;
   double win_prob_calibrated;
   double win_prob_final;
   bool   calibration_applied;
   string calibration_version;
   string calibration_method;
   string calibration_scope;
   int    calibration_sample_size;
   int    calibration_bin_sample_size;
   double calibration_shift;
   bool   h1_shadow_checked;
   bool   h1_shadow_would_block;
   string h1_shadow_reason;
   string decision_summary;
   int suggested_dir;            // action=0でも、AIがより良いと見た方向（1/-1）
   double buy_win_prob;          // dir=0（両方向評価）でのBUY勝率（0-1）。未提供時は-1
   double sell_win_prob;         // dir=0（両方向評価）でのSELL勝率（0-1）。未提供時は-1
   // Dynamic gating / EV
   double recommended_min_win_prob; // 0.60-0.75 (server may suggest lower)
   double expected_value_r;         // EV in R-multiples (loss=-1R, win=+1.5R)
   double reward_rr;
   double risk_atr_mult;
   string skip_reason;
   // Execution style (market-only)
   string entry_method;          // market
   string method_selected_by;    // Manual
   string method_reason;
   // ML pattern tracking
   bool   ml_pattern_used;       // MLパターンが使用されたか
   long   ml_pattern_id;         // パターンID
   string ml_pattern_name;       // パターン名
   double ml_pattern_confidence; // パターン信頼度 (%)
   long   trade_plan_id;         // 日次トレード計画ID
   string plan_alignment;        // aligned / mismatch / htf_conflict 等
   string event_risk;            // none / medium / high
   double plan_base_min_win_prob;
   double plan_gate_adjustment;
   double plan_effective_min_win_prob;
   string plan_gate_mode;
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
   if(!MathIsValidNumber(ai.win_prob_raw) || ai.win_prob_raw<0.0 || ai.win_prob_raw>1.0 ||
      !MathIsValidNumber(ai.win_prob_calibrated) || ai.win_prob_calibrated<0.0 || ai.win_prob_calibrated>1.0 ||
      !MathIsValidNumber(ai.win_prob_final) || ai.win_prob_final<0.0 || ai.win_prob_final>1.0){
      why="invalid probability audit fields";
      return false;
   }
   if(!(ai.action==0 || ai.action==1 || ai.action==-1)){
      why="invalid action";
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

bool QueryAI(const string tf_label,int dir,double rsi,double atr,double price,const string reason,double ichimoku_score,const CandleFeatures &candle,AIOut &out_ai)
{
   // default init (ExtractJson* が失敗しても未初期化値を使わない)
   out_ai.win_prob=0.0;
   out_ai.win_prob_raw=0.0;
   out_ai.win_prob_calibrated=0.0;
   out_ai.win_prob_final=0.0;
   out_ai.calibration_applied=false;
   out_ai.calibration_version="";
   out_ai.calibration_method="";
   out_ai.calibration_scope="";
   out_ai.calibration_sample_size=0;
   out_ai.calibration_bin_sample_size=0;
   out_ai.calibration_shift=0.0;
   out_ai.h1_shadow_checked=false;
   out_ai.h1_shadow_would_block=false;
   out_ai.h1_shadow_reason="";
   out_ai.action=0;
   out_ai.offset_factor=0.0;
   out_ai.expiry_min=0;
   out_ai.reasoning="";
   out_ai.confidence="";
   out_ai.decision_summary="";
   out_ai.suggested_dir=0;
   out_ai.buy_win_prob=-1.0;
   out_ai.sell_win_prob=-1.0;
   out_ai.recommended_min_win_prob=0.0;
   out_ai.expected_value_r=-999.0;
   out_ai.reward_rr=RewardRR;
   out_ai.risk_atr_mult=RiskATRmult;
   out_ai.skip_reason="";
   out_ai.entry_method="market";
   out_ai.method_selected_by="Manual";
   out_ai.method_reason="market-only execution";
   out_ai.ml_pattern_used=false;
   out_ai.ml_pattern_id=0;
   out_ai.ml_pattern_name="";
   out_ai.ml_pattern_confidence=0.0;
   out_ai.trade_plan_id=0;
   out_ai.plan_alignment="";
   out_ai.event_risk="";
   out_ai.plan_base_min_win_prob=-1.0;
   out_ai.plan_gate_adjustment=0.0;
   out_ai.plan_effective_min_win_prob=-1.0;
   out_ai.plan_gate_mode="ai";

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
   string marketSession=MarketSessionLabel();
   int utcHour=CurrentUtcHour();
   int utcDay=CurrentUtcDayOfWeek();
   string higherTfJson=BuildHigherTimeframesJson();
   string levelDistancesJson=BuildLevelDistancesJson(price,atr_send);
   
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
   string chartStructureJson=BuildChartStructureJson(tf,price,atr_send);
   string volatilityContextJson=BuildVolatilityContextJson(tf,atr_send,(has_bb?bb_width:EMPTY_VALUE));
   string costContextJson=BuildCostContextJson(tf,atr_send,bid,ask);
   
   // ★ すべての生データをAIに送信
   int dir_to_send = (UseAIForDirection ? 0 : dir);
   string candleBarsJson=BuildRecentCandlesJson(tf,CandleBarsToSend);
   string payload="{"+
   "\"symbol\":\""+JsonEscape(_Symbol)+"\","+
   "\"timeframe\":\""+JsonEscape(tf_label)+"\","+

   // EA設定（ServerMinWinProbをサーバ側ゲートの指示値として送信。MinWinProbはEA側フロアのみ）
   "\"min_win_prob\":"+DoubleToString(ServerMinWinProb,3)+","+
   
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

   // ローソク足特徴量（反転/順張り判定の補助）
   "\"candle_features\":{"+
      "\"bull_engulfing\":"+IntegerToString(candle.bull_engulfing)+","+
      "\"bear_engulfing\":"+IntegerToString(candle.bear_engulfing)+","+
      "\"bull_pinbar\":"+IntegerToString(candle.bull_pinbar)+","+
      "\"bear_pinbar\":"+IntegerToString(candle.bear_pinbar)+","+
      "\"inside_bar\":"+IntegerToString(candle.inside_bar)+","+
      "\"inside_break_dir\":"+IntegerToString(candle.inside_break_dir)+","+
      "\"three_up\":"+IntegerToString(candle.three_up)+","+
      "\"three_down\":"+IntegerToString(candle.three_down)+","+
      "\"bull_reversal_score\":"+IntegerToString(candle.bull_reversal_score)+","+
      "\"bear_reversal_score\":"+IntegerToString(candle.bear_reversal_score)+","+
      "\"bull_continuation_score\":"+IntegerToString(candle.bull_continuation_score)+","+
      "\"bear_continuation_score\":"+IntegerToString(candle.bear_continuation_score)+
   "},"+

   // 生OHLC（複数本）
   "\"candle_bars\":"+candleBarsJson+","+

   // セッション・上位足・主要価格レベル距離
   "\"market_session\":\""+JsonEscape(marketSession)+"\","+
   "\"utc_hour\":"+IntegerToString(utcHour)+","+
   "\"day_of_week\":"+IntegerToString(utcDay)+","+
   "\"higher_timeframes\":"+higherTfJson+","+
   "\"level_distances\":"+levelDistancesJson+","+
   "\"chart_structure\":"+chartStructureJson+","+
   "\"volatility_context\":"+volatilityContextJson+","+
   "\"cost_context\":"+costContextJson+","+
   
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
   if(!ExtractJsonNumber(resp,"win_prob_raw",out_ai.win_prob_raw)) out_ai.win_prob_raw=out_ai.win_prob;
   if(!ExtractJsonNumber(resp,"win_prob_calibrated",out_ai.win_prob_calibrated)) out_ai.win_prob_calibrated=out_ai.win_prob;
   if(!ExtractJsonNumber(resp,"win_prob_final",out_ai.win_prob_final)) out_ai.win_prob_final=out_ai.win_prob;
   if(!ExtractJsonBool(resp,"calibration_applied",out_ai.calibration_applied)) out_ai.calibration_applied=false;
   ExtractJsonString(resp,"calibration_version",out_ai.calibration_version);
   ExtractJsonString(resp,"calibration_method",out_ai.calibration_method);
   ExtractJsonString(resp,"calibration_scope",out_ai.calibration_scope);
   ExtractJsonInt(resp,"calibration_sample_size",out_ai.calibration_sample_size);
   ExtractJsonInt(resp,"calibration_bin_sample_size",out_ai.calibration_bin_sample_size);
   ExtractJsonNumber(resp,"calibration_shift",out_ai.calibration_shift);
   ExtractJsonInt(resp,"action",out_ai.action);
   int sdir; if(ExtractJsonInt(resp,"suggested_dir",sdir)) out_ai.suggested_dir=sdir; else out_ai.suggested_dir=0;
   double bwp; if(ExtractJsonNumber(resp,"buy_win_prob",bwp)) out_ai.buy_win_prob=bwp; else out_ai.buy_win_prob=-1.0;
   double swp; if(ExtractJsonNumber(resp,"sell_win_prob",swp)) out_ai.sell_win_prob=swp; else out_ai.sell_win_prob=-1.0;
   ExtractJsonNumber(resp,"offset_factor",out_ai.offset_factor);
   double tmp; if(ExtractJsonNumber(resp,"expiry_minutes",tmp)) out_ai.expiry_min=(int)MathRound(tmp);
   ExtractJsonString(resp,"reasoning",out_ai.reasoning);
   ExtractJsonString(resp,"reasoning",out_ai.reasoning);
   ExtractJsonString(resp,"confidence",out_ai.confidence);
   ExtractJsonString(resp,"decision_summary",out_ai.decision_summary);

   // Dynamic gating / EV
   double rmin; if(ExtractJsonNumber(resp,"recommended_min_win_prob",rmin)) out_ai.recommended_min_win_prob=rmin; else out_ai.recommended_min_win_prob=0.0;
   double evr; if(ExtractJsonNumber(resp,"expected_value_r",evr)) out_ai.expected_value_r=evr; else out_ai.expected_value_r=-999.0;
   double responseRr; if(ExtractJsonNumber(resp,"reward_rr",responseRr) && responseRr>0) out_ai.reward_rr=responseRr;
   double responseRiskAtr; if(ExtractJsonNumber(resp,"risk_atr_mult",responseRiskAtr) && responseRiskAtr>0) out_ai.risk_atr_mult=responseRiskAtr;
   ExtractJsonString(resp,"skip_reason",out_ai.skip_reason);
   // Execution is market-only (ignore any entry method/params from server)
   out_ai.entry_method = "market";
   out_ai.method_selected_by = "Manual";
   out_ai.method_reason = "market-only execution";
   
   // ML pattern tracking
   if(!ExtractJsonBool(resp,"ml_pattern_used",out_ai.ml_pattern_used)) out_ai.ml_pattern_used=false;
   int mlId=0; if(ExtractJsonInt(resp,"ml_pattern_id",mlId)) out_ai.ml_pattern_id=(long)mlId; else out_ai.ml_pattern_id=0;
   ExtractJsonString(resp,"ml_pattern_name",out_ai.ml_pattern_name);
   double mlConf; if(ExtractJsonNumber(resp,"ml_pattern_confidence",mlConf)) out_ai.ml_pattern_confidence=mlConf; else out_ai.ml_pattern_confidence=0.0;
   int planId=0; if(ExtractJsonInt(resp,"trade_plan_id",planId)) out_ai.trade_plan_id=(long)planId; else out_ai.trade_plan_id=0;
   ExtractJsonString(resp,"plan_alignment",out_ai.plan_alignment);
   ExtractJsonString(resp,"event_risk",out_ai.event_risk);
   ExtractJsonNumber(resp,"plan_base_min_win_prob",out_ai.plan_base_min_win_prob);
   ExtractJsonNumber(resp,"plan_gate_adjustment",out_ai.plan_gate_adjustment);
   ExtractJsonNumber(resp,"plan_effective_min_win_prob",out_ai.plan_effective_min_win_prob);
   ExtractJsonString(resp,"plan_gate_mode",out_ai.plan_gate_mode);

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
   string ai_reasoning=(ai.reasoning!=""?JsonEscape(ai.reasoning):"N/A");
   if(ai.decision_summary!="") ai_reasoning=JsonEscape(ai.decision_summary)+(ai_reasoning!="N/A"?" | "+ai_reasoning:"");
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
   "\"win_prob_raw\":"+DoubleToString(ai.win_prob_raw,3)+","+
   "\"win_prob_calibrated\":"+DoubleToString(ai.win_prob_calibrated,3)+","+
   "\"win_prob_final\":"+DoubleToString(ai.win_prob_final,3)+","+
   "\"calibration_applied\":"+(ai.calibration_applied?"true":"false")+","+
   "\"calibration_version\":"+(ai.calibration_version!=""?"\""+JsonEscape(ai.calibration_version)+"\"":"null")+","+
   "\"calibration_method\":"+(ai.calibration_method!=""?"\""+JsonEscape(ai.calibration_method)+"\"":"null")+","+
   "\"calibration_scope\":"+(ai.calibration_scope!=""?"\""+JsonEscape(ai.calibration_scope)+"\"":"null")+","+
   "\"calibration_sample_size\":"+IntegerToString(ai.calibration_sample_size)+","+
   "\"calibration_shift\":"+DoubleToString(ai.calibration_shift,3)+","+
   "\"probability_adjustments\":{\"calibration\":"+DoubleToString(ai.calibration_shift,3)+",\"total_post_calibration\":"+DoubleToString(ai.win_prob_final-ai.win_prob_calibrated,3)+"},"+
   "\"h1_shadow_checked\":"+(ai.h1_shadow_checked?"true":"false")+","+
   "\"h1_shadow_would_block\":"+(ai.h1_shadow_would_block?"true":"false")+","+
   "\"h1_shadow_reason\":"+(ai.h1_shadow_reason!=""?"\""+JsonEscape(ai.h1_shadow_reason)+"\"":"null")+","+
   "\"recommended_min_win_prob\":"+DoubleToString(ai.recommended_min_win_prob,3)+","+
   "\"expected_value_r\":"+DoubleToString(ai.expected_value_r,3)+","+
   "\"skip_reason\":\""+JsonEscape(ai.skip_reason)+"\","+
   "\"decision_summary\":"+(ai.decision_summary!=""?"\""+JsonEscape(ai.decision_summary)+"\"":"null")+","+
   "\"ai_confidence\":\""+(ai.confidence!=""?JsonEscape(ai.confidence):"unknown")+"\","+
   "\"ai_reasoning\":\""+ai_reasoning+"\","+
   "\"entry_method\":\""+JsonEscape(ai.entry_method)+"\","+
   "\"method_selected_by\":\""+JsonEscape(ai.method_selected_by)+"\","+
   "\"method_reason\":\""+JsonEscape(ai.method_reason)+"\","+
   "\"trade_decision\":\""+JsonEscape(trade_decision)+"\","+
   "\"threshold_met\":"+(threshold_met?"true":"false")+","+
   "\"current_positions\":"+IntegerToString(current_pos)+","+
   (ticket>0?"\"order_ticket\":\""+ULongToString(ticket)+"\",":"")+
   (executed_lot>0?"\"executed_lot\":"+DoubleToString(executed_lot,2)+",":"")+
   (ai.trade_plan_id>0?"\"trade_plan_id\":"+IntegerToString((int)ai.trade_plan_id)+",":"")+
   "\"plan_alignment\":\""+JsonEscape(ai.plan_alignment)+"\","+
   "\"event_risk\":\""+JsonEscape(ai.event_risk)+"\","+
   "\"plan_base_min_win_prob\":"+(ai.plan_base_min_win_prob>=0?DoubleToString(ai.plan_base_min_win_prob,3):"null")+","+
   "\"plan_gate_adjustment\":"+DoubleToString(ai.plan_gate_adjustment,3)+","+
   "\"plan_effective_min_win_prob\":"+(ai.plan_effective_min_win_prob>=0?DoubleToString(ai.plan_effective_min_win_prob,3):"null")+","+
   "\"plan_gate_mode\":\""+JsonEscape(ai.plan_gate_mode)+"\","+
   "\"market_session\":\""+JsonEscape(MarketSessionLabel())+"\","+
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
long RecordSignal(const string tf_label,int dir,double rsi,double atr,double price,const string reason,const AIOut &ai,const CandleFeatures &candle,ulong ticket=0,double entry_price=0,bool mark_filled=false,bool is_virtual=false,double planned_entry=0,double planned_sl=0,double planned_tp=0,int planned_order_type=-1,int expiry_minutes=0,double executed_lot=0.0,int original_dir=0,const string shadow_reason="")
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

   bool strict_macd_rsi=false;
   bool strict_ma_rsi=false;
   bool strict_ichimoku_tk_rsi=false;
   bool strict_cloud_macd=false;
   bool strict_engulfing=false;
   bool strict_inside_breakout=false;
   if(dir>0)
   {
      strict_macd_rsi=(macd_cross==1 && ema_25>=sma_100 && rsi>=45.0 && rsi<=65.0);
      strict_ma_rsi=(ma_cross==1 && rsi>=45.0 && rsi<=60.0);
      strict_ichimoku_tk_rsi=(tk_cross==1 && price>=ich.kijun && rsi>=45.0 && rsi<=65.0);
      strict_cloud_macd=(cloud_color==1 && price_vs_cloud==1 && macd_cross==1);
      strict_engulfing=(candle.strict_engulfing_dir>0 && rsi<=50.0);
      strict_inside_breakout=(candle.strict_inside_break_dir>0);
   }
   else if(dir<0)
   {
      strict_macd_rsi=(macd_cross==-1 && ema_25<=sma_100 && rsi>=35.0 && rsi<=55.0);
      strict_ma_rsi=(ma_cross==-1 && rsi>=40.0 && rsi<=55.0);
      strict_ichimoku_tk_rsi=(tk_cross==-1 && price<=ich.kijun && rsi>=35.0 && rsi<=55.0);
      strict_cloud_macd=(cloud_color==-1 && price_vs_cloud==-1 && macd_cross==-1);
      strict_engulfing=(candle.strict_engulfing_dir<0 && rsi>=50.0);
      strict_inside_breakout=(candle.strict_inside_break_dir<0);
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
   string marketSession=MarketSessionLabel();
   int utcHour=CurrentUtcHour();
   int utcDay=CurrentUtcDayOfWeek();
   string higherTfJson=BuildHigherTimeframesJson();
   string levelDistancesJson=BuildLevelDistancesJson(price,atr);
   string chartStructureJson=BuildChartStructureJson(tf,price,atr);
   string volatilityContextJson=BuildVolatilityContextJson(tf,atr,(has_bb?bb_width:EMPTY_VALUE));
   string costContextJson=BuildCostContextJson(tf,atr,bid,ask);

   string payload="{"+
   "\"symbol\":\""+JsonEscape(_Symbol)+"\","+
   "\"timeframe\":\""+JsonEscape(tf_label)+"\","+
   "\"dir\":"+IntegerToString(dir)+","+
   "\"win_prob\":"+DoubleToString(ai.win_prob,3)+","+
   "\"win_prob_raw\":"+DoubleToString(ai.win_prob_raw,3)+","+
   "\"win_prob_calibrated\":"+DoubleToString(ai.win_prob_calibrated,3)+","+
   "\"win_prob_final\":"+DoubleToString(ai.win_prob_final,3)+","+
   "\"calibration_applied\":"+(ai.calibration_applied?"true":"false")+","+
   "\"calibration_version\":"+(ai.calibration_version!=""?"\""+JsonEscape(ai.calibration_version)+"\"":"null")+","+
   "\"calibration_method\":"+(ai.calibration_method!=""?"\""+JsonEscape(ai.calibration_method)+"\"":"null")+","+
   "\"calibration_scope\":"+(ai.calibration_scope!=""?"\""+JsonEscape(ai.calibration_scope)+"\"":"null")+","+
   "\"calibration_sample_size\":"+IntegerToString(ai.calibration_sample_size)+","+
   "\"calibration_bin_sample_size\":"+IntegerToString(ai.calibration_bin_sample_size)+","+
   "\"calibration_shift\":"+DoubleToString(ai.calibration_shift,3)+","+
   "\"probability_adjustments\":{\"calibration\":"+DoubleToString(ai.calibration_shift,3)+",\"total_post_calibration\":"+DoubleToString(ai.win_prob_final-ai.win_prob_calibrated,3)+"},"+
   "\"h1_shadow_checked\":"+(ai.h1_shadow_checked?"true":"false")+","+
   "\"h1_shadow_would_block\":"+(ai.h1_shadow_would_block?"true":"false")+","+
   "\"h1_shadow_reason\":"+(ai.h1_shadow_reason!=""?"\""+JsonEscape(ai.h1_shadow_reason)+"\"":"null")+","+
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
   "\"bull_engulfing\":"+IntegerToString(candle.bull_engulfing)+","+
   "\"bear_engulfing\":"+IntegerToString(candle.bear_engulfing)+","+
   "\"inside_bar\":"+IntegerToString(candle.inside_bar)+","+
   "\"inside_break_dir\":"+IntegerToString(candle.strict_inside_break_dir)+","+
   "\"strict_macd_rsi_setup\":"+(strict_macd_rsi?"true":"false")+","+
   "\"strict_ma_rsi_setup\":"+(strict_ma_rsi?"true":"false")+","+
   "\"strict_ichimoku_tk_rsi_setup\":"+(strict_ichimoku_tk_rsi?"true":"false")+","+
   "\"strict_cloud_macd_setup\":"+(strict_cloud_macd?"true":"false")+","+
   "\"strict_engulfing_setup\":"+(strict_engulfing?"true":"false")+","+
   "\"strict_inside_breakout_setup\":"+(strict_inside_breakout?"true":"false")+","+
   "\"reason\":\""+JsonEscape(reason)+"\","+
   "\"instance\":\""+JsonEscape(AI_EA_Instance)+"\","+
   "\"model_version\":\""+JsonEscape(AI_EA_Version)+"\","+
   "\"trade_plan_id\":"+(ai.trade_plan_id>0?IntegerToString((int)ai.trade_plan_id):"null")+","+
   "\"plan_alignment\":"+(ai.plan_alignment!=""?"\""+JsonEscape(ai.plan_alignment)+"\"":"null")+","+
   "\"event_risk\":"+(ai.event_risk!=""?"\""+JsonEscape(ai.event_risk)+"\"":"null")+","+
   "\"plan_base_min_win_prob\":"+(ai.plan_base_min_win_prob>=0?DoubleToString(ai.plan_base_min_win_prob,3):"null")+","+
   "\"plan_gate_adjustment\":"+DoubleToString(ai.plan_gate_adjustment,3)+","+
   "\"plan_effective_min_win_prob\":"+(ai.plan_effective_min_win_prob>=0?DoubleToString(ai.plan_effective_min_win_prob,3):"null")+","+
   "\"plan_gate_mode\":\""+JsonEscape(ai.plan_gate_mode)+"\","+
   "\"market_session\":\""+JsonEscape(marketSession)+"\","+
   "\"utc_hour\":"+IntegerToString(utcHour)+","+
   "\"day_of_week\":"+IntegerToString(utcDay)+","+
   "\"htf_context\":"+higherTfJson+","+
   "\"level_distances\":"+levelDistancesJson+","+
   "\"chart_structure\":"+chartStructureJson+","+
   "\"volatility_context\":"+volatilityContextJson+","+
   "\"cost_context\":"+costContextJson+","+
   "\"decision_summary\":"+(ai.decision_summary!=""?"\""+JsonEscape(ai.decision_summary)+"\"":"null")+","+
   "\"entry_method\":\""+JsonEscape(ai.entry_method)+"\","+
   "\"method_selected_by\":\""+JsonEscape(ai.method_selected_by)+"\","+
   "\"method_reason\":\""+JsonEscape(ai.method_reason)+"\","+
   "\"ml_pattern_used\":"+(ai.ml_pattern_used?"true":"false")+","+
   "\"ml_pattern_id\":"+(ai.ml_pattern_id>0?IntegerToString(ai.ml_pattern_id):"null")+","+
   "\"ml_pattern_name\":\""+(ai.ml_pattern_name!=""?JsonEscape(ai.ml_pattern_name):"null")+"\","+
   "\"ml_pattern_confidence\":"+(ai.ml_pattern_confidence>0?DoubleToString(ai.ml_pattern_confidence,2):"null")+","+
   "\"executed_lot\":"+(executed_lot>0?DoubleToString(executed_lot,2):"null")+","+
   "\"is_virtual\":"+(is_virtual?"true":"false")+","+
   "\"shadow_reason\":"+(shadow_reason!=""?"\""+JsonEscape(shadow_reason)+"\"":"null")+","+
   "\"gate_snapshot\":{\"expected_value_r\":"+DoubleToString(ai.expected_value_r,3)+",\"skip_reason\":\""+JsonEscape(ai.skip_reason)+"\",\"plan_alignment\":\""+JsonEscape(ai.plan_alignment)+"\",\"plan_gate_adjustment\":"+DoubleToString(ai.plan_gate_adjustment,3)+",\"plan_effective_min_win_prob\":"+(ai.plan_effective_min_win_prob>=0?DoubleToString(ai.plan_effective_min_win_prob,3):"null")+",\"h1_shadow_would_block\":"+(ai.h1_shadow_would_block?"true":"false")+"},"+
   "\"reverse_execution\":false,"+
   "\"original_dir\":"+IntegerToString(original_dir!=0?original_dir:dir);

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
         double risk=MathAbs(g_virtual[i].entry-g_virtual[i].sl);

         if(risk>0.0)
         {
            double favorable=0.0, adverse=0.0;
            if(g_virtual[i].dir>0){ favorable=(bid-g_virtual[i].entry)/risk; adverse=(g_virtual[i].entry-bid)/risk; }
            else if(g_virtual[i].dir<0){ favorable=(g_virtual[i].entry-ask)/risk; adverse=(ask-g_virtual[i].entry)/risk; }
            if(favorable>g_virtual[i].mfe_r) g_virtual[i].mfe_r=favorable;
            if(adverse>g_virtual[i].mae_r) g_virtual[i].mae_r=adverse;
         }

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
            double pl = tp_hit? g_virtual[i].reward_rr : -1.0;
            UpdateSignalResultById(g_virtual[i].signal_id,exit_price,pl,result,sl_hit,tp_hit,g_virtual[i].filled_at,g_virtual[i].mfe_r,g_virtual[i].mae_r);
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

// ===== 注文関連 =====
void MaybeRecordVirtualSkip(const string decision_code,const TechSignal &t,double rsi,const AIOut &ai,int expiry_min)
{
   if(!ShouldVirtualTrack(decision_code)) return;

   double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID), ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   double slDist=t.atr*ai.risk_atr_mult, tpDist=slDist*ai.reward_rr;
   double planned_entry=0, planned_sl=0, planned_tp=0; int planned_type=-1;
   if(t.dir>0){ planned_entry=ask; planned_sl=ask-slDist; planned_tp=ask+tpDist; planned_type=ORDER_TYPE_BUY; }
   else if(t.dir<0){ planned_entry=bid; planned_sl=bid+slDist; planned_tp=bid-tpDist; planned_type=ORDER_TYPE_SELL; }
   else return;

   long sid=RecordSignal("M15",t.dir,rsi,t.atr,t.ref,t.reason,ai,t.candle,0,0,false,true,planned_entry,planned_sl,planned_tp,planned_type,expiry_min,0.0,t.dir,decision_code);
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
   w.mfe_r=0.0;
   w.mae_r=0.0;
   w.reward_rr=ai.reward_rr;

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

// ポジション数チェック（market-onlyのためアクティブポジションのみ）
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
   AIOut ai; if(!QueryAI("M15",t.dir,rsi,t.atr,t.ref,t.reason,t.ichimoku_score,t.candle,ai))return;

   int suggested_dir = (ai.suggested_dir!=0?ai.suggested_dir:tech_dir);
   int decision_dir = ai.action; // 0なら見送り
   int execution_dir = decision_dir;

   int posCount=CountPositions();
   // The server owns the adaptive execution gate. This local threshold is a
   // fixed fail-safe used only if an invalid server response slips through.
   double effectiveMin=MinWinProb;
   double ev_r = (ai.expected_value_r>-100.0 ? ai.expected_value_r : (ai.win_prob*ai.reward_rr - (1.0-ai.win_prob)*1.0));
   double ev_gate = (effectiveMin*ai.reward_rr - (1.0-effectiveMin)*1.0);
   // ガード:
   // 1) Functions側が action=0 を返した場合は必ず見送る（サーバが主要ゲート）
   // 2) EA設定の MinWinProb はフロア（誤作動防止）。サーバ側で既にキャリブレーション・
   //    RECENT_PERF・RSI_MR_BONUS等を適用済み。ここでは0.50を最低安全値とする。
   bool threshold_met=(ai.action!=0 && ai.win_prob>=MinWinProb);

   // derive expiry minutes for virtual tracking
   int expiry_min = PendingExpiryMin;
   if(ai.expiry_min>0) expiry_min=ai.expiry_min;
   
   if(threshold_met){
      // 以降の注文・仮想・記録は方向を統一
      TechSignal t_exec=t; t_exec.dir=execution_dir;
      TechSignal t_plan=t; t_plan.dir=suggested_dir;

      // H1の独立AI判定は既定で監査専用。M15実行を止めず、旧SOFT判定の反実仮想を保存する。
      if(H1AuditEnabled)
      {
         TechSignal h1t=Evaluate(TF_Recheck);
         int h1_tech_dir=(h1t.dir!=0?h1t.dir:decision_dir);
         double h1_rsi=RSIv(PERIOD_H1,14,PRICE_CLOSE,0);
         AIOut h1ai;
         bool h1_ok=QueryAI("H1",h1_tech_dir,h1_rsi,h1t.atr,h1t.ref,h1t.reason,h1t.ichimoku_score,h1t.candle,h1ai);
         if(!h1_ok){
            ai.h1_shadow_checked=true;
            ai.h1_shadow_would_block=false;
            ai.h1_shadow_reason="query_failed";
            h1ai.h1_shadow_checked=true;
            h1ai.h1_shadow_would_block=false;
            h1ai.h1_shadow_reason="query_failed";
            LogAIDecision("H1",0,h1_rsi,h1t.atr,h1t.ref,h1t.reason,h1ai,"H1_SHADOW_QUERY_FAIL",false,posCount,0,h1_tech_dir);
            SafePrint("[M15] H1 audit query failed -> continue");
         }
         else
         {
            int h1_suggested_dir=(h1ai.suggested_dir!=0?h1ai.suggested_dir:h1ai.action);
            bool h1_opposite=(h1_suggested_dir!=0 && h1_suggested_dir!=decision_dir);
            bool block=(h1_opposite && h1ai.action!=0 && h1ai.win_prob>=H1OppositeBlockProb);
            string auditReason=StringFormat("soft h1_action=%d h1_prob=%.3f h1_dir=%d m15_dir=%d",h1ai.action,h1ai.win_prob,h1_suggested_dir,decision_dir);
            ai.h1_shadow_checked=true;
            ai.h1_shadow_would_block=block;
            ai.h1_shadow_reason=(block?auditReason:"soft_pass");
            h1ai.h1_shadow_checked=true;
            h1ai.h1_shadow_would_block=block;
            h1ai.h1_shadow_reason=ai.h1_shadow_reason;

            LogAIDecision("H1",h1ai.action,h1_rsi,h1t.atr,h1t.ref,h1t.reason,h1ai,
               (block?"H1_SHADOW_WOULD_BLOCK":"H1_SHADOW_PASS"),true,posCount,0,h1_tech_dir);
            if(block)
               SafePrint("[M15] H1 shadow would block, but execution continues");
         }
      }

      // ポジション数チェック（ペンディングは設定で任意）
      if(posCount>=MaxPositions){
         LogAIDecision("M15",decision_dir,rsi,t.atr,t.ref,t.reason,ai,"SKIPPED_MAX_POS",threshold_met,posCount,0,tech_dir);
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
      
      trade.SetExpertMagicNumber(Magic);
      trade.SetDeviationInPoints(SlippagePoints);

      double finalLots = Lots;
      double normLots=finalLots; string lotWhy="";
      if(!NormalizeLotsForSymbol(finalLots,normLots,lotWhy)){
         LogAIDecision("M15",decision_dir,rsi,t.atr,t.ref,t.reason,ai,"SKIPPED_INVALID_LOT",threshold_met,posCount,0,tech_dir);
         SafePrint(StringFormat("[LOT] skip: %s",lotWhy));
         MaybeRecordVirtualSkip("SKIPPED_INVALID_LOT",t_plan,rsi,ai,expiry_min);
         return;
      }
      finalLots=normLots;

      // Market-only execution. Position size always uses BaseLotSize.
      double slDist=t_exec.atr*ai.risk_atr_mult, tpDist=slDist*ai.reward_rr;
      double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID), ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
      double planned_entry=0, planned_sl=0, planned_tp=0; int planned_type=-1;
      bool ok=false; double entry=0.0; ulong posTicket=0; ulong ordTicket=0;
      AIOut ai_exec=ai;

      ai_exec.entry_method="market";
      ai_exec.method_selected_by="Manual";
      ai_exec.method_reason="market-only execution";

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
         RecordSignal("M15",t_exec.dir,rsi,t_exec.atr,t_exec.ref,t_exec.reason,ai_exec,t_exec.candle,ordTicket,entry,true,false,planned_entry,planned_sl,planned_tp,planned_type,expiry_min,finalLots,decision_dir);
         LogAIDecision("M15",t_exec.dir,rsi,t_exec.atr,t_exec.ref,t_exec.reason,ai_exec,"EXECUTED_MARKET",threshold_met,posCount,ordTicket,tech_dir,finalLots);
         SafePrint(StringFormat("[M15] market executed dir=%d prob=%.0f%% lot=%.2f",t_exec.dir,ai.win_prob*100,finalLots));
      }else{
         SafePrint("[M15] market execution failed");
         MaybeRecordVirtualSkip("SKIPPED_ORDER_FAILED",t_plan,rsi,ai,expiry_min);
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

      // Every direction-bearing candidate is shadow-tracked, including hard guards.
      // This is observational only and never bypasses the execution gate.
      MaybeRecordVirtualSkip("SKIPPED_EXECUTION_GATE",t_plan,rsi,ai,expiry_min);
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
            int posDir=0;
            long posType=PositionGetInteger(POSITION_TYPE);
            if(posType==POSITION_TYPE_BUY) posDir=1;
            else if(posType==POSITION_TYPE_SELL) posDir=-1;
            string payload="{\"order_ticket\":\""+ULongToString(g_tracked[ti].order_ticket)+"\""+
                           ",\"entry_price\":"+DoubleToString(ep,_Digits)+
                           ",\"actual_result\":\"FILLED\""+
                           ",\"symbol\":\""+JsonEscape(_Symbol)+"\""+
                           ",\"timeframe\":\"M15\""+
                           ",\"dir\":"+IntegerToString(posDir)+
                           ",\"reason\":\"rehydrated_existing_position\""+
                           ",\"instance\":\""+JsonEscape(AI_EA_Instance)+"\""+
                           ",\"model_version\":\""+JsonEscape(AI_EA_Version)+"\""+
                           (g_tracked[ti].open_time>0 ? ",\"created_at\":\""+TimeToString(g_tracked[ti].open_time,TIME_DATE|TIME_SECONDS)+"\"" : "")+
                           "}";
            string resp;
            if(HttpPostJson(AI_Signals_Update_URL,AI_Bearer_Token,payload,resp,3000))
            {
               g_tracked[ti].fill_sent=true;
               SafePrint(StringFormat("[AI_SIGNALS_UPDATE] Filled confirmed order=%s entry=%.5f",ULongToString(g_tracked[ti].order_ticket),ep));
            }
         }
      }
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

   if(AI_Bearer_Token=="" && EA_Log_Bearer_Token==""){
      Alert("ERROR: Bearer token is not set!");
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
   SafePrint(StringFormat("[CONFIG] System defaults -> MinWinProb=%.0f%%, Risk=%.2f, RR=%.2f | Operator -> Lots=%.2f, MaxPos=%d",
      MinWinProb*100,RiskATRmult,RewardRR,Lots,MaxPositions));
   SafePrint("[ENTRY] Mode=market LotMode=fixed");
   SafePrint("[H1] ExecutionPrecheck=removed ShadowAudit=true");
   SafePrint("[INFO] Sending EMA25, SMA100, SMA200, SMA800, MACD, RSI, ATR, Ichimoku (all lines) to AI");
   SafePrint("[TRACK] Market positions only; pending-order execution removed");
   SafePrint("[VIRTUAL] Enabled=true TrackAllSkipped=true");
   SafePrint(StringFormat("[VIRTUAL] Watch capacity=%d", ArraySize(g_virtual)));
   SafePrint(StringFormat("[TRACK] Multi tracking capacity=%d", ArraySize(g_tracked)));
   return(INIT_SUCCEEDED);
}
void OnTick()
{
   // ポジション状態監視（ML学習用）
   CheckPositionStatus();
   if(iTime(_Symbol,TF_Entry,0)!=g_lastBar_M15){g_lastBar_M15=iTime(_Symbol,TF_Entry,0);OnM15NewBar();}
}
void OnDeinit(const int reason){SafePrint("[DEINIT] stopped;");}
