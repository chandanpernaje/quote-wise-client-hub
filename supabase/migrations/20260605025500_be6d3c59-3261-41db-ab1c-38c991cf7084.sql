
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;

-- Storage policies for kyc-docs bucket (admin only)
CREATE POLICY "Admins read kyc-docs"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'kyc-docs' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins upload kyc-docs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'kyc-docs' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update kyc-docs"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'kyc-docs' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete kyc-docs"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'kyc-docs' AND public.has_role(auth.uid(), 'admin'));
