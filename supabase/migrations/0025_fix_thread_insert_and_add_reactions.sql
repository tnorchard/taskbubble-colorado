-- 1. Fix thread_select: allow creator to see their own thread (needed for INSERT...RETURNING)
DROP POLICY IF EXISTS "thread_select" ON public.chat_threads;
CREATE POLICY "thread_select" ON public.chat_threads
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.is_thread_member(id, auth.uid()));

-- 2. Message reactions table (works across all 3 message tables)
CREATE TABLE IF NOT EXISTS public.message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_type text NOT NULL CHECK (message_type IN ('channel', 'dm', 'thread')),
  message_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_type, message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS reactions_lookup_idx
  ON public.message_reactions(message_type, message_id);

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can see reactions
CREATE POLICY "reactions_select" ON public.message_reactions
  FOR SELECT TO authenticated USING (true);

-- You can only add your own reactions
CREATE POLICY "reactions_insert" ON public.message_reactions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- You can only remove your own reactions
CREATE POLICY "reactions_delete" ON public.message_reactions
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Realtime for reactions
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
