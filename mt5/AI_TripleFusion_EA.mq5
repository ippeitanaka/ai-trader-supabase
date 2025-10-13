//+------------------------------------------------------------------+
//| AI_TripleFusion_EA.mq5  (ver 1.2.3)                              |
//| - Supabase: ai-config / ai-signals(AI側) / ea-log                |
//| - POST時の末尾NUL(0x00)除去対応                                  |
//| - ML学習用: ai_signalsへの取引記録・結果追跡機能                 |
//+------------------------------------------------------------------+
#property strict
#include <Trade/Trade.mqh>
CTrade trade;

// ===== 入力パラメータ =====
input bool   LockToChartSymbol = true;
input ENUM_TIMEFRAMES TF_Entry   = PERIOD_M15;
input ENUM_TIMEFRAMES TF_Recheck = PERIOD_H1;

input double MinWinProb          = 75.0;
input double RiskATRmult         = 1.5;
input double RewardRR            = 1.2;
input double PendingOffsetATR    = 0.2;
input int    PendingExpiryMin    = 90;
input double Lots                = 0.10;
input int    SlippagePoints      = 1000;
input long   Magic               = 26091501;
input int    MaxPositions        = 1;      // 同一銘柄の最大ポジション数

input bool   DebugLogs           = true;
input int    LogCooldownSec      = 30;  // 0=全出力, >0=間引き, -1=完全OFF

// ★ URLは自分のプロジェクトに合わせて設定
input string AI_Endpoint_URL     = "https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader";
input string EA_Log_URL          = "https://nebphrnnpmuqbkymwefs.functions.supabase.co/ea-log";
input string AI_Config_URL       = "https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-config";
input string AI_Signals_URL      = "https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-signals";
input string AI_Bearer_Token     = "YOUR_SERVICE_ROLE_KEY";

input string AI_EA_Instance      = "main";
input string AI_EA_Version       = "1.2.3";
input int    AI_Timeout_ms       = 5000;

// ===== 内部変数 =====
datetime g_lastBar_M15=0, g_lastBar_H1=0;
datetime g_lastLogTs=0;
ulong    g_pendingTicket=0;
int      g_pendingDir=0;
datetime g_pendingAt=0;
int      g_dynamicExpiryMin=PendingExpiryMin;

// ポジション追跡用（ML学習用）
ulong    g_trackedPositionTicket=0;
datetime g_trackedPositionOpenTime=0;
double   g_trackedPositionEntryPrice=0;

// 入力（input）の動的コピー（ai-configで上書きするため）
double g_curMinWinProb;
double g_curPendingOffsetATR;
int    g_curPendingExpiryMin;

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

// ===== HTTPユーティリティ（★POSTはNUL無しで送る） =====
bool HttpPostJson(const string url,const string bearer,const string payload,string &resp,int timeout_ms=5000)
{
   uchar data[];
   // ★ UTF-8で丸ごと変換（WHOLE_ARRAY）→ 末尾のNUL(0x00)を削除
   int n = StringToCharArray(payload, data, 0, WHOLE_ARRAY, CP_UTF8);
   // 末尾の 0 を全部落とす（複数付くケースもケア）
   while(n > 0 && data[n-1] == 0) n--;
   if(n != ArraySize(data)) ArrayResize(data, n);

   string headers="Content-Type: application/json\r\nAuthorization: Bearer "+bearer+"\r\n";
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
   string headers="Authorization: Bearer "+bearer+"\r\n";
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

   string headers="Content-Type: application/json\r\nAuthorization: Bearer "+bearer+"\r\n";
   uchar result[]; string result_headers;
   int status=WebRequest("PUT",url,headers,timeout_ms,data,result,result_headers);
   if(status==-1){ int ec=GetLastError(); PrintFormat("[HTTP] PUT fail=%d url=%s", ec, url); return false; }
   resp=CharArrayToString(result,0,-1,CP_UTF8);
   if(status/100!=2){ PrintFormat("[HTTP] PUT status=%d body=%s", status, resp); return false; }
   return true;
}

string JsonEscape(string s){
   StringReplace(s,"\\","\\\\");StringReplace(s,"\"","\\\"");
   StringReplace(s,"\n","\\n");StringReplace(s,"\r","\\r");
   return s;
}

