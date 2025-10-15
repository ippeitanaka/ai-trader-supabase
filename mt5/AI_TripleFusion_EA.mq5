//+------------------------------------------------------------------+
//| AI_QuadFusion_EA.mq5  (ver 1.3.0)                                |
//| - Supabase: ai-config / ai-signals(AI側) / ea-log                |
//| - POST時の末尾NUL(0x00)除去対応                                  |
//| - ML学習用: ai_signalsへの取引記録・結果追跡機能                 |
//| - Fix: ポジション約定後の重複ログ出力を修正                      |
//| - Enhanced: ea-logに詳細なAI判断とトレード状況を記録             |
//| - New: ai-signals-update エンドポイントで約定価格を記録          |
//| - v1.3.0: 一目均衡表（Ichimoku）を統合 - Quad Fusion化           |
//+------------------------------------------------------------------+
#property strict
#include <Trade/Trade.mqh>
CTrade trade;

// ===== 入力パラメータ =====
input bool   LockToChartSymbol = true;
input ENUM_TIMEFRAMES TF_Entry   = PERIOD_M15;
input ENUM_TIMEFRAMES TF_Recheck = PERIOD_H1;

input double MinWinProb          = 0.70;  // 0.70 = 70%, 0.75 = 75% (小数形式)
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
input string AI_Signals_Update_URL = "https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-signals-update";
input string AI_Bearer_Token     = "YOUR_SERVICE_ROLE_KEY";

input string AI_EA_Instance      = "main";
input string AI_EA_Version       = "1.3.0";
input int    AI_Timeout_ms       = 5000;

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

// ポジション追跡用（ML学習用）
ulong    g_trackedPositionTicket=0;
datetime g_trackedPositionOpenTime=0;
double   g_trackedPositionEntryPrice=0;

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
   int h=iIchimoku(_Symbol,tf,Ichimoku_Tenkan,Ichimoku_Kijun,Ichimoku_Senkou);
   if(h==INVALID_HANDLE){
      Print("[Ichimoku] Failed to create indicator handle");
      return false;
   }
   
   double tenkan_buf[],kijun_buf[],senkou_a_buf[],senkou_b_buf[],chikou_buf[];
   
   // 各バッファからデータを取得
   // 0:Tenkan, 1:Kijun, 2:SpanA, 3:SpanB, 4:Chikou
   bool ok=true;
   ok=ok&&CopyBuffer(h,0,shift,1,tenkan_buf)>0;
   ok=ok&&CopyBuffer(h,1,shift,1,kijun_buf)>0;
   ok=ok&&CopyBuffer(h,2,shift,1,senkou_a_buf)>0;
   ok=ok&&CopyBuffer(h,3,shift,1,senkou_b_buf)>0;
   ok=ok&&CopyBuffer(h,4,shift,1,chikou_buf)>0;
   
   if(!ok){
      IndicatorRelease(h);
      Print("[Ichimoku] Failed to copy buffers");
      return false;
   }
   
   ich.tenkan=tenkan_buf[0];
   ich.kijun=kijun_buf[0];
   ich.senkou_a=senkou_a_buf[0];
   ich.senkou_b=senkou_b_buf[0];
   ich.chikou=chikou_buf[0];
   
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
struct AIOut{double win_prob;int action;double offset_factor;int expiry_min;string reasoning;string confidence;};
bool ExtractJsonNumber(const string json,const string key,double &out){
   string pat="\""+key+"\":";int pos=StringFind(json,pat);if(pos<0)return false;
   pos+=StringLen(pat);int end=pos;while(end<StringLen(json)){
      ushort c=StringGetCharacter(json,end);
      if((c>='0'&&c<='9')||c=='-'||c=='+'||c=='.'||c=='e'||c=='E') end++; else break;}
   string num=StringSubstr(json,pos,end-pos);out=StringToDouble(num);return true;}
bool ExtractJsonInt(const string json,const string key,int &out){double d;if(!ExtractJsonNumber(json,key,d))return false;out=(int)MathRound(d);return true;}
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

