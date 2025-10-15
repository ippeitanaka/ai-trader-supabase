#!/bin/bash
# AI Trader 健康チェックスクリプト
# 使い方: ./health_check.sh

FUNCTION_URL="https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader"

echo "🔍 AI Trader 健康チェック実行中..."
echo ""

# 診断エンドポイントを呼び出し
RESPONSE=$(curl -s $FUNCTION_URL)

# ai_enabled をチェック
AI_ENABLED=$(echo $RESPONSE | grep -o '"ai_enabled":[^,]*' | cut -d':' -f2)
KEY_STATUS=$(echo $RESPONSE | grep -o '"openai_key_status":"[^"]*"' | cut -d'"' -f4)

echo "📊 診断結果:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo $RESPONSE | python3 -m json.tool 2>/dev/null || echo $RESPONSE
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 判定
if echo "$AI_ENABLED" | grep -q "true"; then
    echo "✅ ステータス: 正常"
    echo "   OpenAI API が有効です"
    echo "   API Key: $KEY_STATUS"
    exit 0
else
    echo "❌ ステータス: 異常"
    echo "   OpenAI API が無効です！"
    echo "   API Key: $KEY_STATUS"
    echo ""
    echo "⚠️  対処方法:"
    echo "   1. OPENAI_API_KEY を設定: supabase secrets set OPENAI_API_KEY=sk-..."
    echo "   2. 再デプロイ: supabase functions deploy ai-trader"
    echo "   3. 詳細: OPENAI_TROUBLESHOOTING.md を参照"
    exit 1
fi