// ===== 指標関数 =====
double RSIv(ENUM_TIMEFRAMES tf,int period=14,ENUM_APPLIED_PRICE price=PRICE_CLOSE,int shift=0)
{int h=iRSI(_Symbol,tf,period,price);if(h==INVALID_HANDLE)return EMPTY_VALUE;
 double buf[]; if(CopyBuffer(h,0,shift,1,buf)<=0){IndicatorRelease(h);return EMPTY_VALUE;}
 IndicatorRelease(h);return buf[0];}

double ATRv(ENUM_TIMEFRAMES tf,int p=14,int s=0){int h=iATR(_Symbol,tf,p);if(h==INVALID_HANDLE)return EMPTY_VALUE;
 double b[];if(CopyBuffer(h,0,s,1,b)<=0){IndicatorRelease(h);return EMPTY_VALUE;}
 IndicatorRelease(h);return b[0];}

double MA(ENUM_TIMEFRAMES tf,int period,ENUM_MA_METHOD method,ENUM_APPLIED_PRICE price,int shift=0)
{int h=iMA(_Symbol,tf,period,0,method,price);if(h==INVALID_HANDLE)return EMPTY_VALUE;
 double b[];if(CopyBuffer(h,0,shift,1,b)<=0){IndicatorRelease(h);return EMPTY_VALUE;}
 IndicatorRelease(h);return b[0];}

// ===== テクニカルシグナル =====
struct TechSignal{int dir;string reason;double atr;double ref;};
TechSignal Evaluate(ENUM_TIMEFRAMES tf)
{
   TechSignal s; s.dir=0; s.reason=""; s.atr=ATRv(tf,14,0);
   double mid=(SymbolInfoDouble(_Symbol,SYMBOL_BID)+SymbolInfoDouble(_Symbol,SYMBOL_ASK))/2.0;
   s.ref=mid;
   double fast=MA(tf,25,MODE_EMA,PRICE_CLOSE,0);
   double slow=MA(tf,100,MODE_SMA,PRICE_CLOSE,0);
   if(fast>slow){s.dir=1;s.reason="MA↑";}
   else if(fast<slow){s.dir=-1;s.reason="MA↓";}
   return s;
}

// ===== AI連携 =====
struct AIOut{double win_prob;int action;double offset_factor;int expiry_min;};
bool ExtractJsonNumber(const string json,const string key,double &out){
   string pat="\""+key+"\":";int pos=StringFind(json,pat);if(pos<0)return false;
   pos+=StringLen(pat);int end=pos;while(end<StringLen(json)){
      ushort c=StringGetCharacter(json,end);
      if((c>='0'&&c<='9')||c=='-'||c=='+'||c=='.'||c=='e'||c=='E') end++; else break;}
   string num=StringSubstr(json,pos,end-pos);out=StringToDouble(num);return true;}
bool ExtractJsonInt(const string json,const string key,int &out){double d;if(!ExtractJsonNumber(json,key,d))return false;out=(int)MathRound(d);return true;}