bool QueryAI(const string tf_label,int dir,double rsi,double atr,double price,const string reason,double ichimoku_score,AIOut &out_ai)
{
   string payload="{"+
   "\"symbol\":\""+JsonEscape(_Symbol)+"\","+
   "\"timeframe\":\""+JsonEscape(tf_label)+"\","+
   "\"dir\":"+IntegerToString(dir)+","+
   "\"rsi\":"+DoubleToString(rsi,2)+","+
   "\"atr\":"+DoubleToString(atr,5)+","+
   "\"price\":"+DoubleToString(price,_Digits)+","+
   "\"reason\":\""+JsonEscape(reason)+"\","+
   "\"ichimoku_score\":"+DoubleToString(ichimoku_score,2)+","+
   "\"instance\":\""+JsonEscape(AI_EA_Instance)+"\","+
   "\"version\":\""+JsonEscape(AI_EA_Version)+"\"}";

   string resp;
   if(!HttpPostJson(AI_Endpoint_URL,AI_Bearer_Token,payload,resp,AI_Timeout_ms)) return false;

   ExtractJsonNumber(resp,"win_prob",out_ai.win_prob);
   ExtractJsonInt(resp,"action",out_ai.action);
   ExtractJsonNumber(resp,"offset_factor",out_ai.offset_factor);
   double tmp; if(ExtractJsonNumber(resp,"expiry_minutes",tmp)) out_ai.expiry_min=(int)MathRound(tmp);
   ExtractJsonString(resp,"reasoning",out_ai.reasoning);
   ExtractJsonString(resp,"confidence",out_ai.confidence);

   return true;
}

