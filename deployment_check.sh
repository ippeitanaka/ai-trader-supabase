#!/bin/bash

# 本番環境デプロイ準備チェックスクリプト

echo "╔════════════════════════════════════════════════════════════╗"
echo "║                                                            ║"
echo "║   🔍 本番環境デプロイ - 準備チェック                      ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# カラー定義
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# チェック結果
CHECKS_PASSED=0
CHECKS_FAILED=0

check_item() {
  local description=$1
  local command=$2
  
  echo -n "  ⏳ $description ... "
  
  if eval "$command" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ OK${NC}"
    CHECKS_PASSED=$((CHECKS_PASSED + 1))
    return 0
  else
    echo -e "${RED}❌ NG${NC}"
    CHECKS_FAILED=$((CHECKS_FAILED + 1))
    return 1
  fi
}

echo -e "${BLUE}━━━ 1. ローカル環境チェック ━━━${NC}"
check_item "Supabase CLI インストール確認" "command -v supabase"
check_item "Deno インストール確認" "command -v deno"
check_item "Git インストール確認" "command -v git"
check_item "curl インストール確認" "command -v curl"
check_item "jq インストール確認" "command -v jq"
echo ""

echo -e "${BLUE}━━━ 2. プロジェクトファイル確認 ━━━${NC}"
check_item "Edge Functions存在確認" "test -d supabase/functions"
check_item "ai-trader関数確認" "test -f supabase/functions/ai-trader/index.ts"
check_item "ea-log関数確認" "test -f supabase/functions/ea-log/index.ts"
check_item "ai-signals関数確認" "test -f supabase/functions/ai-signals/index.ts"
check_item "マイグレーション確認" "test -d supabase/migrations"
check_item "deno.json確認" "test -f deno.json"
echo ""

echo -e "${BLUE}━━━ 3. 環境変数確認 ━━━${NC}"
check_item "OPENAI_API_KEY設定確認" "grep -q OPENAI_API_KEY supabase/.env.local"
check_item "OPENAI_MODEL設定確認" "grep -q OPENAI_MODEL supabase/.env.local"
echo ""

echo -e "${BLUE}━━━ 4. ローカルSupabase起動確認 ━━━${NC}"
check_item "Supabaseコンテナ起動中" "docker ps | grep -q supabase"
check_item "PostgreSQL起動中" "docker ps | grep -q supabase_db"
check_item "Edge Runtime起動中" "docker ps | grep -q supabase_edge_runtime"
echo ""

echo -e "${BLUE}━━━ 5. データベーステーブル確認 ━━━${NC}"
check_item "ea-log テーブル存在確認" "docker exec supabase_db_ai-trader-supabase psql -U postgres -tAc \"SELECT to_regclass('public.ea-log');\" | grep -q 'ea-log'"
check_item "ai_config テーブル存在確認" "docker exec supabase_db_ai-trader-supabase psql -U postgres -tAc \"SELECT to_regclass('public.ai_config');\" | grep -q 'ai_config'"
check_item "ai_signals テーブル存在確認" "docker exec supabase_db_ai-trader-supabase psql -U postgres -tAc \"SELECT to_regclass('public.ai_signals');\" | grep -q 'ai_signals'"
echo ""

echo -e "${BLUE}━━━ 6. ドキュメント確認 ━━━${NC}"
check_item "本番デプロイガイド" "test -f PRODUCTION_DEPLOYMENT.md"
check_item "GitHub Actionsガイド" "test -f GITHUB_ACTIONS_DEPLOY.md"
check_item "モニタリングガイド" "test -f MONITORING_GUIDE.md"
check_item "MT5統合ガイド" "test -f MT5_INTEGRATION_GUIDE.md"
echo ""

echo -e "${BLUE}━━━ 7. GitHub Actions設定確認 ━━━${NC}"
check_item "GitHub Workflowファイル" "test -f .github/workflows/deploy.yml"
echo ""

# サマリー
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
TOTAL_CHECKS=$((CHECKS_PASSED + CHECKS_FAILED))
echo -e "  総チェック数: $TOTAL_CHECKS"
echo -e "  ${GREEN}成功: $CHECKS_PASSED${NC}"
echo -e "  ${RED}失敗: $CHECKS_FAILED${NC}"
echo ""

if [ $CHECKS_FAILED -eq 0 ]; then
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}✅ すべてのチェックに合格しました！${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "${BLUE}📋 次のステップ:${NC}"
  echo ""
  echo "  方法A: GitHub Actionsで自動デプロイ（推奨）"
  echo "    1. GitHub Secretsを設定"
  echo "       - SUPABASE_ACCESS_TOKEN"
  echo "       - SUPABASE_PROJECT_REF"
  echo "       - OPENAI_API_KEY"
  echo "    2. コードをプッシュ"
  echo "       git add ."
  echo "       git commit -m \"Ready for production\""
  echo "       git push origin main"
  echo ""
  echo "  方法B: 手動デプロイ"
  echo "    1. Supabaseログイン"
  echo "       supabase login --token YOUR_TOKEN"
  echo "    2. プロジェクトリンク"
  echo "       supabase link --project-ref YOUR_PROJECT_REF"
  echo "    3. デプロイ実行"
  echo "       supabase db push"
  echo "       supabase functions deploy"
  echo ""
  echo -e "  詳細: ${YELLOW}PRODUCTION_DEPLOYMENT.md${NC} を参照"
  echo ""
else
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${RED}⚠️  $CHECKS_FAILED 件のチェックが失敗しました${NC}"
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "${YELLOW}失敗した項目を修正してから再実行してください。${NC}"
  echo ""
  echo "  Supabaseが起動していない場合:"
  echo "    supabase start"
  echo ""
  echo "  環境変数が設定されていない場合:"
  echo "    source load_env.sh"
  echo ""
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
