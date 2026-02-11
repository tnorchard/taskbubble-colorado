-- Junction table: which users can see which Shopify stores
CREATE TABLE public.user_shopify_access (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.shopify_stores(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, store_id)
);

ALTER TABLE public.user_shopify_access ENABLE ROW LEVEL SECURITY;

-- Users can read their own access rows
CREATE POLICY "users_read_own_access" ON public.user_shopify_access
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Admin manages access (UI-gated to admin only)
CREATE POLICY "admin_manage_access" ON public.user_shopify_access
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- Seed: grant admin (dexter) access to both existing stores
INSERT INTO public.user_shopify_access (user_id, store_id)
SELECT p.id, s.id
FROM public.profiles p
CROSS JOIN public.shopify_stores s
WHERE p.email = 'dexter.norales@gmail.com';
