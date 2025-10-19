#!/bin/bash

# GitHub Secrets設定ヘルパースクリプト

echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║                                                                    ║"
echo "║   🔐 GitHub Secrets 設定ヘルパー                                 ║"
echo "║                                                                    ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""

# カラー定義
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━ 必要なSecrets情報 ━━━${NC}"
echo ""

# OPENAI_API_KEY確認
echo -e "${YELLOW}1. OPENAI_API_KEY${NC}"
if [ -f "/workspaces/.codespaces/shared/.env-secrets" ]; then
    API_KEY=$(grep OPENAI_API_KEY /workspaces/.codespaces/shared/.env-secrets | cut -d= -f2 | base64 -d 2>/dev/null)
    if [ -n "$API_KEY" ]; then
        echo -e "   ✅ 検出: ${API_KEY:0:20}...${API_KEY: -4}"
        echo -e "   ${GREEN}完全なキー:${NC}"
        echo "   $API_KEY"
    else
        echo -e "   ${RED}❌ 検出できませんでした${NC}"
    fi
else
    echo -e "   ${RED}❌ Codespaces Secretsファイルが見つかりません${NC}"
fi
echo ""

# Supabase情報確認
echo -e "${YELLOW}2. SUPABASE_ACCESS_TOKEN${NC}"
echo "   📍 取得先: https://supabase.com/dashboard/account/tokens"
echo "   形式: sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
echo ""

echo -e "${YELLOW}3. SUPABASE_PROJECT_REF${NC}"
echo "   📍 取得先: https://supabase.com/dashboard/project/_/settings/general"
echo "   形式: 16文字の英数字 (例: abcdefghijklmnop)"
echo ""

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}📋 GitHub Secrets設定ページ:${NC}"
echo "   👉 https://github.com/ippeitanaka/ai-trader-supabase/settings/secrets/actions"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "🔧 設定手順:"
echo ""
echo "1. 上記のGitHub Secrets設定ページを開く"
echo "2. 'New repository secret' をクリック"
echo "3. 各Secretを以下の形式で入力:"
echo ""
echo "   Name: OPENAI_API_KEY"
echo "   Value: (上記で表示されたキーをコピー&ペースト)"
echo ""
echo "   Name: SUPABASE_ACCESS_TOKEN"
echo "   Value: (Supabaseから取得したトークン)"
echo ""
echo "   Name: SUPABASE_PROJECT_REF"
echo "   Value: (SupabaseプロジェクトID)"
echo ""
echo "4. 'Add secret' をクリック"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

