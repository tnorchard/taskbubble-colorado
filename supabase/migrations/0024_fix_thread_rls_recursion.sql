-- Fix infinite recursion: the SELECT/INSERT policies on chat_thread_members
-- referenced chat_thread_members itself causing a loop.
-- Solution: use a SECURITY DEFINER helper function.

CREATE OR REPLACE FUNCTION public.is_thread_member(p_thread_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_thread_members
    WHERE thread_id = p_thread_id AND user_id = p_user_id
  );
$$;

-- Drop old recursive policies
DROP POLICY IF EXISTS "thread_members_select" ON public.chat_thread_members;
DROP POLICY IF EXISTS "thread_members_insert" ON public.chat_thread_members;
DROP POLICY IF EXISTS "thread_members_delete" ON public.chat_thread_members;

-- Recreate using the helper function (no recursion)
CREATE POLICY "thread_members_select" ON public.chat_thread_members
  FOR SELECT TO authenticated
  USING (public.is_thread_member(thread_id, auth.uid()));

CREATE POLICY "thread_members_insert" ON public.chat_thread_members
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_thread_member(thread_id, auth.uid())
    OR EXISTS (SELECT 1 FROM public.chat_threads t WHERE t.id = thread_id AND t.created_by = auth.uid())
  );

CREATE POLICY "thread_members_delete" ON public.chat_thread_members
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Also fix thread_select and thread message policies to use the helper
DROP POLICY IF EXISTS "thread_select" ON public.chat_threads;
CREATE POLICY "thread_select" ON public.chat_threads
  FOR SELECT TO authenticated
  USING (public.is_thread_member(id, auth.uid()));

DROP POLICY IF EXISTS "thread_msg_select" ON public.chat_thread_messages;
CREATE POLICY "thread_msg_select" ON public.chat_thread_messages
  FOR SELECT TO authenticated
  USING (public.is_thread_member(thread_id, auth.uid()));

DROP POLICY IF EXISTS "thread_msg_insert" ON public.chat_thread_messages;
CREATE POLICY "thread_msg_insert" ON public.chat_thread_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_thread_member(thread_id, auth.uid())
  );
