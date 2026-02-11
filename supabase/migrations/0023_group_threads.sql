-- ============================================================
-- Group threads (multi-user chat rooms)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;

-- Members of a thread
CREATE TABLE IF NOT EXISTS public.chat_thread_members (
  thread_id uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);

ALTER TABLE public.chat_thread_members ENABLE ROW LEVEL SECURITY;

-- Messages in a thread
CREATE TABLE IF NOT EXISTS public.chat_thread_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  attachment_url text,
  attachment_name text,
  attachment_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS thread_messages_idx ON public.chat_thread_messages(thread_id, created_at);

ALTER TABLE public.chat_thread_messages ENABLE ROW LEVEL SECURITY;

-- RLS: thread visibility = you must be a member
CREATE POLICY "thread_select" ON public.chat_threads
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chat_thread_members tm WHERE tm.thread_id = id AND tm.user_id = auth.uid()));

CREATE POLICY "thread_insert" ON public.chat_threads
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

-- RLS: thread members
CREATE POLICY "thread_members_select" ON public.chat_thread_members
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chat_thread_members tm2 WHERE tm2.thread_id = thread_id AND tm2.user_id = auth.uid()));

CREATE POLICY "thread_members_insert" ON public.chat_thread_members
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.chat_thread_members tm2 WHERE tm2.thread_id = thread_id AND tm2.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.chat_threads t WHERE t.id = thread_id AND t.created_by = auth.uid())
  );

CREATE POLICY "thread_members_delete" ON public.chat_thread_members
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- RLS: thread messages - must be a member to read/write
CREATE POLICY "thread_msg_select" ON public.chat_thread_messages
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chat_thread_members tm WHERE tm.thread_id = chat_thread_messages.thread_id AND tm.user_id = auth.uid()));

CREATE POLICY "thread_msg_insert" ON public.chat_thread_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.chat_thread_members tm WHERE tm.thread_id = chat_thread_messages.thread_id AND tm.user_id = auth.uid())
  );

CREATE POLICY "thread_msg_delete" ON public.chat_thread_messages
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_thread_messages;