// ea-logに詳細記録（トレード判定情報含む）
void LogAIDecision(const string tf_label,int dir,double rsi,double atr,double price,const string reason,const AIOut &ai,const string trade_decision,bool threshold_met,int current_pos,ulong ticket=0)
{
   string logPayload="{"+
   "\"at\":\""+TimeToString(TimeCurrent(),TIME_DATE|TIME_SECONDS)+"\","+
   "\"sym\":\""+_Symbol+"\","+
   "\"tf\":\""+tf_label+"\","+
   "\"rsi\":"+DoubleToString(rsi,2)+","+
   "\"atr\":"+DoubleToString(atr,5)+","+
   "\"price\":"+DoubleToString(price,_Digits)+","+
   "\"action\":\""+(dir>0?"BUY":(dir<0?"SELL":"HOLD"))+"\","+
   "\"win_prob\":"+DoubleToString(ai.win_prob,3)+","+
   "\"ai_confidence\":\""+(ai.confidence!=""?JsonEscape(ai.confidence):"unknown")+"\","+
   "\"ai_reasoning\":\""+(ai.reasoning!=""?JsonEscape(ai.reasoning):"N/A")+"\","+
   "\"trade_decision\":\""+JsonEscape(trade_decision)+"\","+
   "\"threshold_met\":"+(threshold_met?"true":"false")+","+
   "\"current_positions\":"+IntegerToString(current_pos)+","+
   (ticket>0?"\"order_ticket\":"+IntegerToString(ticket)+",":"")+
   "\"offset_factor\":"+DoubleToString(ai.offset_factor,3)+","+
   "\"expiry_minutes\":"+IntegerToString(ai.expiry_min)+","+
   "\"reason\":\""+JsonEscape(reason)+"\","+
   "\"instance\":\""+AI_EA_Instance+"\","+
   "\"version\":\""+AI_EA_Version+"\","+
   "\"caller\":\""+tf_label+"\"}";
   string dummy; HttpPostJson(EA_Log_URL,AI_Bearer_Token,logPayload,dummy,3000);
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

// ===== 設定同期（無効化：すべてEAプロパティから取得） =====
void SyncConfig()
{
   // ai_configテーブルの使用を中止
   // すべてのパラメータはEAのinputプロパティから取得します
   SafePrint(StringFormat("[CONFIG] Using EA properties -> MinWinProb=%.0f%%, Risk=%.2f, RR=%.2f, Offset=%.2f, Expiry=%d, Lots=%.2f, Slip=%d, MaxPos=%d",
      MinWinProb*100,RiskATRmult,RewardRR,PendingOffsetATR,PendingExpiryMin,Lots,SlippagePoints,MaxPositions));
}

// ===== 注文関連 =====
struct PendingPlan{double price;double sl;double tp;int type;};
PendingPlan BuildPending(int dir,double atr,double ai_offset){
   PendingPlan p; p.type=0;if(atr<=0)return p;
   double mid=(SymbolInfoDouble(_Symbol,SYMBOL_BID)+SymbolInfoDouble(_Symbol,SYMBOL_ASK))/2.0;
   double offset=atr*(ai_offset>0?ai_offset:PendingOffsetATR);
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
   AIOut ai; if(!QueryAI("M15",t.dir,rsi,t.atr,t.ref,t.reason,t.ichimoku_score,ai))return;

   int posCount=CountPositions();
   bool threshold_met=(ai.win_prob>=MinWinProb);
   
   if(threshold_met){
      // ポジション数チェック
      if(posCount>=MaxPositions){
         LogAIDecision("M15",t.dir,rsi,t.atr,t.ref,t.reason,ai,"SKIPPED_MAX_POS",threshold_met,posCount,0);
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
      
      // ea-logに詳細記録
      LogAIDecision("M15",t.dir,rsi,t.atr,t.ref,t.reason,ai,"EXECUTED",threshold_met,posCount,g_pendingTicket);
      SafePrint(StringFormat("[M15] set dir=%d prob=%.0f%%",t.dir,ai.win_prob*100));
   }else{
      LogAIDecision("M15",t.dir,rsi,t.atr,t.ref,t.reason,ai,"SKIPPED_LOW_PROB",threshold_met,posCount,0);
      SafePrint(StringFormat("[M15] skip prob=%.0f%% < thr=%.0f%%",ai.win_prob*100,MinWinProb*100));
   }
}

void OnH1NewBar()
{
   // SyncConfig()は無効化：すべてEAプロパティを使用
   if(g_pendingTicket==0)return;
   if(!OrderAlive(g_pendingTicket)){Cancel("filled");return;}
   if(Expired()){
      CancelSignal(g_pendingTicket,"expired");
      Cancel("expired");
      return;
   }
   TechSignal t=Evaluate(TF_Recheck);
   double rsi=RSIv(PERIOD_H1,14,PRICE_CLOSE,0);
   AIOut ai; if(!QueryAI("H1",t.dir,rsi,t.atr,t.ref,t.reason,t.ichimoku_score,ai))return;
   
   int posCount=CountPositions();
   bool threshold_met=(ai.win_prob>=MinWinProb);
   bool rev=(t.dir!=0&&t.dir!=g_pendingDir);
   
   if(rev&&!threshold_met){
      LogAIDecision("H1",t.dir,rsi,t.atr,t.ref,t.reason,ai,"CANCELLED_REVERSAL",threshold_met,posCount,g_pendingTicket);
      CancelSignal(g_pendingTicket,"trend-reversed");
      Cancel("trend-reversed");
   }else{
      LogAIDecision("H1",t.dir,rsi,t.atr,t.ref,t.reason,ai,"RECHECK_OK",threshold_met,posCount,g_pendingTicket);
      SafePrint("[H1] still valid");
   }
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
         
         // シグナル更新（エントリー価格を記録） - 新しいエンドポイントを使用
         string payload="{\"order_ticket\":"+IntegerToString(g_trackedPositionTicket)+
                        ",\"entry_price\":"+DoubleToString(g_trackedPositionEntryPrice,_Digits)+
                        ",\"actual_result\":\"FILLED\"}";
         string resp;
         HttpPostJson(AI_Signals_Update_URL,AI_Bearer_Token,payload,resp,3000);
         
         SafePrint(StringFormat("[POSITION] Filled ticket=%d at %.5f",g_trackedPositionTicket,g_trackedPositionEntryPrice));
         
         // ペンディングチケットをリセット（重複ログ防止）
         g_pendingTicket=0;
         g_pendingDir=0;
         g_pendingAt=0;
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
   SafePrint("[INIT] EA 1.2.6 start (Entry price tracking for ML learning)");
   SafePrint(StringFormat("[CONFIG] Using EA properties -> MinWinProb=%.0f%%, Risk=%.2f, RR=%.2f, Lots=%.2f, MaxPos=%d",
      MinWinProb*100,RiskATRmult,RewardRR,Lots,MaxPositions));
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
