//+------------------------------------------------------------------+
//| AI_QuadFusion_EA.mq5  (ver 1.5.1)                                |
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

input double MinWinProb          = 0.85;  // 🚨 EMERGENCY: 0.85 = 85% (低品質シグナルをフィルタ)
input double RiskATRmult         = 2.0;   // 🚨 EMERGENCY: ストップロス拡大（大損失防止）
input double RewardRR            = 1.5;   // 🚨 EMERGENCY: リスクリワード比改善
input double PendingOffsetATR    = 0.2;
input int    PendingExpiryMin    = 90;
input double Lots                = 0.10;
input double MaxLots             = 0.30;  // ロット倍率適用時の最大値（リスク管理）
input int    SlippagePoints      = 1000;
input long   Magic               = 26091501;
input int    MaxPositions        = 1;      // 同一銘柄の最大ポジション数

// 🚨 EMERGENCY: エントリー制限
input bool   DisableBreakout     = true;  // 🚨 breakoutエントリーを一時無効化（現在100%失敗中）

input bool   DebugLogs           = true;
input int    LogCooldownSec      = 30;  // 0=全出力, >0=間引き, -1=完全OFF
input int    CooldownAfterCloseMin = 30; // TP/SL後のクールダウン（分）

// ★ URLは自分のプロジェクトに合わせて設定
input string AI_Endpoint_URL     = "https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ai-trader";
input string EA_Log_URL          = "https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ea-log";
input string AI_Signals_URL      = "https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ai-signals";
input string AI_Signals_Update_URL = "https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ai-signals-update";
input string AI_Bearer_Token     = "YOUR_SERVICE_ROLE_KEY_HERE";

input string AI_EA_Instance      = "main";
input string AI_EA_Version       = "1.5.1";
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
datetime g_cooldownUntil=0; // TP/SLクローズ後のクールダウン期限

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

