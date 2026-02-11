-- Add shopify_access flag to profiles (default false, only admin can grant)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS shopify_access boolean NOT NULL DEFAULT false;

-- Grant shopify access to the admin user
UPDATE public.profiles
SET shopify_access = true
WHERE email = 'dexter.norales@gmail.com';
