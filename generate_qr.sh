#!/bin/bash
# QRコード生成スクリプト（スマホでの確認を簡単にするため）

DIAGNOSTIC_URL="https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader"
DASHBOARD_URL="https://supabase.com/dashboard/project/nebphrnnpmuqbkymwefs/functions/ai-trader/logs"

echo "📱 スマホ用 QRコード生成"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# qrencode がインストールされているか確認
if command -v qrencode &> /dev/null; then
    echo "🔍 診断エンドポイント（ヘルスチェック）:"
    echo "$DIAGNOSTIC_URL"
    echo ""
    qrencode -t ANSIUTF8 "$DIAGNOSTIC_URL"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "📊 Supabase Dashboard（ログ確認）:"
    echo "$DASHBOARD_URL"
    echo ""
    qrencode -t ANSIUTF8 "$DASHBOARD_URL"
    echo ""
else
    echo "⚠️  qrencode がインストールされていません"
    echo ""
    echo "インストール方法:"
    echo "  Ubuntu/Debian: sudo apt-get install qrencode"
    echo "  macOS: brew install qrencode"
    echo ""
    echo "または、以下のオンラインサービスでQRコードを生成してください:"
    echo "  https://www.qr-code-generator.com/"
    echo ""
    echo "📋 URL:"
    echo "  診断: $DIAGNOSTIC_URL"
    echo "  ログ: $DASHBOARD_URL"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💡 ヒント:"
echo "  1. スマホのカメラでQRコードを読み取る"
echo "  2. 開いたページをブックマークまたはホーム画面に追加"
echo "  3. 毎朝ワンタップでヘルスチェック！"
