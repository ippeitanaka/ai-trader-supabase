#!/bin/bash

# OpenAI API テストスクリプト（環境変数を使用）
# GitHub Codespaces Secretsまたは環境変数からOPENAI_API_KEYを読み込みます

set -e

echo "🔧 OpenAI API接続テストの準備..."
echo ""

# 環境変数の確認
if [ -z "$OPENAI_API_KEY" ]; then
    echo "⚠️  OPENAI_API_KEY環境変数が設定されていません"
    echo ""
    echo "設定方法を選択してください:"
    echo ""
    echo "【推奨】GitHub Codespaces Secretsに設定する:"
    echo "  1. GitHubでリポジトリを開く"
    echo "  2. Settings > Secrets and variables > Codespaces"
    echo "  3. 'New repository secret' をクリック"
    echo "  4. Name: OPENAI_API_KEY"
    echo "  5. Value: あなたのOpenAI APIキー (sk-proj-...)"
    echo "  6. Codespacesを再起動"
    echo ""
    echo "【一時的】今すぐ環境変数として設定する:"
    echo "  export OPENAI_API_KEY='sk-proj-your-key-here'"
    echo "  ./run_openai_test.sh"
    echo ""
    exit 1
else
    KEY_PREFIX="${OPENAI_API_KEY:0:7}"
    KEY_SUFFIX="${OPENAI_API_KEY: -4}"
    echo "✅ OPENAI_API_KEY が設定されています: ${KEY_PREFIX}...${KEY_SUFFIX}"
fi

echo ""
echo "📡 テスト1: OpenAI API直接接続テスト"
echo "----------------------------------------"

RESPONSE=$(curl -s -w "\n%{http_code}" https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  --max-time 10)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ 接続成功！"
    
    # gpt-4o-miniの確認
    if echo "$BODY" | grep -q "gpt-4o-mini"; then
        echo "✅ gpt-4o-mini が利用可能"
    else
        echo "⚠️  gpt-4o-mini が見つかりません"
    fi
    
    # gpt-4oの確認
    if echo "$BODY" | grep -q '"id":"gpt-4o"'; then
        echo "✅ gpt-4o が利用可能"
    else
        echo "⚠️  gpt-4o が見つかりません"
    fi
else
    echo "❌ 接続失敗 (HTTP $HTTP_CODE)"
    echo "$BODY" | head -5
    exit 1
fi

echo ""
echo "💬 テスト2: 簡単なチャットテスト"
echo "----------------------------------------"

CHAT_RESPONSE=$(curl -s -w "\n%{http_code}" https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  --max-time 15 \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "あなたは金融アシスタントです。"},
      {"role": "user", "content": "テストです。「OK」とだけ返答してください。"}
    ],
    "max_tokens": 10,
    "temperature": 0
  }')

CHAT_HTTP_CODE=$(echo "$CHAT_RESPONSE" | tail -n1)
CHAT_BODY=$(echo "$CHAT_RESPONSE" | head -n-1)

if [ "$CHAT_HTTP_CODE" = "200" ]; then
    AI_RESPONSE=$(echo "$CHAT_BODY" | grep -o '"content":"[^"]*"' | head -1 | sed 's/"content":"//g' | sed 's/"$//')
    echo "✅ チャットAPI成功！"
    echo "   AIの応答: $AI_RESPONSE"
    
    TOKENS=$(echo "$CHAT_BODY" | grep -o '"total_tokens":[0-9]*' | grep -o '[0-9]*')
    echo "   使用トークン: $TOKENS"
else
    echo "❌ チャットAPI失敗 (HTTP $CHAT_HTTP_CODE)"
    echo "$CHAT_BODY" | head -5
    exit 1
fi

echo ""
echo "📊 テスト3: トレード分析テスト"
echo "----------------------------------------"

TRADE_RESPONSE=$(curl -s -w "\n%{http_code}" https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  --max-time 20 \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {
        "role": "system",
        "content": "あなたはトレードアナリストです。JSON形式で返答してください。"
      },
      {
        "role": "user",
        "content": "XAUUSD（金）の市場データ:\n価格: 2650.50, RSI: 65.5, EMA25: 2645.30, MACDヒストグラム: 2.5\n\nJSON形式で返答: {\"action\": \"BUY/SELL/HOLD\", \"win_prob\": 0.0-1.0, \"reasoning\": \"理由\"}"
      }
    ],
    "max_tokens": 200,
    "temperature": 0.3,
    "response_format": {"type": "json_object"}
  }')

TRADE_HTTP_CODE=$(echo "$TRADE_RESPONSE" | tail -n1)
TRADE_BODY=$(echo "$TRADE_RESPONSE" | head -n-1)

if [ "$TRADE_HTTP_CODE" = "200" ]; then
    echo "✅ トレード分析成功！"
    
    AI_ANALYSIS=$(echo "$TRADE_BODY" | grep -o '"content":"[^"]*"' | head -1 | sed 's/"content":"//g' | sed 's/"$//' | sed 's/\\n/ /g' | sed 's/\\//g')
    echo ""
    echo "AIの分析結果:"
    echo "$AI_ANALYSIS" | fold -w 80 -s | sed 's/^/  /'
    
    TOKENS=$(echo "$TRADE_BODY" | grep -o '"total_tokens":[0-9]*' | grep -o '[0-9]*')
    echo ""
    echo "使用トークン: $TOKENS"
else
    echo "❌ トレード分析失敗 (HTTP $TRADE_HTTP_CODE)"
    echo "$TRADE_BODY" | head -5
    exit 1
fi

echo ""
echo "=========================================="
echo "✅ すべてのテストが成功しました！"
echo "=========================================="
echo ""
echo "次のステップ:"
echo "  1. Edge Functionをテスト:"
echo "     supabase functions serve test-openai --env-file supabase/.env --no-verify-jwt"
echo ""
echo "  2. 別のターミナルでテストを実行:"
echo "     curl -X POST http://127.0.0.1:54321/functions/v1/test-openai \\"
echo "       -H \"Content-Type: application/json\" \\"
echo "       -d '{\"test_type\": \"connection\"}'"
echo ""
