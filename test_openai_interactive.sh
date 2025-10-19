#!/bin/bash

echo "=================================="
echo "OpenAI API接続テストスクリプト"
echo "=================================="
echo ""

# カラー定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# APIキーの確認
echo -e "${BLUE}ステップ1: 環境変数の確認${NC}"
if [ -z "$OPENAI_API_KEY" ]; then
    echo -e "${YELLOW}⚠️  OPENAI_API_KEY環境変数が設定されていません${NC}"
    echo ""
    echo "APIキーを設定するには、以下のいずれかの方法を使用してください:"
    echo ""
    echo "【方法1】コマンドラインで一時的に設定:"
    echo "  export OPENAI_API_KEY='sk-proj-your-key-here'"
    echo ""
    echo "【方法2】.env.localファイルに保存:"
    echo "  echo 'OPENAI_API_KEY=sk-proj-your-key-here' >> .env.local"
    echo "  source .env.local"
    echo ""
    echo "【方法3】GitHub Codespacesシークレットに設定:"
    echo "  1. リポジトリの Settings → Secrets and variables → Codespaces"
    echo "  2. 'New repository secret' をクリック"
    echo "  3. Name: OPENAI_API_KEY"
    echo "  4. Value: あなたのAPIキー"
    echo "  5. Codespacesを再起動"
    echo ""
    read -p "今すぐAPIキーを入力しますか? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo ""
        read -sp "OpenAI APIキーを入力してください: " OPENAI_API_KEY
        echo ""
        export OPENAI_API_KEY
        echo -e "${GREEN}✅ APIキーが設定されました${NC}"
    else
        echo ""
        echo -e "${RED}❌ APIキーが設定されていないため、テストを終了します${NC}"
        exit 1
    fi
else
    KEY_LENGTH=${#OPENAI_API_KEY}
    MASKED_KEY="${OPENAI_API_KEY:0:7}...${OPENAI_API_KEY: -4}"
    echo -e "${GREEN}✅ OPENAI_API_KEY が設定されています${NC}"
    echo "   キー: $MASKED_KEY (長さ: $KEY_LENGTH 文字)"
fi

echo ""
echo -e "${BLUE}ステップ2: OpenAI API接続テスト${NC}"
echo "APIに接続中..."

RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "https://api.openai.com/v1/models" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  --max-time 10)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ 接続成功！${NC}"
    echo ""
    
    # 利用可能なGPTモデルを抽出
    GPT_MODELS=$(echo "$BODY" | grep -o '"id":"gpt-[^"]*"' | sed 's/"id":"//g' | sed 's/"//g' | sort -u)
    
    echo "利用可能なGPTモデル:"
    echo "$GPT_MODELS" | head -15 | sed 's/^/  - /'
    
    echo ""
    if echo "$GPT_MODELS" | grep -q "gpt-4o-mini"; then
        echo -e "${GREEN}✅ gpt-4o-mini が利用可能${NC}"
    else
        echo -e "${YELLOW}⚠️  gpt-4o-mini が見つかりません${NC}"
    fi
    
    if echo "$GPT_MODELS" | grep -q "^gpt-4o$"; then
        echo -e "${GREEN}✅ gpt-4o が利用可能${NC}"
    else
        echo -e "${YELLOW}⚠️  gpt-4o が見つかりません${NC}"
    fi
    
else
    echo -e "${RED}❌ 接続失敗${NC}"
    echo "HTTPステータスコード: $HTTP_CODE"
    echo ""
    echo "エラー詳細:"
    echo "$BODY" | head -10
    
    if [ "$HTTP_CODE" = "401" ]; then
        echo ""
        echo -e "${YELLOW}💡 ヒント: APIキーが無効です。正しいキーを確認してください。${NC}"
    elif [ "$HTTP_CODE" = "429" ]; then
        echo ""
        echo -e "${YELLOW}💡 ヒント: レート制限に達しました。少し待ってから再試行してください。${NC}"
    fi
    
    exit 1
fi

echo ""
echo -e "${BLUE}ステップ3: チャットAPI機能テスト${NC}"
echo "簡単なメッセージを送信中..."

CHAT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "https://api.openai.com/v1/chat/completions" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  --max-time 15 \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {
        "role": "system",
        "content": "あなたは金融取引のアシスタントです。"
      },
      {
        "role": "user",
        "content": "このメッセージはテストです。「接続成功」とだけ返答してください。"
      }
    ],
    "max_tokens": 20,
    "temperature": 0
  }')