bool QueryAI(const string tf_label,int dir,double rsi,double atr,double price,const string reason,AIOut &out_ai)
{
   string payload="{"+
   "\"symbol\":\""+JsonEscape(_Symbol)+"\","+
   "\"timeframe\":\""+JsonEscape(tf_label)+"\","+
   "\"dir\":"+IntegerToString(dir)+","+
   "\"rsi\":"+DoubleToString(rsi,2)+","+
   "\"atr\":"+DoubleToString(atr,5)+","+
   "\"price\":"+DoubleToString(price,_Digits)+","+
   "\"reason\":\""+JsonEscape(reason)+"\","+
   "\"instance\":\""+JsonEscape(AI_EA_Instance)+"\","+
   "\"version\":\""+JsonEscape(AI_EA_Version)+"\"}";

   string resp;
   if(!HttpPostJson(AI_Endpoint_URL,AI_Bearer_Token,payload,resp,AI_Timeout_ms)) return false;

   ExtractJsonNumber(resp,"win_prob",out_ai.win_prob);
   ExtractJsonInt(resp,"action",out_ai.action);
   ExtractJsonNumber(resp,"offset_factor",out_ai.offset_factor);
   double tmp; if(ExtractJsonNumber(resp,"expiry_minutes",tmp)) out_ai.expiry_min=(int)MathRound(tmp);

   // === Supabase ea-logに書き込み ===
   string logPayload="{"+
   "\"at\":\""+TimeToString(TimeCurrent(),TIME_DATE|TIME_SECONDS)+"\","+
   "\"sym\":\""+_Symbol+"\","+
   "\"tf\":\""+tf_label+"\","+
   "\"rsi\":"+DoubleToString(rsi,2)+","+
   "\"atr\":"+DoubleToString(atr,5)+","+
   "\"price\":"+DoubleToString(price,_Digits)+","+
   "\"action\":\""+(dir>0?"BUY":(dir<0?"SELL":"HOLD"))+"\","+
   "\"win_prob\":"+DoubleToString(out_ai.win_prob,3)+","+
   "\"offset_factor\":"+DoubleToString(out_ai.offset_factor,3)+","+
   "\"expiry_minutes\":"+IntegerToString(out_ai.expiry_min)+","+
   "\"reason\":\""+JsonEscape(reason)+"\","+
   "\"instance\":\""+AI_EA_Instance+"\","+
   "\"version\":\""+AI_EA_Version+"\","+
   "\"caller\":\""+tf_label+"\"}";
   string dummy; HttpPostJson(EA_Log_URL,AI_Bearer_Token,logPayload,dummy,3000);

   return true;
}

// ===== AI Signals記録（ML学習用） =====
void RecordSignal(const string tf_label,int dir,double rsi,double atr,double price,const string reason,const AIOut &ai,ulong ticket=0,double entry_price=0)
{
   string payload="{"+
   "\"symbol\":\""+JsonEscape(_Symbol)+"\","+
   "\"timeframe\":\""+JsonEscape(tf_label)+"\","+
   "\"dir\":"+IntegerToString(dir)+","+
   "\"win_prob\":"+DoubleToString(ai.win_prob,3)+","+
   "\"rsi\":"+DoubleToString(rsi,2)+","+
   "\"atr\":"+DoubleToString(atr,5)+","+
   "\"price\":"+DoubleToString(price,_Digits)+","+
   "\"reason\":\""+JsonEscape(reason)+"\","+
   "\"instance\":\""+JsonEscape(AI_EA_Instance)+"\","+
   "\"model_version\":\""+JsonEscape(AI_EA_Version)+"\"";
   
   if(ticket>0){
      payload+=",\"order_ticket\":"+IntegerToString(ticket);
      if(entry_price>0) payload+=",\"entry_price\":"+DoubleToString(entry_price,_Digits);
   }
   payload+="}";
   
   string resp;
   if(!HttpPostJson(AI_Signals_URL,AI_Bearer_Token,payload,resp,3000)){
      SafePrint("[AI_SIGNALS] Failed to record signal");
   }
}

void UpdateSignalResult(ulong ticket,double exit_price,double profit_loss,const string result,bool sl_hit,bool tp_hit)
{
   datetime now=TimeCurrent();
   int duration=0;
   if(g_trackedPositionOpenTime>0) duration=(int)((now-g_trackedPositionOpenTime)/60);
   
   string payload="{"+
   "\"order_ticket\":"+IntegerToString(ticket)+","+
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
      SafePrint(StringFormat("[AI_SIGNALS] Updated: ticket=%d result=%s P/L=%.2f",ticket,result,profit_loss));
   }
}

void CancelSignal(ulong ticket,const string reason)
{
   string payload="{"+
   "\"order_ticket\":"+IntegerToString(ticket)+","+
   "\"actual_result\":\"CANCELLED\","+
   "\"cancelled_reason\":\""+JsonEscape(reason)+"\"}";
   
   string resp;
   HttpPut(AI_Signals_URL,AI_Bearer_Token,payload,resp,3000);
}

