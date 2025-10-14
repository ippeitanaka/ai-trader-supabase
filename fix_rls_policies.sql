-- Row Level Security (RLS) ポリシーを追加
-- ea-log テーブルへの書き込み権限を anon ロールに付与

-- すべてのユーザーに INSERT 権限を付与（EA からのログ記録用）
CREATE POLICY "Allow public insert to ea-log" 
ON public."ea-log"
FOR INSERT 
TO public
WITH CHECK (true);

-- anon ロールに明示的に INSERT 権限を付与
CREATE POLICY "Allow anon insert to ea-log" 
ON public."ea-log"
FOR INSERT 
TO anon
WITH CHECK (true);

-- authenticated ロールにも INSERT 権限を付与
CREATE POLICY "Allow authenticated insert to ea-log" 
ON public."ea-log"
FOR INSERT 
TO authenticated
WITH CHECK (true);

-- service_role にはすべての操作を許可（管理用）
CREATE POLICY "Allow service role full access to ea-log" 
ON public."ea-log"
FOR ALL 
TO service_role
USING (true)
WITH CHECK (true);

-- 既存のポリシーを確認
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'ea-log'
ORDER BY policyname;