CHAT_HTTP_CODE=$(echo "$CHAT_RESPONSE" | tail -n1)
CHAT_BODY=$(echo "$CHAT_RESPONSE" | head -n-1)

if [ "$CHAT_HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ チャットAPI接続成功！${NC}"
    echo ""
    
    AI_MESSAGE=$(echo "$CHAT_BODY" | grep -o '"content":"[^"]*"' | head -1 | sed 's/"content":"//g' | sed 's/"$//g')
    echo "AIの応答: $AI_MESSAGE"
    
    PROMPT_TOKENS=$(echo "$CHAT_BODY" | grep -o '"prompt_tokens":[0-9]*' | grep -o '[0-9]*')
    COMPLETION_TOKENS=$(echo "$CHAT_BODY" | grep -o '"completion_tokens":[0-9]*' | grep -o '[0-9]*')
    TOTAL_TOKENS=$(echo "$CHAT_BODY" | grep -o '"total_tokens":[0-9]*' | grep -o '[0-9]*')
    
    echo ""
    echo "トークン使用量:"
    echo "  - プロンプト: $PROMPT_TOKENS トークン"
    echo "  - 完了: $COMPLETION_TOKENS トークン"
    echo "  - 合計: $TOTAL_TOKENS トークン"
    
else
    echo -e "${RED}❌ チャットAPI接続失敗${NC}"
    echo "HTTPステータスコード: $CHAT_HTTP_CODE"
    echo ""
    echo "エラー詳細:"
    echo "$CHAT_BODY" | head -10
    exit 1
fi

echo ""
echo -e "${BLUE}ステップ4: トレード分析テスト${NC}"
echo "サンプル市場データを分析中..."

TRADE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "https://api.openai.com/v1/chat/completions" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  --max-time 20 \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {
        "role": "system",
        "content": "あなたは経験豊富なトレードアナリストです。テクニカル分析に基づいて判断してください。必ずJSON形式で返答してください。"
      },
      {
        "role": "user",
        "content": "以下の市場データを分析し、BUY/SELL/HOLDの判断と勝率（0.0-1.0）を提供してください。\n\n銘柄: XAUUSD（金）\n現在価格: 2650.50\nRSI: 65.5\nATR: 15.2\nEMA25: 2645.30\nSMA100: 2640.10\nMACDヒストグラム: 2.5\n\n以下のJSON形式で返答してください:\n{\n  \"action\": \"BUY\" | \"SELL\" | \"HOLD\",\n  \"win_prob\": 0.0-1.0,\n  \"reasoning\": \"判断理由（日本語、100文字以内）\"\n}"
      }
    ],
    "max_tokens": 300,
    "temperature": 0.3,
    "response_format": { "type": "json_object" }
  }')

TRADE_HTTP_CODE=$(echo "$TRADE_RESPONSE" | tail -n1)
TRADE_BODY=$(echo "$TRADE_RESPONSE" | head -n-1)

if [ "$TRADE_HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ トレード分析成功！${NC}"
    echo ""
    
    AI_ANALYSIS=$(echo "$TRADE_BODY" | grep -o '"content":"[^"]*"' | head -1 | sed 's/"content":"//g' | sed 's/"$//g' | sed 's/\\n/ /g' | sed 's/\\//g')
    echo "AIの分析結果:"
    echo "$AI_ANALYSIS" | sed 's/^/  /'
    
    TOTAL_TOKENS=$(echo "$TRADE_BODY" | grep -o '"total_tokens":[0-9]*' | grep -o '[0-9]*')
    echo ""
    echo "トークン使用量: $TOTAL_TOKENS トークン"
    
else
    echo -e "${RED}❌ トレード分析失敗${NC}"
    echo "HTTPステータスコード: $TRADE_HTTP_CODE"
    echo ""
    echo "エラー詳細:"
    echo "$TRADE_BODY" | head -10
    exit 1
fi

echo ""
echo "=================================="
echo -e "${GREEN}✅ すべてのテストが正常に完了しました！${NC}"
echo "=================================="
echo ""
echo "次のステップ:"
echo "  1. Edge Functionのテスト: supabase functions serve test-openai"
echo "  2. ai-trader Functionのテスト"
echo "  3. MT5 EAとの統合テスト"
echo ""