// ===== 設定同期 =====
void SyncConfig()
{
   string resp;
   if(!HttpGet(AI_Config_URL,AI_Bearer_Token,resp,AI_Timeout_ms)) return;
   double v; int vi;
   if(ExtractJsonNumber(resp,"min_win_prob",v)&&v>0) g_curMinWinProb=v;
   if(ExtractJsonNumber(resp,"pending_offset_atr",v)&&v>0) g_curPendingOffsetATR=v;
   if(ExtractJsonInt(resp,"pending_expiry_min",vi)&&vi>0) g_curPendingExpiryMin=vi;
   SafePrint(StringFormat("[CONFIG] sync -> MinWinProb=%.2f, Offset=%.2f, Expiry=%d",g_curMinWinProb,g_curPendingOffsetATR,g_curPendingExpiryMin));
}

// ===== 注文関連 =====
struct PendingPlan{double price;double sl;double tp;int type;};
PendingPlan BuildPending(int dir,double atr,double ai_offset){
   PendingPlan p; p.type=0;if(atr<=0)return p;
   double mid=(SymbolInfoDouble(_Symbol,SYMBOL_BID)+SymbolInfoDouble(_Symbol,SYMBOL_ASK))/2.0;
   double offset=atr*(ai_offset>0?ai_offset:g_curPendingOffsetATR);
   double slDist=atr*RiskATRmult,tpDist=slDist*RewardRR;
   if(dir>0){p.type=ORDER_TYPE_BUY_LIMIT;p.price=mid-offset;p.sl=p.price-slDist;p.tp=p.price+tpDist;}
   else if(dir<0){p.type=ORDER_TYPE_SELL_LIMIT;p.price=mid+offset;p.sl=p.price+slDist;p.tp=p.price-tpDist;}
   return p;
}

bool OrderAlive(ulong t){if(t==0)return false;if(!OrderSelect(t))return false;long ty;OrderGetInteger(ORDER_TYPE,ty);
   return(ty==ORDER_TYPE_BUY_LIMIT||ty==ORDER_TYPE_SELL_LIMIT);}
bool Expired(){return g_pendingTicket>0&&(TimeCurrent()-g_pendingAt)>(g_dynamicExpiryMin*60);}
void Cancel(string why){if(g_pendingTicket==0)return;if(OrderSelect(g_pendingTicket)){
   trade.OrderDelete(g_pendingTicket);SafePrint("[ORDER] canceled: "+why);}
   g_pendingTicket=0;g_pendingDir=0;g_pendingAt=0;}

// ポジション数チェック
int CountPositions()
{
   int count=0;
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
   TechSignal t=Evaluate(TF_Entry); if(t.dir==0)return;
   double rsi=RSIv(PERIOD_M15,14,PRICE_CLOSE,0);
   AIOut ai; if(!QueryAI("M15",t.dir,rsi,t.atr,t.ref,t.reason,ai))return;

   if(ai.win_prob>=g_curMinWinProb){
      // ポジション数チェック
      int posCount=CountPositions();
      if(posCount>=MaxPositions){
         SafePrint(StringFormat("[M15] skip: already %d position(s)",posCount));
         return;
      }
      
      if(OrderAlive(g_pendingTicket)){
         CancelSignal(g_pendingTicket,"replace");
         Cancel("replace");
      }
      PendingPlan p=BuildPending(t.dir,t.atr,ai.offset_factor);
      trade.SetExpertMagicNumber(Magic);trade.SetDeviationInPoints(SlippagePoints);
      if(p.type==ORDER_TYPE_BUY_LIMIT) trade.BuyLimit(Lots,p.price,_Symbol,p.sl,p.tp);
      else trade.SellLimit(Lots,p.price,_Symbol,p.sl,p.tp);
      g_pendingTicket=trade.ResultOrder();g_pendingAt=TimeCurrent();g_pendingDir=t.dir;
      if(ai.expiry_min>0) g_dynamicExpiryMin=ai.expiry_min;
      
      // AI Signalを記録（ML学習用）
      RecordSignal("M15",t.dir,rsi,t.atr,t.ref,t.reason,ai,g_pendingTicket,0);
      
      SafePrint(StringFormat("[M15] set dir=%d prob=%.2f",t.dir,ai.win_prob));
   }else SafePrint(StringFormat("[M15] skip prob=%.2f<thr=%.2f",ai.win_prob,g_curMinWinProb));
}

