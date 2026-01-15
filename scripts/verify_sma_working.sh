#!/bin/bash

# ===================================================================
# SMA200/800 動作確認スクリプト
# 最新のea_logエントリーを確認してSMA200/800が機能しているか検証
# ===================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 SMA200/800 動作確認"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Supabase設定
PROJECT_URL="https://nebphrnnpmuqbkymwefs.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lYnBocm5ucG11cWJreW13ZWZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzUxMDg5NDUsImV4cCI6MjA1MDY4NDk0NX0.Mxvf9lTiMSy4jJQVMmeCLdBb8i1QdSUWHHJNJsgFzgc"

echo "📊 最新のea_logエントリー（最新5件）:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

RESPONSE=$(curl -s -X GET \
  "${PROJECT_URL}/rest/v1/ea-log?select=at,sym,action,win_prob,ai_reasoning,trade_decision,order_ticket&order=at.desc&limit=5" \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${ANON_KEY}")

echo "$RESPONSE" | jq -r '.[] | "
📅 時刻: \(.at)
💱 銘柄: \(.sym)
📈 判定: \(.action)
🎯 勝率: \(.win_prob)
🧾 実行: \(.trade_decision)
🎫 Ticket: \(.order_ticket)
💬 理由: \(.ai_reasoning)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"'

echo ""
echo "🔎 SMA200/800関連のキーワードをチェック:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# キーワード検索
KEYWORDS=("パーフェクトオーダー" "200日線" "800日線" "長期トレンド" "長期上昇" "長期下降")

for keyword in "${KEYWORDS[@]}"; do
  count=$(echo "$RESPONSE" | jq -r --arg kw "$keyword" '[.[] | select(.ai_reasoning | contains($kw))] | length')
  if [ "$count" -gt 0 ]; then
    echo "✅ 「${keyword}」: ${count}件 検出"
  else
    echo "⚪ 「${keyword}」: 0件"
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 確認方法:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. 上記のreasoningに「パーフェクトオーダー」「200日線」などが"
echo "   含まれていれば、SMA200/800が正しく機能しています！"
echo ""
echo "2. まだ新しいシグナルが発生していない場合:"
echo "   → 次のM15足（15分ごと）まで待ってから再実行してください"
echo ""
echo "3. リアルタイム監視:"
echo "   watch -n 60 ./verify_sma_working.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
