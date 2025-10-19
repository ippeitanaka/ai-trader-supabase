#!/bin/bash

# リアルタイムトレードモニタリングスクリプト

echo "🔍 AIトレーダー - リアルタイムモニタリング"
echo "================================================"
echo ""

# カラー定義
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

while true; do
  clear
  echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║         AIトレーダー - リアルタイムモニタリング           ║${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${GREEN}更新日時: $(date '+%Y-%m-%d %H:%M:%S')${NC}"
  echo ""
  
  # 📊 最新のトレードログ (ea-log)
  echo -e "${YELLOW}━━━ 📊 最新のトレードログ (ea-log) ━━━${NC}"
  docker exec supabase_db_ai-trader-supabase psql -U postgres -t -c "
    SELECT 
      TO_CHAR(created_at, 'HH24:MI:SS') as time,
      RPAD(sym, 10) as symbol,
      RPAD(COALESCE(action, 'N/A'), 6) as action,
      LPAD(ROUND(COALESCE(win_prob, 0) * 100)::text || '%', 5) as prob,
      LEFT(COALESCE(ai_reasoning, 'No reasoning'), 40) as reasoning
    FROM \"ea-log\"
    WHERE created_at >= NOW() - INTERVAL '1 hour'
    ORDER BY created_at DESC
    LIMIT 5;
  " 2>/dev/null || echo "  データベース接続エラー"
  
  echo ""
  
  # 📈 AIシグナル統計
  echo -e "${YELLOW}━━━ 📈 AIシグナル統計 (ai_signals) ━━━${NC}"
  docker exec supabase_db_ai-trader-supabase psql -U postgres -t -c "
    SELECT 
      '総シグナル数: ' || COUNT(*) || '件' as stats
    FROM ai_signals
    WHERE created_at >= NOW() - INTERVAL '24 hours';
    
    SELECT 
      '平均勝率予測: ' || ROUND(AVG(win_prob) * 100, 1) || '%' as avg_pred
    FROM ai_signals
    WHERE created_at >= NOW() - INTERVAL '24 hours';
    
    SELECT 
      '実績勝率: ' || 
      ROUND(
        SUM(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END)::DECIMAL / 
        NULLIF(SUM(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 ELSE 0 END), 0) * 100, 
        1
      ) || '%' as actual_win
    FROM ai_signals
    WHERE created_at >= NOW() - INTERVAL '24 hours'
      AND actual_result IN ('WIN', 'LOSS');
  " 2>/dev/null || echo "  統計データなし"
  
  echo ""
  
  # 💰 損益サマリー
  echo -e "${YELLOW}━━━ 💰 損益サマリー (24時間) ━━━${NC}"
  docker exec supabase_db_ai-trader-supabase psql -U postgres -t -c "
    SELECT 
      '総損益: ' || COALESCE(ROUND(SUM(profit_loss), 2), 0) || ' USD' as total_pl,
      '平均利益: ' || COALESCE(ROUND(AVG(CASE WHEN profit_loss > 0 THEN profit_loss END), 2), 0) || ' USD' as avg_profit,
      '平均損失: ' || COALESCE(ROUND(AVG(CASE WHEN profit_loss < 0 THEN profit_loss END), 2), 0) || ' USD' as avg_loss
    FROM ai_signals
    WHERE created_at >= NOW() - INTERVAL '24 hours'
      AND profit_loss IS NOT NULL;
  " 2>/dev/null || echo "  損益データなし"
  
  echo ""
  
  # 📋 アクティブポジション
  echo -e "${YELLOW}━━━ 📋 アクティブポジション ━━━${NC}"
  docker exec supabase_db_ai-trader-supabase psql -U postgres -t -c "
    SELECT 
      TO_CHAR(created_at, 'HH24:MI:SS') as time,
      RPAD(symbol, 10) as sym,
      CASE WHEN dir = 1 THEN 'BUY' ELSE 'SELL' END as direction,
      LPAD(ROUND(win_prob * 100)::text || '%', 5) as prob,
      order_ticket
    FROM ai_signals
    WHERE closed_at IS NULL
      AND order_ticket IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 3;
  " 2>/dev/null || echo "  アクティブポジションなし"
  
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "自動更新: 5秒ごと | Ctrl+C で終了"
  
  sleep 5
done
