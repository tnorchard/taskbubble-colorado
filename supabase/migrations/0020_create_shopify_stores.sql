-- Shopify store credentials table (only readable by service role / edge functions)
CREATE TABLE public.shopify_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_handle text NOT NULL UNIQUE,          -- e.g. "sammydev"
  shop_domain text NOT NULL UNIQUE,          -- e.g. "sammydev.myshopify.com"
  display_name text NOT NULL,                -- friendly label shown in UI
  access_token text NOT NULL,                -- shpat_... token
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS but add NO user-facing policies.
-- Only the service_role key (used by edge functions) can read this table.
ALTER TABLE public.shopify_stores ENABLE ROW LEVEL SECURITY;

-- Public view that exposes ONLY safe columns for the frontend store picker
CREATE VIEW public.shopify_stores_public AS
  SELECT id, shop_handle, display_name, created_at
  FROM public.shopify_stores;

-- Grant select on the view to authenticated users
GRANT SELECT ON public.shopify_stores_public TO authenticated;

-- IMPORTANT:
-- Do NOT commit real Shopify access tokens to Git.
-- Seed stores in production manually (SQL editor), or via a secure admin flow.
--
-- Example (fill in your real tokens at runtime, not in this migration):
-- INSERT INTO public.shopify_stores (shop_handle, shop_domain, display_name, access_token) VALUES
--   ('sammydev', 'sammydev.myshopify.com', 'BTB', 'shpat_REPLACE_ME'),
--   ('eugene-ebikes', 'eugene-ebikes.myshopify.com', 'Eugene E-Bikes', 'shpat_REPLACE_ME');
