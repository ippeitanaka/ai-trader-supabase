#!/bin/bash

# ML Training Manual Execution Script
# このスクリプトは手動でMLトレーニングを実行します

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🤖 AI Trader ML Training"
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
  echo "   supabase/.env または .env ファイルに設定してください"
  exit 1
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "❌ SUPABASE_SERVICE_ROLE_KEY が設定されていません"
  echo "   supabase/.env または .env ファイルに設定してください"
  exit 1
fi

FUNCTION_URL="${SUPABASE_URL}/functions/v1/ml-training"

echo "📡 接続先: ${FUNCTION_URL}"
echo ""

# オプション解析
MODE="check"
if [ "$1" == "train" ] || [ "$1" == "run" ]; then
  MODE="train"
fi

if [ "$MODE" == "check" ]; then
  echo "📊 現在の学習状況を確認中..."
  echo ""
  
  RESPONSE=$(curl -s -X GET "$FUNCTION_URL" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json")
  
  echo "$RESPONSE" | jq '.'
  
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "💡 学習を実行するには:"
  echo "   ./ml_training.sh train"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
else
  echo "🚀 MLトレーニングを開始します..."
  echo ""
  
  START_TIME=$(date +%s)
  
  RESPONSE=$(curl -s -X POST "$FUNCTION_URL" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"triggered_by": "manual"}')
  
  END_TIME=$(date +%s)
  DURATION=$((END_TIME - START_TIME))
  
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📊 学習結果"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  echo "$RESPONSE" | jq '.'
  
  # ステータス確認
  STATUS=$(echo "$RESPONSE" | jq -r '.status')
  
  if [ "$STATUS" == "completed" ]; then
    echo ""
    echo "✅ 学習が正常に完了しました！"
    
    # サマリー表示
    COMPLETE_TRADES=$(echo "$RESPONSE" | jq -r '.complete_trades')
    PATTERNS_DISCOVERED=$(echo "$RESPONSE" | jq -r '.patterns_discovered')
    PATTERNS_UPDATED=$(echo "$RESPONSE" | jq -r '.patterns_updated')
    OVERALL_WIN_RATE=$(echo "$RESPONSE" | jq -r '.overall_win_rate')
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📈 サマリー"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "完結したトレード: ${COMPLETE_TRADES}件"
    echo "発見されたパターン: ${PATTERNS_DISCOVERED}件"
    echo "更新されたパターン: ${PATTERNS_UPDATED}件"
    echo "全体勝率: $(echo "$OVERALL_WIN_RATE * 100" | bc -l | xargs printf "%.1f")%"
    echo "実行時間: ${DURATION}秒"
    
  elif [ "$STATUS" == "insufficient_data" ]; then
    echo ""
    echo "⚠️  データが不足しています"
    echo "   完結したトレードが5件以上必要です"
    
    COMPLETE_TRADES=$(echo "$RESPONSE" | jq -r '.complete_trades')
    echo "   現在: ${COMPLETE_TRADES}件"
    
  else
    echo ""
    echo "❌ 学習に失敗しました"
    ERROR_MSG=$(echo "$RESPONSE" | jq -r '.message // .error')
    echo "   エラー: $ERROR_MSG"
  fi
  
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi

echo ""
echo "📚 詳細は ML_LEARNING_GUIDE.md を参照してください"
echo ""
