#!/bin/bash

# ML学習結果を確認するスクリプト
# 学習されたパターンと推奨事項を表示します

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 ML学習結果の確認"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Supabase設定を読み込み
if [ -f "supabase/.env" ]; then
  source supabase/.env
elif [ -f ".env" ]; then
  source .env
fi

# 環境変数チェック
if [ -z "$SUPABASE_URL" ]; then
  echo "❌ SUPABASE_URL が設定されていません"
  exit 1
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "❌ SUPABASE_SERVICE_ROLE_KEY が設定されていません"
  exit 1
fi

# 1. 最新の学習履歴を取得
echo "📅 最新の学習履歴"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

TRAINING_HISTORY=$(curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/get_latest_training_summary" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json")

if [ -n "$TRAINING_HISTORY" ] && [ "$TRAINING_HISTORY" != "null" ]; then
  echo "$TRAINING_HISTORY" | jq -r '
    if type == "array" and length > 0 then
      .[] | 
      "実行日時: \(.executed_at // "N/A")",
      "完結トレード数: \(.complete_trades // 0)件",
      "発見パターン数: \(.patterns_discovered // 0)件",
      "全体勝率: \((.overall_win_rate // 0) * 100 | floor)%",
      "実行時間: \(.execution_time_ms // 0)ms"
    else
      "まだ学習履歴がありません"
    end
  ' 2>/dev/null || echo "まだ学習履歴がありません"
else
  echo "まだ学習履歴がありません"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎯 学習されたパターン（勝率順）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 2. 学習されたパターンを取得（勝率順）
PATTERNS=$(curl -s -X GET "${SUPABASE_URL}/rest/v1/ml_patterns?order=win_rate.desc&limit=10" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}")

if [ -n "$PATTERNS" ] && [ "$PATTERNS" != "[]" ]; then
  echo "$PATTERNS" | jq -r '
    if length > 0 then
      .[] | 
      "\n通貨ペア: \(.symbol)",
      "時間足: \(.timeframe)",
      "方向: \(.direction)",
      "RSI範囲: \(.rsi_range)",
      "勝率: \((.win_rate // 0) * 100 | floor)%",
      "サンプル数: \(.sample_count // 0)件",
      "信頼度: \((.confidence_score // 0) * 100 | floor)%",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    else
      "\nまだパターンが学習されていません"
    end
  '
else
  echo ""
  echo "まだパターンが学習されていません"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💡 推奨事項"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 3. 推奨事項を取得
RECOMMENDATIONS=$(curl -s -X GET "${SUPABASE_URL}/rest/v1/ml_recommendations?is_active=eq.true&order=created_at.desc&limit=5" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}")

if [ -n "$RECOMMENDATIONS" ] && [ "$RECOMMENDATIONS" != "[]" ]; then
  echo "$RECOMMENDATIONS" | jq -r '
    if length > 0 then
      .[] | 
      "\n推奨タイプ: \(.recommendation_type)",
      "内容: \(.recommendation_text)",
      "重要度: \(.priority // "medium")",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    else
      "\nまだ推奨事項がありません"
    end
  '
else
  echo ""
  echo "まだ推奨事項がありません"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📈 次のステップ"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ 学習は毎日 JST 12:00 に自動実行されます"
echo "✅ 手動実行: ./ml_training.sh train"
echo "✅ GitHubで確認: https://github.com/ippeitanaka/ai-trader-supabase/actions"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