void OnH1NewBar()
{
   SyncConfig(); // H1で設定再同期
   if(g_pendingTicket==0)return;
   if(!OrderAlive(g_pendingTicket)){Cancel("filled");return;}
   if(Expired()){
      CancelSignal(g_pendingTicket,"expired");
      Cancel("expired");
      return;
   }
   TechSignal t=Evaluate(TF_Recheck);
   double rsi=RSIv(PERIOD_H1,14,PRICE_CLOSE,0);
   AIOut ai; if(!QueryAI("H1",t.dir,rsi,t.atr,t.ref,t.reason,ai))return;
   bool rev=(t.dir!=0&&t.dir!=g_pendingDir);
   if(rev&&ai.win_prob<g_curMinWinProb){
      CancelSignal(g_pendingTicket,"trend-reversed");
      Cancel("trend-reversed");
   }else SafePrint("[H1] still valid");
}

// ===== ポジション監視（ML学習用） =====
void CheckPositionStatus()
{
   // ペンディングオーダーが約定したかチェック
   if(g_pendingTicket>0 && !OrderAlive(g_pendingTicket)){
      // 約定したか確認
      if(PositionSelectByTicket(g_pendingTicket)){
         g_trackedPositionTicket=g_pendingTicket;
         g_trackedPositionOpenTime=PositionGetInteger(POSITION_TIME);
         g_trackedPositionEntryPrice=PositionGetDouble(POSITION_PRICE_OPEN);
         
         // シグナル更新（エントリー価格を記録）
         string payload="{\"order_ticket\":"+IntegerToString(g_trackedPositionTicket)+
                        ",\"entry_price\":"+DoubleToString(g_trackedPositionEntryPrice,_Digits)+
                        ",\"actual_result\":\"FILLED\"}";
         string resp;
         HttpPut(AI_Signals_URL,AI_Bearer_Token,payload,resp,3000);
         
         SafePrint(StringFormat("[POSITION] Filled ticket=%d at %.5f",g_trackedPositionTicket,g_trackedPositionEntryPrice));
      }
   }
   
   // 追跡中のポジションがクローズされたかチェック
   if(g_trackedPositionTicket>0){
      if(!PositionSelectByTicket(g_trackedPositionTicket)){
         // ポジションがクローズされた - 履歴から結果を取得
         if(HistorySelectByPosition(g_trackedPositionTicket)){
            int total=HistoryDealsTotal();
            for(int i=total-1;i>=0;i--){
               ulong dealTicket=HistoryDealGetTicket(i);
               if(dealTicket>0 && HistoryDealGetInteger(dealTicket,DEAL_POSITION_ID)==g_trackedPositionTicket){
                  if(HistoryDealGetInteger(dealTicket,DEAL_ENTRY)==DEAL_ENTRY_OUT){
                     double exit_price=HistoryDealGetDouble(dealTicket,DEAL_PRICE);
                     double profit=HistoryDealGetDouble(dealTicket,DEAL_PROFIT);
                     long deal_reason=HistoryDealGetInteger(dealTicket,DEAL_REASON);
                     
                     bool sl_hit=(deal_reason==DEAL_REASON_SL);
                     bool tp_hit=(deal_reason==DEAL_REASON_TP);
                     
                     string result="BREAK_EVEN";
                     if(profit>0.01) result="WIN";
                     else if(profit<-0.01) result="LOSS";
                     
                     UpdateSignalResult(g_trackedPositionTicket,exit_price,profit,result,sl_hit,tp_hit);
                     
                     g_trackedPositionTicket=0;
                     g_trackedPositionOpenTime=0;
                     g_trackedPositionEntryPrice=0;
                     break;
                  }
               }
            }
         }
      }
   }
}

// ===== メイン =====
int OnInit(){
   trade.SetExpertMagicNumber(Magic);
   g_curMinWinProb=MinWinProb;
   g_curPendingOffsetATR=PendingOffsetATR;
   g_curPendingExpiryMin=PendingExpiryMin;
   SafePrint("[INIT] EA 1.2.3 start (ML tracking enabled)");
   SyncConfig();
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
