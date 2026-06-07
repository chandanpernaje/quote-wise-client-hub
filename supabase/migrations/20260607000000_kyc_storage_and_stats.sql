-- KYC docs storage bucket (run once in Supabase dashboard if not auto-created)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('kyc-docs', 'kyc-docs', false) ON CONFLICT DO NOTHING;

-- Storage RLS: only admins can read/write KYC docs
-- DROP POLICY IF EXISTS "Admins read kyc docs" ON storage.objects;
-- CREATE POLICY "Admins read kyc docs" ON storage.objects FOR SELECT TO authenticated
--   USING (bucket_id = 'kyc-docs' AND public.has_role(auth.uid(), 'admin'));
-- CREATE POLICY "Admins insert kyc docs" ON storage.objects FOR INSERT TO authenticated
--   WITH CHECK (bucket_id = 'kyc-docs' AND public.has_role(auth.uid(), 'admin'));
-- CREATE POLICY "Admins delete kyc docs" ON storage.objects FOR DELETE TO authenticated
--   USING (bucket_id = 'kyc-docs' AND public.has_role(auth.uid(), 'admin'));

-- Add index for faster expiry-based queries
CREATE INDEX IF NOT EXISTS customers_created_by_idx ON public.customers(created_by);
