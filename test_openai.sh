#!/bin/bash

# OpenAI API接続テストスクリプト

echo "🔍 OpenAI API接続テストを開始します..."
echo ""

# 環境変数の確認
if [ -z "$OPENAI_API_KEY" ]; then
    echo "❌ エラー: OPENAI_API_KEY環境変数が設定されていません"
    echo ""
    echo "設定方法:"
    echo "  export OPENAI_API_KEY='your-api-key-here'"
    echo ""
    echo "または、GitHub Secretsに設定している場合は、コードスペースのシークレットとして追加してください。"
    exit 1
fi

echo "✅ OPENAI_API_KEY が設定されています (${#OPENAI_API_KEY} 文字)"
echo ""

# APIキーの検証テスト
echo "📡 OpenAI APIに接続中..."
RESPONSE=$(curl -s -w "\n%{http_code}" https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo ""
if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ 接続成功！"
    echo ""
    echo "利用可能なモデル（一部）:"
    echo "$BODY" | grep -o '"id":"[^"]*"' | head -10 | sed 's/"id":"/ - /' | sed 's/"$//'
    echo ""
    
    # gpt-4o-miniが利用可能か確認
    if echo "$BODY" | grep -q "gpt-4o-mini"; then
        echo "✅ gpt-4o-mini が利用可能です"
    else
        echo "⚠️  gpt-4o-mini が見つかりませんでした"
    fi
    
    # gpt-4oが利用可能か確認
    if echo "$BODY" | grep -q '"id":"gpt-4o"'; then
        echo "✅ gpt-4o が利用可能です"
    else
        echo "⚠️  gpt-4o が見つかりませんでした"
    fi
    
else
    echo "❌ 接続失敗"
    echo "HTTPステータスコード: $HTTP_CODE"
    echo ""
    echo "エラー詳細:"
    echo "$BODY" | head -20
    exit 1
fi

echo ""
echo "🧪 簡単なチャットテストを実行します..."

CHAT_RESPONSE=$(curl -s -w "\n%{http_code}" https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {
        "role": "system",
        "content": "あなたは金融取引のアシスタントです。"
      },
      {
        "role": "user",
        "content": "こんにちは。簡単なテストです。'OK'とだけ返答してください。"
      }
    ],
    "max_tokens": 10,
    "temperature": 0
  }')

CHAT_HTTP_CODE=$(echo "$CHAT_RESPONSE" | tail -n1)
CHAT_BODY=$(echo "$CHAT_RESPONSE" | head -n-1)

echo ""
if [ "$CHAT_HTTP_CODE" = "200" ]; then
    echo "✅ チャットAPI接続成功！"
    echo ""
    echo "AIの応答:"
    echo "$CHAT_BODY" | grep -o '"content":"[^"]*"' | head -1 | sed 's/"content":"//' | sed 's/"$//'
    echo ""
    echo "✅ すべてのテストが正常に完了しました！"
else
    echo "❌ チャットAPI接続失敗"
    echo "HTTPステータスコード: $CHAT_HTTP_CODE"
    echo ""
    echo "エラー詳細:"
    echo "$CHAT_BODY"
    exit 1
fi

echo ""
echo "📊 使用統計:"
echo "$CHAT_BODY" | grep -o '"usage":{[^}]*}' | sed 's/[,{}]/ /g'
