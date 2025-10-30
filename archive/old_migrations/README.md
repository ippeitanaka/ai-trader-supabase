# 古いマイグレーションファイル（アーカイブ）

このディレクトリには、本番環境で既に適用済みまたは統合済みのマイグレーションファイルが保管されています。

## アーカイブ日: 2025-10-30

## アーカイブされたファイルとその理由

### ai_config テーブル関連（削除済み）
- `20250102_001_create_ai_config_table.sql` - ai_configテーブルの作成（後に削除）
- `20250106_001_expand_ai_config_full_params.sql` - ai_config拡張（後に削除）
- `20251028_001_drop_ai_config_table.sql` - ai_configテーブルの削除実行

**理由**: ai_configテーブルは使用されなくなり、全設定をEA入力パラメータで管理するため削除。

### ai_signals テーブル関連（統合済み）
- `20250104_001_enhance_ai_signals_table.sql` - ML学習用カラム追加
- `20250108_001_optimize_ai_signals_table.sql` - インデックス最適化
- `20250110_001_expand_ai_signals_technical_data.sql` - テクニカル指標追加
- `20251020_001_add_entry_method_columns.sql` - エントリー手法カラム追加
- `20251022_001_ensure_entry_method_columns.sql` - エントリー手法カラム確認
- `20251029_001_complete_ai_signals_schema.sql` - 完全スキーマ定義（参照用）

**理由**: これらの変更は全て `20251029_002_optimize_ai_signals_columns.sql` に統合済み。

### ea_log テーブル関連（統合済み）
- `20250105_001_enhance_ea_log_table.sql` - ea_logテーブルの拡張
- `20250107_001_simplify_ea_log_table.sql` - ea_logテーブルの簡素化

**理由**: ea_logの最終形は `20250101_001_create_ea_log_table.sql` で定義済み。

## 現在アクティブなマイグレーション

本番環境で有効なマイグレーションファイル（`supabase/migrations/`）:

1. `20250101_001_create_ea_log_table.sql` - ea_logテーブル作成
2. `20250103_001_create_ai_signals_table.sql` - ai_signalsテーブル作成
3. `20250109_001_fix_rls_security_warnings.sql` - RLSセキュリティ修正
4. `20250111_001_create_ml_learning_tables.sql` - ML学習テーブル作成
5. `20250112_001_setup_ml_training_cron.sql` - ML学習cronジョブ設定
6. `20251019_001_remove_unused_views.sql` - 未使用ビュー削除
7. `20251026_001_fix_ml_cron_config.sql` - ML cron設定修正
8. `20251028_002_add_ml_pattern_tracking.sql` - MLパターン追跡機能追加
9. `20251029_002_optimize_ai_signals_columns.sql` - ai_signalsテーブル最適化（最新）

## 注意事項

⚠️ **これらのファイルは削除しないでください**
- 開発履歴の参照用
- トラブルシューティング時の参考資料
- 新しいマイグレーション作成時の参考

⚠️ **本番環境への影響**
- アーカイブされたマイグレーションは既に本番環境で適用済み
- これらのファイルを削除しても本番環境には影響なし
- 新規環境構築時は、アクティブなマイグレーションのみ実行すれば十分

## マイグレーション整理の効果

**整理前**: 20ファイル  
**整理後**: 9ファイル（11ファイルをアーカイブ）  
**削減率**: 55%

これにより、マイグレーションの見通しが良くなり、新しい開発者がシステムを理解しやすくなりました。
