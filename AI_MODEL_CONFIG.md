# AIモデル設定のクイックガイド

## 現在の設定

✅ **推奨設定（デフォルト）**: `gpt-4o-mini`

## モデルを変更する方法

### 方法1: 環境変数ファイルで設定（推奨）

`supabase/.env.local`を編集:

```bash
# gpt-4o-mini（デフォルト・推奨）
OPENAI_MODEL=gpt-4o-mini

# または gpt-4o（高精度・高コスト）
# OPENAI_MODEL=gpt-4o
```

Edge Functionを再起動:
```bash
pkill -f "supabase functions serve"
supabase functions serve ai-trader --env-file supabase/.env.local --no-verify-jwt
```

### 方法2: 一時的に環境変数で設定

```bash
export OPENAI_MODEL=gpt-4o
supabase functions serve ai-trader --env-file supabase/.env.local --no-verify-jwt
```

## モデル比較

| モデル | コスト | 速度 | 精度 | 推奨 |
|--------|--------|------|------|------|
| **gpt-4o-mini** | ★★★★★ | ★★★ | ★★★ | ✅ 推奨 |
| gpt-4o | ★☆☆☆☆ | ★★ | ★★★★ | 高精度が必要な場合のみ |

### コスト比較（1,000リクエスト/月）

- **gpt-4o-mini**: 約10円/月
- **gpt-4o**: 約160円/月 (16倍)

## テスト結果

### gpt-4o-mini の実績

```json
{
  "win_prob": 0.85,
  "action": 1,
  "confidence": "high",
  "reasoning": "強い一目均衡表と高RSI"
}
```

✅ 十分な精度で判断できています

## 推奨事項

1. **まずは gpt-4o-mini で開始** ✅
2. 3ヶ月間データを収集
3. パフォーマンスを評価
4. 必要に応じて gpt-4o に変更

## 詳細ガイド

より詳しい情報は以下を参照:
- `AI_MODEL_SELECTION_GUIDE.md` - 完全な比較とガイド
- `OPENAI_TEST_REPORT.md` - テスト結果レポート

## トラブルシューティング

### モデル変更が反映されない

1. Edge Functionを停止
   ```bash
   pkill -f "supabase functions serve"
   ```

2. 環境変数を確認
   ```bash
   cat supabase/.env.local | grep OPENAI_MODEL
   ```

3. 再起動
   ```bash
   supabase functions serve ai-trader --env-file supabase/.env.local --no-verify-jwt
   ```

### エラー: "model not found"

使用可能なモデル:
- `gpt-4o-mini` ✅
- `gpt-4o` ✅
- `gpt-4-turbo`
- `gpt-3.5-turbo`

スペルミスがないか確認してください。
