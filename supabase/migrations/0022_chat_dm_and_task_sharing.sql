-- ============================================================
-- Direct Messages table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  attachment_url text,
  attachment_name text,
  attachment_type text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for conversation lookups
CREATE INDEX IF NOT EXISTS dm_conversation_idx ON public.direct_messages(
  LEAST(sender_id, recipient_id),
  GREATEST(sender_id, recipient_id),
  created_at DESC
);
CREATE INDEX IF NOT EXISTS dm_recipient_idx ON public.direct_messages(recipient_id, created_at DESC);

-- RLS
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dm_select" ON public.direct_messages
  FOR SELECT TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

CREATE POLICY "dm_insert" ON public.direct_messages
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "dm_delete" ON public.direct_messages
  FOR DELETE TO authenticated
  USING (auth.uid() = sender_id);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;

-- ============================================================
-- Add task_id column to chat_messages for task sharing
-- ============================================================
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL;