// クールダウン判定
bool InCooldown()
{
   return (g_cooldownUntil>0 && TimeCurrent()<g_cooldownUntil);
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

// MACD取得関数
bool GetMACD(ENUM_TIMEFRAMES tf,double &macd_main,double &macd_signal,double &macd_hist,int shift=0)
{
   int h=iMACD(_Symbol,tf,12,26,9,PRICE_CLOSE);
   if(h==INVALID_HANDLE){
      Print("[MACD] Failed to create indicator handle");
      return false;
   }
   
   double main_buf[],signal_buf[];
   
   bool ok=true;
   ok=ok&&CopyBuffer(h,0,shift,1,main_buf)>0;    // MACD Main
   ok=ok&&CopyBuffer(h,1,shift,1,signal_buf)>0;  // Signal
   
   if(!ok){
      IndicatorRelease(h);
      Print("[MACD] Failed to copy buffers");
      return false;
   }
   
   macd_main=main_buf[0];
   macd_signal=signal_buf[0];
   macd_hist=macd_main-macd_signal;
   
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
struct AIOut{
   double win_prob;int action;double offset_factor;int expiry_min;string reasoning;string confidence;
   // Hybrid entry
   string entry_method;          // pullback|breakout|mtf_confirm|none
   string method_selected_by;    // OpenAI|Fallback
   double method_confidence;     // 0.0-1.0
   string method_reason;
   // entry_params (flattened minimal subset)
   double k;                     // pullback: ATR係数
   double o;                     // breakout: ATRオフセット
   int    expiry_bars;           // 2|3
   string confirm_tf;            // e.g. M5
   string confirm_rule;          // close_break|macd_flip
   string order_type;            // market|limit
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

bool QueryAI(const string tf_label,int dir,double rsi,double atr,double price,const string reason,double ichimoku_score,AIOut &out_ai)
{
   // ★ テクニカル指標の詳細データを取得
   ENUM_TIMEFRAMES tf=(tf_label=="M15")?TF_Entry:TF_Recheck;
   double ema_25=MA(tf,25,MODE_EMA,PRICE_CLOSE,0);
   double sma_100=MA(tf,100,MODE_SMA,PRICE_CLOSE,0);
   double sma_200=MA(tf,200,MODE_SMA,PRICE_CLOSE,0);
   double sma_800=MA(tf,800,MODE_SMA,PRICE_CLOSE,0);
   
   // MACD取得
   double macd_main,macd_signal,macd_hist;
   bool has_macd=GetMACD(tf,macd_main,macd_signal,macd_hist,0);
   
   // 一目均衡表取得
   IchimokuValues ich;
   bool has_ichimoku=GetIchimoku(tf,ich,0);
   
   // 価格情報
   double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   
   // ★ すべての生データをAIに送信
   string payload="{"+
   "\"symbol\":\""+JsonEscape(_Symbol)+"\","+
   "\"timeframe\":\""+JsonEscape(tf_label)+"\","+
   
   // 価格情報
   "\"price\":"+DoubleToString(price,_Digits)+","+
   "\"bid\":"+DoubleToString(bid,_Digits)+","+
   "\"ask\":"+DoubleToString(ask,_Digits)+","+
   
   // 移動平均線（生データ）
   "\"ema_25\":"+DoubleToString(ema_25,_Digits)+","+
   "\"sma_100\":"+DoubleToString(sma_100,_Digits)+","+
   "\"sma_200\":"+DoubleToString(sma_200,_Digits)+","+
   "\"sma_800\":"+DoubleToString(sma_800,_Digits)+","+
   "\"ma_cross\":"+(ema_25>sma_100?"1":"-1")+","+
   
   // RSI & ATR
   "\"rsi\":"+DoubleToString(rsi,2)+","+
   "\"atr\":"+DoubleToString(atr,5)+","+
   
   // MACD（生データ）
   "\"macd\":{"+
      "\"main\":"+DoubleToString(macd_main,5)+","+
      "\"signal\":"+DoubleToString(macd_signal,5)+","+
      "\"histogram\":"+DoubleToString(macd_hist,5)+","+
      "\"cross\":"+(macd_main>macd_signal?"1":"-1")+
   "},"+
   
   // 一目均衡表（全ライン）
   "\"ichimoku\":{"+
      "\"tenkan\":"+DoubleToString(ich.tenkan,_Digits)+","+
      "\"kijun\":"+DoubleToString(ich.kijun,_Digits)+","+
      "\"senkou_a\":"+DoubleToString(ich.senkou_a,_Digits)+","+
      "\"senkou_b\":"+DoubleToString(ich.senkou_b,_Digits)+","+
      "\"chikou\":"+DoubleToString(ich.chikou,_Digits)+","+
      "\"tk_cross\":"+(ich.tenkan>ich.kijun?"1":"-1")+","+
      "\"cloud_color\":"+(ich.senkou_a>ich.senkou_b?"1":"-1")+","+
      "\"price_vs_cloud\":"+
         (price>MathMax(ich.senkou_a,ich.senkou_b)?"1":
          (price<MathMin(ich.senkou_a,ich.senkou_b)?"-1":"0"))+
   "},"+
   
   // EA側の判断（参考情報として）
   "\"ea_suggestion\":{"+
      "\"dir\":"+IntegerToString(dir)+","+
      "\"reason\":\""+JsonEscape(reason)+"\","+
      "\"ichimoku_score\":"+DoubleToString(ichimoku_score,2)+
   "},"+
   
   "\"instance\":\""+JsonEscape(AI_EA_Instance)+"\","+
   "\"version\":\""+JsonEscape(AI_EA_Version)+"\"}";

   string resp;
   if(!HttpPostJson(AI_Endpoint_URL,AI_Bearer_Token,payload,resp,AI_Timeout_ms)) return false;

   ExtractJsonNumber(resp,"win_prob",out_ai.win_prob);
   ExtractJsonInt(resp,"action",out_ai.action);
   ExtractJsonNumber(resp,"offset_factor",out_ai.offset_factor);
   double tmp; if(ExtractJsonNumber(resp,"expiry_minutes",tmp)) out_ai.expiry_min=(int)MathRound(tmp);
   ExtractJsonString(resp,"reasoning",out_ai.reasoning);
   ExtractJsonString(resp,"reasoning",out_ai.reasoning);
   ExtractJsonString(resp,"confidence",out_ai.confidence);
   // Hybrid entry fields
   ExtractJsonString(resp,"entry_method",out_ai.entry_method);
   ExtractJsonString(resp,"method_selected_by",out_ai.method_selected_by);
   double mc; if(ExtractJsonNumber(resp,"method_confidence",mc)) out_ai.method_confidence=mc; else out_ai.method_confidence=0.0;
   ExtractJsonString(resp,"method_reason",out_ai.method_reason);
   string paramsSec; if(ExtractJsonObjectSection(resp,"entry_params",paramsSec)){
      double val;
      if(ExtractJsonInSectionNumber(paramsSec,"k",val)) out_ai.k=val;
      if(ExtractJsonInSectionNumber(paramsSec,"o",val)) out_ai.o=val;
      if(ExtractJsonInSectionNumber(paramsSec,"expiry_bars",val)) out_ai.expiry_bars=(int)MathRound(val);
      string s;
      if(ExtractJsonInSectionString(paramsSec,"confirm_tf",s)) out_ai.confirm_tf=s;
      if(ExtractJsonInSectionString(paramsSec,"confirm_rule",s)) out_ai.confirm_rule=s;
      if(ExtractJsonInSectionString(paramsSec,"order_type",s)) out_ai.order_type=s;
   }
   
   // ロット倍率（ML学習データに基づく）
   double lm; if(ExtractJsonNumber(resp,"lot_multiplier",lm)) out_ai.lot_multiplier=lm; else out_ai.lot_multiplier=1.0;
   ExtractJsonString(resp,"lot_level",out_ai.lot_level);
   ExtractJsonString(resp,"lot_reason",out_ai.lot_reason);
   
   // ML pattern tracking
   if(!ExtractJsonBool(resp,"ml_pattern_used",out_ai.ml_pattern_used)) out_ai.ml_pattern_used=false;
   int mlId=0; if(ExtractJsonInt(resp,"ml_pattern_id",mlId)) out_ai.ml_pattern_id=(long)mlId; else out_ai.ml_pattern_id=0;
   ExtractJsonString(resp,"ml_pattern_name",out_ai.ml_pattern_name);
   double mlConf; if(ExtractJsonNumber(resp,"ml_pattern_confidence",mlConf)) out_ai.ml_pattern_confidence=mlConf; else out_ai.ml_pattern_confidence=0.0;

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
   "\"entry_method\":\""+JsonEscape(ai.entry_method)+"\","+
   "\"method_selected_by\":\""+JsonEscape(ai.method_selected_by)+"\","+
   "\"method_confidence\":"+DoubleToString(ai.method_confidence,3)+","+
   "\"method_reason\":\""+JsonEscape(ai.method_reason)+"\","+
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
void RecordSignal(const string tf_label,int dir,double rsi,double atr,double price,const string reason,const AIOut &ai,ulong ticket=0,double entry_price=0,bool mark_filled=false)
{
   string params="{"+
                "\"k\":"+DoubleToString(ai.k,3)+","+
                "\"o\":"+DoubleToString(ai.o,3)+","+
                "\"expiry_bars\":"+IntegerToString(ai.expiry_bars)+","+
                "\"confirm_tf\":\""+JsonEscape(ai.confirm_tf)+"\","+
                "\"confirm_rule\":\""+JsonEscape(ai.confirm_rule)+"\","+
                "\"order_type\":\""+JsonEscape(ai.order_type)+"\""+
                "}";

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
   "\"model_version\":\""+JsonEscape(AI_EA_Version)+"\","+
   "\"entry_method\":\""+JsonEscape(ai.entry_method)+"\","+
   "\"entry_params\":"+params+","+
   "\"method_selected_by\":\""+JsonEscape(ai.method_selected_by)+"\","+
   "\"method_confidence\":"+DoubleToString(ai.method_confidence,3)+","+
   "\"method_reason\":\""+JsonEscape(ai.method_reason)+"\","+
   "\"ml_pattern_used\":"+(ai.ml_pattern_used?"true":"false")+","+
   "\"ml_pattern_id\":"+(ai.ml_pattern_id>0?IntegerToString(ai.ml_pattern_id):"null")+","+
   "\"ml_pattern_name\":\""+(ai.ml_pattern_name!=""?JsonEscape(ai.ml_pattern_name):"null")+"\","+
   "\"ml_pattern_confidence\":"+(ai.ml_pattern_confidence>0?DoubleToString(ai.ml_pattern_confidence,2):"null")+"";

   if(ticket>0){
      payload+=",\"order_ticket\":"+IntegerToString(ticket);
      if(entry_price>0) payload+=",\"entry_price\":"+DoubleToString(entry_price,_Digits);
   }
   if(mark_filled){ payload+=",\"actual_result\":\"FILLED\""; }
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

// Breakout pending plan using recent swing with ATR offset
PendingPlan BuildBreakout(int dir,double atr,double o){
   PendingPlan p; p.type=0; if(atr<=0) return p;
   int lookback=20; 
   double slDist=atr*RiskATRmult, tpDist=slDist*RewardRR;
   double off=atr*(o>0?o:0.2);
   if(dir>0){
      int idx=iHighest(_Symbol,TF_Entry,MODE_HIGH,lookback,1);
      double swing=iHigh(_Symbol,TF_Entry,idx);
      p.type=ORDER_TYPE_BUY_STOP; p.price=swing+off; p.sl=p.price-slDist; p.tp=p.price+tpDist;
   }else if(dir<0){
      int idx=iLowest(_Symbol,TF_Entry,MODE_LOW,lookback,1);
      double swing=iLow(_Symbol,TF_Entry,idx);
      p.type=ORDER_TYPE_SELL_STOP; p.price=swing-off; p.sl=p.price+slDist; p.tp=p.price-tpDist;
   }
   return p;
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

// ポジション数チェック（アクティブポジション + ペンディングオーダー）
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
   double rsi=RSIv(PERIOD_M15,14,PRICE_CLOSE,0);
   AIOut ai; if(!QueryAI("M15",t.dir,rsi,t.atr,t.ref,t.reason,t.ichimoku_score,ai))return;

   int posCount=CountPositions();
   bool threshold_met=(ai.win_prob>=MinWinProb);
   
   if(threshold_met){
      // ポジション数チェック（ペンディングオーダー含む）
      if(posCount>=MaxPositions){
         LogAIDecision("M15",t.dir,rsi,t.atr,t.ref,t.reason,ai,"SKIPPED_MAX_POS",threshold_met,posCount,0);
         SafePrint(StringFormat("[M15] skip: already %d position(s) or pending order(s)",posCount));
         return;
      }
      
      // 追跡中のポジションがある場合も新規注文しない（約定直後の重複防止）
      if(g_trackedPositionTicket>0 && PositionSelectByTicket(g_trackedPositionTicket)){
         LogAIDecision("M15",t.dir,rsi,t.atr,t.ref,t.reason,ai,"SKIPPED_TRACKED_POS",threshold_met,1,g_trackedPositionTicket);
         SafePrint(StringFormat("[M15] skip: tracked position active (ticket=%d)",g_trackedPositionTicket));
         return;
      }
      
      if(OrderAlive(g_pendingTicket)){
         CancelSignal(g_pendingTicket,"replace");
         Cancel("replace");
      }
      // expiry preference: minutes from AI or from bars*15
      if(ai.expiry_min>0) g_dynamicExpiryMin=ai.expiry_min; else if(ai.expiry_bars>0) g_dynamicExpiryMin=ai.expiry_bars*15;

      trade.SetExpertMagicNumber(Magic);trade.SetDeviationInPoints(SlippagePoints);

   string method=ai.entry_method;
      ulong placed_ticket=0; bool executed=false;
      
      // 🚨 EMERGENCY: breakout エントリーを一時無効化（現在100%失敗中）
      if(method=="breakout"){
         if(DisableBreakout){
            LogAIDecision("M15",t.dir,rsi,t.atr,t.ref,t.reason,ai,"SKIPPED_BREAKOUT_DISABLED",threshold_met,posCount,0);
            SafePrint("[M15] breakout disabled due to poor performance (see DisableBreakout parameter)");
            return;
         }
         PendingPlan pbo=BuildBreakout(t.dir,t.atr,(ai.o>0?ai.o:ai.offset_factor));
         if(pbo.type==ORDER_TYPE_BUY_STOP) trade.BuyStop(Lots,pbo.price,_Symbol,pbo.sl,pbo.tp);
         else if(pbo.type==ORDER_TYPE_SELL_STOP) trade.SellStop(Lots,pbo.price,_Symbol,pbo.sl,pbo.tp);
         placed_ticket=trade.ResultOrder(); executed=(placed_ticket>0);
      }else if(method=="mtf_confirm"){
         ENUM_TIMEFRAMES ctf=ParseTF(ai.confirm_tf);
         bool confirmed=true;
         if(ai.confirm_rule=="macd_flip"){
            double mm,ms,mh; if(GetMACD(ctf,mm,ms,mh,0)) confirmed=(t.dir>0? (mm>ms):(mm<ms));
         }else if(ai.confirm_rule=="close_break"){
            double ma20=MA(ctf,20,MODE_SMA,PRICE_CLOSE,0); double close0=iClose(_Symbol,ctf,0);
            confirmed=(t.dir>0? (close0>ma20):(close0<ma20));
         }
         if(!confirmed){
            LogAIDecision("M15",t.dir,rsi,t.atr,t.ref,t.reason,ai,"SKIPPED_MTF_WAIT",threshold_met,posCount,0);
            SafePrint("[M15] mtf_confirm: waiting for confirmation");
            return;
         }
         // ⭐ ML学習データに基づくロット倍率を適用（最大値制限あり）
         double finalLots = MathMin(Lots * ai.lot_multiplier, MaxLots);
         if(ai.lot_multiplier > 1.0){
            SafePrint(StringFormat("[M15] Dynamic Lot Sizing: %.2fx (%.2f → %.2f) - %s",
                      ai.lot_multiplier, Lots, finalLots, ai.lot_level));
         }
         
         if(ai.order_type=="market"){
            double slDist=t.atr*RiskATRmult, tpDist=slDist*RewardRR; bool ok=false; double entry=0.0; ulong posTicket=0;
            double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID), ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
            if(t.dir>0){ ok=trade.Buy(finalLots,_Symbol,0,ask-slDist,ask+tpDist); if(ok && PositionSelect(_Symbol)){posTicket=(ulong)PositionGetInteger(POSITION_TICKET); entry=PositionGetDouble(POSITION_PRICE_OPEN);} }
            else{ ok=trade.Sell(finalLots,_Symbol,0,bid+slDist,bid-tpDist); if(ok && PositionSelect(_Symbol)){posTicket=(ulong)PositionGetInteger(POSITION_TICKET); entry=PositionGetDouble(POSITION_PRICE_OPEN);} }
            if(ok && posTicket>0){
               // Market注文が成功したら即座に追跡開始（重複防止）
               g_trackedPositionTicket=posTicket;
               g_trackedPositionOpenTime=(datetime)PositionGetInteger(POSITION_TIME);
               g_trackedPositionEntryPrice=entry;
               
               RecordSignal("M15",t.dir,rsi,t.atr,t.ref,t.reason,ai,posTicket,entry,true);
               LogAIDecision("M15",t.dir,rsi,t.atr,t.ref,t.reason,ai,"EXECUTED_MARKET",threshold_met,posCount,posTicket);
               SafePrint(StringFormat("[M15] market executed dir=%d prob=%.0f%% lot=%.2f",t.dir,ai.win_prob*100,finalLots));
               return;
            }else{
               SafePrint("[M15] market execution failed, fallback to pullback limit");
            }
         }
         double k=(ai.k>0?ai.k:ai.offset_factor); PendingPlan pcf=BuildPending(t.dir,t.atr,k);
         if(pcf.type==ORDER_TYPE_BUY_LIMIT) trade.BuyLimit(finalLots,pcf.price,_Symbol,pcf.sl,pcf.tp); else trade.SellLimit(finalLots,pcf.price,_Symbol,pcf.sl,pcf.tp);
         placed_ticket=trade.ResultOrder(); executed=(placed_ticket>0);
      }else{ // pullback or default
         // ⭐ ML学習データに基づくロット倍率を適用（最大値制限あり）
         double finalLots = MathMin(Lots * ai.lot_multiplier, MaxLots);
         if(ai.lot_multiplier > 1.0){
            SafePrint(StringFormat("[M15] Dynamic Lot Sizing: %.2fx (%.2f → %.2f) - %s",
                      ai.lot_multiplier, Lots, finalLots, ai.lot_level));
         }
         
         double k=(ai.k>0?ai.k:ai.offset_factor); PendingPlan p=BuildPending(t.dir,t.atr,k);
         if(p.type==ORDER_TYPE_BUY_LIMIT) trade.BuyLimit(finalLots,p.price,_Symbol,p.sl,p.tp); else trade.SellLimit(finalLots,p.price,_Symbol,p.sl,p.tp);
         placed_ticket=trade.ResultOrder(); executed=(placed_ticket>0);
      }

      if(executed){
         g_pendingTicket=placed_ticket; g_pendingAt=TimeCurrent(); g_pendingDir=t.dir;
         RecordSignal("M15",t.dir,rsi,t.atr,t.ref,t.reason,ai,g_pendingTicket,0);
         LogAIDecision("M15",t.dir,rsi,t.atr,t.ref,t.reason,ai,"EXECUTED",threshold_met,posCount,g_pendingTicket);
         SafePrint(StringFormat("[M15] set dir=%d prob=%.0f%%",t.dir,ai.win_prob*100));
      }else{
         SafePrint("[M15] order placement failed");
      }
   }else{
      LogAIDecision("M15",t.dir,rsi,t.atr,t.ref,t.reason,ai,"SKIPPED_LOW_PROB",threshold_met,posCount,0);
      SafePrint(StringFormat("[M15] skip prob=%.0f%% < thr=%.0f%%",ai.win_prob*100,MinWinProb*100));
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
               if(dealTicket>0 && (ulong)HistoryDealGetInteger(dealTicket,DEAL_POSITION_ID)==g_trackedPositionTicket){
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

                     // ★ TP/SL時のみクールダウンを設定
                     if(sl_hit || tp_hit){
                        g_cooldownUntil = TimeCurrent() + (CooldownAfterCloseMin*60);
                        SafePrint(StringFormat("[COOLDOWN] Start %d min after %s (ticket=%d)",
                           CooldownAfterCloseMin, (tp_hit?"TP":"SL"), g_trackedPositionTicket));
                     }
                     
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
   SafePrint("[INIT] EA 1.5.1 start (Quad Fusion with full technical data to AI + Race Condition Fix)");
   SafePrint(StringFormat("[CONFIG] Using EA properties -> MinWinProb=%.0f%%, Risk=%.2f, RR=%.2f, Lots=%.2f, MaxPos=%d",
      MinWinProb*100,RiskATRmult,RewardRR,Lots,MaxPositions));
   SafePrint("[INFO] Sending EMA25, SMA100, SMA200, SMA800, MACD, RSI, ATR, Ichimoku (all lines) to AI");
   SafePrint("[FIX] v1.5.1: Enhanced duplicate position prevention (pending orders + tracked positions)");
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
