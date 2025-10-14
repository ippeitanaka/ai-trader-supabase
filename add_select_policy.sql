-- ea-log テーブルに SELECT 権限を追加（データ確認用）

CREATE POLICY "Allow anon select from ea-log" 
ON public."ea-log"
FOR SELECT 
TO anon
USING (true);

CREATE POLICY "Allow authenticated select from ea-log" 
ON public."ea-log"
FOR SELECT 
TO authenticated
USING (true);

-- ポリシー確認
SELECT policyname, roles, cmd
FROM pg_policies 
WHERE tablename = 'ea-log'
ORDER BY cmd, roles;
