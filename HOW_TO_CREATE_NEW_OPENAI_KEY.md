# OpenAI APIキーの再作成ガイド

## 問題: 既存のAPIキーが見られない

OpenAI APIキーは作成時に一度だけ表示され、その後は確認できません。
紛失した場合は、**新しいキーを作成する**必要があります。

## 解決方法: 新しいAPIキーを作成

### ステップ1: OpenAIプラットフォームにログイン

1. ブラウザで以下のURLを開く:
   ```
   https://platform.openai.com/
   ```

2. アカウントにログイン

### ステップ2: 新しいAPIキーを作成

1. **左メニューから「API keys」をクリック**
   - または直接: https://platform.openai.com/api-keys

2. **右上の「+ Create new secret key」ボタンをクリック**

3. **キーに名前を付ける（任意）**
   - 例: "AI Trader Supabase - Codespaces"
   - 例: "Development Key"

4. **「Create secret key」をクリック**

5. **⚠️ 重要: キーをコピー**
   - `sk-proj-...` で始まる長い文字列が表示されます
   - **今すぐコピーしてください！** 二度と表示されません
   - 安全な場所に保存（パスワードマネージャーなど）

6. **「Done」をクリック**

### ステップ3: 古いキーを削除（オプションだが推奨）

セキュリティのため、使わなくなったキーは削除しましょう：

1. API keysページで古いキーを見つける
2. 右側の「...」メニューをクリック
3. 「Revoke key」を選択
4. 確認

### ステップ4: 新しいキーをCodespacesに設定

#### 方法A: GitHub Codespaces Secret（推奨）

1. **このリポジトリのGitHubページを開く**
   ```
   https://github.com/ippeitanaka/ai-trader-supabase
   ```

2. **Settings > Secrets and variables > Codespaces**

3. **既存の `OPENAI_API_KEY` がある場合:**
   - 右側の「Update」をクリック
   - 新しいキーを貼り付け
   - 「Save changes」をクリック

4. **新規作成の場合:**
   - 「New repository secret」をクリック
   - Name: `OPENAI_API_KEY`
   - Value: 新しいキーを貼り付け
   - 「Add secret」をクリック

5. **Codespacesを再起動**
   - VSCode左下の「Codespaces」をクリック
   - 「Stop Current Codespace」を選択
   - 再度Codespaceを開く

6. **確認**
   ```bash
   env | grep OPENAI_API_KEY
   ```

#### 方法B: 一時的に環境変数として設定（即座にテスト）

Codespacesを再起動せずにすぐテストしたい場合:

```bash
# ターミナルで実行
export OPENAI_API_KEY='sk-proj-新しいキーをここに貼り付け'

# 確認
echo "APIキーの最初と最後: ${OPENAI_API_KEY:0:7}...${OPENAI_API_KEY: -4}"

# テスト実行
./run_openai_test.sh
```

**注意:** この方法はターミナルセッションのみ有効です。

## ステップ5: テストを実行

```bash
# 簡易テスト
./run_openai_test.sh

# Edge Functionテスト
supabase functions serve test-openai --no-verify-jwt
```

## 💡 ベストプラクティス

### セキュリティ

✅ **推奨:**
- APIキーはパスワードマネージャーに保存
- GitHub Secretsを使用
- 使わないキーは削除
- 定期的にキーをローテーション

❌ **避けるべき:**
- キーをコードに直接記述
- キーをGitにコミット
- キーをSlackやEmailで共有
- キーをスクリーンショットで保存

### キー管理のヒント

1. **複数のキーを作成**
   - 開発用: "Development Key"
   - テスト用: "Testing Key"  
   - 本番用: "Production Key"
   - それぞれ別のキーを使用すると管理が楽

2. **使用量の監視**
   - OpenAIダッシュボードで使用量を確認
   - https://platform.openai.com/usage

3. **予算制限の設定**
   - Settings > Billing > Usage limits
   - 月額制限を設定して予期しない課金を防ぐ

## トラブルシューティング

### Q: 新しいキーを作成できない

**A:** 以下を確認:
- OpenAIアカウントが有効か
- 支払い方法が登録されているか
- API利用が有効になっているか

### Q: Codespaces Secretが反映されない

**A:** 
1. Secretが正しく保存されているか確認
2. Codespacesを完全に再起動
3. それでもダメなら、一時的に環境変数として設定してテスト

### Q: APIキーが動作しない（401エラー）

**A:**
1. キーが正しくコピーされているか確認（余計な空白など）
2. キーが有効か確認（削除されていないか）
3. OpenAIアカウントに支払い方法が登録されているか確認

## 📞 サポート

OpenAI APIに関する問題:
- ヘルプセンター: https://help.openai.com/
- コミュニティフォーラム: https://community.openai.com/

---

**準備が整ったら、テストを実行してください！**

```bash
./run_openai_test.sh
```
