import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "../lib/supabaseClient";
import type { Profile, Task } from "../types";

/* ── Types ── */
type ChatMsg = {
  id: string;
  workspace_id: string | null;
  user_id: string;
  body: string;
  task_id?: string | null;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  created_at: string;
};

type DirectMsg = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  task_id?: string | null;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  read: boolean;
  created_at: string;
};

type ThreadMsg = {
  id: string;
  thread_id: string;
  user_id: string;
  body: string;
  task_id?: string | null;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  created_at: string;
};

type ChatThread = {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  member_profiles?: Profile[];
};

type Reaction = {
  id: string;
  message_type: "channel" | "dm" | "thread";
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

type WsOption = { id: string; name: string };
type ConvoPartner = { id: string; profile: Profile };

const QUICK_EMOJIS = ["👍", "👎", "❤️", "😂", "😮", "😢", "🔥", "🎉"] as const;

/* ── View mode ── */
type ChatView =
  | { kind: "channel"; wsId: string }
  | { kind: "dm"; partnerId: string }
  | { kind: "thread"; threadId: string };

/* ── Helpers ── */
function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function fmtDay(d: string) {
  const dt = new Date(d);
  const today = new Date();
  if (dt.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dt.toDateString() === yesterday.toDateString()) return "Yesterday";
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function userInitials(name: string | null | undefined, email: string | null | undefined) {
  const src = name || email || "U";
  const clean = src.includes("@") ? src.split("@")[0] : src;
  const parts = clean.replace(/[^a-zA-Z0-9 ]/g, " ").split(" ").filter(Boolean);
  return ((parts[0]?.[0] ?? "U") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase();
}

function isImageType(type: string | null | undefined) {
  return type?.startsWith("image/");
}

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/* ── Component ── */
export function ChatPage() {
  const supabase = getSupabase();
  const [uid, setUid] = useState<string | null>(null);
  const [allWorkspaces, setAllWorkspaces] = useState<WsOption[]>([]);

  // Unified view state
  const GENERAL_ID = "00000000-0000-0000-0000-000000000000";
  const [view, setView] = useState<ChatView>({ kind: "channel", wsId: GENERAL_ID });

  // Channel messages
  const [messages, setMessages] = useState<ChatMsg[]>([]);

  // DM state
  const [dmMessages, setDmMessages] = useState<DirectMsg[]>([]);
  const [dmConversations, setDmConversations] = useState<ConvoPartner[]>([]);

  // Thread state
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadMessages, setThreadMessages] = useState<ThreadMsg[]>([]);

  // Modals
  const [showNewDm, setShowNewDm] = useState(false);
  const [showNewThread, setShowNewThread] = useState(false);
  const [newThreadName, setNewThreadName] = useState("");
  const [newThreadMembers, setNewThreadMembers] = useState<Set<string>>(new Set());

  const [allUsers, setAllUsers] = useState<Profile[]>([]);
  const [dmSearch, setDmSearch] = useState("");
  const [threadSearch, setThreadSearch] = useState("");

  // Shared state
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Attachment state
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Task sharing
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [availableTasks, setAvailableTasks] = useState<Task[]>([]);
  const [taskSearch, setTaskSearch] = useState("");

  // Members panel
  const [showMembers, setShowMembers] = useState(false);
  const [channelMembers, setChannelMembers] = useState<Profile[]>([]);

  // Hover popup for member dot (header avatars)
  const [hoverMember, setHoverMember] = useState<{ profile: Profile; rect: DOMRect } | null>(null);

  // Task cache
  const [taskCache, setTaskCache] = useState<Map<string, Task>>(new Map());

  // Image lightbox
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Reactions
  const [reactions, setReactions] = useState<Map<string, Reaction[]>>(new Map());
  const [openEmojiPicker, setOpenEmojiPicker] = useState<string | null>(null);

  // Mentions
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionStart, setMentionStart] = useState(0); // cursor position where @ was typed
  const inputRef = useRef<HTMLInputElement>(null);

  /* ── Init ── */
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id ?? null;
      setUid(userId);

      // Load all workspaces (for channels)
      const { data: wsData } = await supabase.from("workspaces").select("id,name").order("name");
      setAllWorkspaces((wsData ?? []).map((w: any) => ({ id: w.id, name: w.name })));

      // Load all profiles
      const { data: profData } = await supabase.from("profiles").select("id,email,display_name,avatar_url,user_color");
      const profs = (profData ?? []) as Profile[];
      setAllUsers(profs);
      const map = new Map<string, Profile>();
      profs.forEach((p) => map.set(p.id, p));
      setProfiles(map);

      // Pre-load channel members for initial view (General)
      void loadChannelMembers(GENERAL_ID, profs);

      // Load DM conversations
      if (userId) {
        await loadDmConversations(userId, profs);
        await loadThreads(userId, map);
      }

      setLoading(false);
    })();
  }, []);

  /* ── Load DM conversations ── */
  async function loadDmConversations(userId: string, profs?: Profile[]) {
    const { data } = await supabase
      .from("direct_messages")
      .select("sender_id,recipient_id")
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(200);

    const partnerIds = new Set<string>();
    (data ?? []).forEach((row: any) => {
      const other = row.sender_id === userId ? row.recipient_id : row.sender_id;
      partnerIds.add(other);
    });

    const profileList = profs ?? Array.from(profiles.values());
    const convos: ConvoPartner[] = [];
    partnerIds.forEach((pid) => {
      const p = profileList.find((pr) => pr.id === pid);
      if (p) convos.push({ id: pid, profile: p });
    });
    setDmConversations(convos);
  }

  /* ── Load threads ── */
  async function loadThreads(_userId: string, profMap?: Map<string, Profile>) {
    const { data: threadData } = await supabase
      .from("chat_threads")
      .select("id,name,created_by,created_at")
      .order("created_at", { ascending: false });

    if (!threadData?.length) { setThreads([]); return; }

    const threadIds = threadData.map((t: any) => t.id);
    const { data: memberData } = await supabase
      .from("chat_thread_members")
      .select("thread_id,user_id")
      .in("thread_id", threadIds);

    const pMap = profMap ?? profiles;
    const threadsWithMembers = (threadData as ChatThread[]).map((t) => {
      const memberIds = (memberData ?? []).filter((m: any) => m.thread_id === t.id).map((m: any) => m.user_id as string);
      const memberProfiles = memberIds.map((id) => pMap.get(id)).filter((p): p is Profile => p !== undefined);
      return { ...t, member_profiles: memberProfiles };
    });
    setThreads(threadsWithMembers);
  }

  /* ── Load channel messages ── */
  async function loadMessages(wsId: string) {
    setError(null);
    const isGeneral = wsId === GENERAL_ID;
    let query = supabase.from("chat_messages").select("*").order("created_at", { ascending: true }).limit(200);
    if (isGeneral) query = query.is("workspace_id", null);
    else query = query.eq("workspace_id", wsId);

    const { data, error: e } = await query;
    if (e) { setError(e.message); return; }
    const msgs = (data ?? []) as ChatMsg[];
    setMessages(msgs);
    enrichProfiles(msgs.map((m) => m.user_id));
    loadTasksFromIds(msgs.map((m) => m.task_id));
    void loadReactions(msgs.map((m) => m.id), "channel");
    setTimeout(() => snapToBottom(), 100);
  }

  /* ── Load DM messages ── */
  async function loadDmMessages(partnerId: string) {
    if (!uid) return;
    setError(null);
    const { data, error: e } = await supabase
      .from("direct_messages")
      .select("*")
      .or(`and(sender_id.eq.${uid},recipient_id.eq.${partnerId}),and(sender_id.eq.${partnerId},recipient_id.eq.${uid})`)
      .order("created_at", { ascending: true })
      .limit(200);

    if (e) { setError(e.message); return; }
    const msgs = (data ?? []) as DirectMsg[];
    setDmMessages(msgs);
    loadTasksFromIds(msgs.map((m) => m.task_id));
    void loadReactions(msgs.map((m) => m.id), "dm");

    await supabase
      .from("direct_messages")
      .update({ read: true })
      .eq("recipient_id", uid)
      .eq("sender_id", partnerId)
      .eq("read", false);

    setTimeout(() => snapToBottom(), 100);
  }

  /* __ Load thread messages __ */
  async function loadThreadMessages(threadId: string) {
    setError(null);
    const { data, error: e } = await supabase
      .from("chat_thread_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (e) { setError(e.message); return; }
    const msgs = (data ?? []) as ThreadMsg[];
    setThreadMessages(msgs);
    enrichProfiles(msgs.map((m) => m.user_id));
    loadTasksFromIds(msgs.map((m) => m.task_id));
    void loadReactions(msgs.map((m) => m.id), "thread");
    setTimeout(() => snapToBottom(), 100);
  }

  /* ── Load channel members ── */
  async function loadChannelMembers(wsId: string, users?: Profile[]) {
    const userList = users ?? allUsers;
    if (wsId === GENERAL_ID) { setChannelMembers(userList); return; }
    const { data } = await supabase.from("workspace_members").select("user_id").eq("workspace_id", wsId);
    const memberIds = (data ?? []).map((r: any) => r.user_id);
    setChannelMembers(userList.filter((u) => memberIds.includes(u.id)));
  }

  /* ── Enrich profiles ── */
  function enrichProfiles(userIds: string[]) {
    const missing = userIds.filter((id) => !profiles.has(id));
    if (!missing.length) return;
    supabase.from("profiles").select("id,email,display_name,avatar_url,user_color").in("id", missing).then(({ data }) => {
      if (!data) return;
      setProfiles((prev) => { const next = new Map(prev); (data as Profile[]).forEach((p) => next.set(p.id, p)); return next; });
    });
  }

  /* ── Task cache ── */
  function loadTasksFromIds(ids: (string | null | undefined)[]) {
    const clean = ids.filter((id): id is string => typeof id === "string" && id.length > 0 && !taskCache.has(id));
    if (!clean.length) return;
    supabase.from("tasks").select("*").in("id", clean).then(({ data }) => {
      if (!data) return;
      setTaskCache((prev) => { const next = new Map(prev); (data as Task[]).forEach((t) => next.set(t.id, t)); return next; });
    });
  }

  function scrollToBottom(smooth = false) {
    const doScroll = () => {
      if (bottomRef.current) {
        bottomRef.current.scrollIntoView({ behavior: smooth ? "smooth" : "instant", block: "end" });
      } else {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }
    };
    // Double-rAF ensures React has flushed DOM before we scroll
    requestAnimationFrame(() => requestAnimationFrame(doScroll));
  }

  // Extra delayed snaps keep the view at the latest message after late layout shifts.
  function snapToBottom(smooth = false) {
    scrollToBottom(smooth);
    window.setTimeout(() => scrollToBottom(smooth), 80);
    window.setTimeout(() => scrollToBottom(smooth), 220);
  }

  /* ── Reactions helpers ── */
  const currentMessageType: "channel" | "dm" | "thread" =
    view.kind === "channel" ? "channel" : view.kind === "dm" ? "dm" : "thread";

  async function loadReactions(msgIds: string[], msgType: "channel" | "dm" | "thread") {
    if (!msgIds.length) return;
    // Only load for real IDs (not optimistic)
    const realIds = msgIds.filter((id) => !id.startsWith("opt-"));
    if (!realIds.length) return;
    const { data } = await supabase
      .from("message_reactions")
      .select("*")
      .eq("message_type", msgType)
      .in("message_id", realIds);
    if (!data) return;
    const rxns = data as Reaction[];
    setReactions((prev) => {
      const next = new Map(prev);
      // Group by message_id
      const grouped = new Map<string, Reaction[]>();
      rxns.forEach((r) => {
        const arr = grouped.get(r.message_id) ?? [];
        arr.push(r);
        grouped.set(r.message_id, arr);
      });
      // Merge: for queried IDs, replace; keep others
      realIds.forEach((id) => {
        next.set(id, grouped.get(id) ?? []);
      });
      return next;
    });
  }

  async function toggleReaction(messageId: string, emoji: string) {
    if (!uid || messageId.startsWith("opt-")) return;

    const existing = (reactions.get(messageId) ?? []).find(
      (r) => r.user_id === uid && r.emoji === emoji
    );

    if (existing) {
      // Remove
      setReactions((prev) => {
        const next = new Map(prev);
        next.set(messageId, (prev.get(messageId) ?? []).filter((r) => r.id !== existing.id));
        return next;
      });
      await supabase.from("message_reactions").delete().eq("id", existing.id);
    } else {
      // Add (optimistic)
      const optReaction: Reaction = {
        id: `opt-r-${Date.now()}`,
        message_type: currentMessageType,
        message_id: messageId,
        user_id: uid,
        emoji,
        created_at: new Date().toISOString(),
      };
      setReactions((prev) => {
        const next = new Map(prev);
        next.set(messageId, [...(prev.get(messageId) ?? []), optReaction]);
        return next;
      });
      const { data, error: e } = await supabase
        .from("message_reactions")
        .insert({ message_type: currentMessageType, message_id: messageId, user_id: uid, emoji })
        .select("*")
        .single();
      if (e) {
        setReactions((prev) => {
          const next = new Map(prev);
          next.set(messageId, (prev.get(messageId) ?? []).filter((r) => r.id !== optReaction.id));
          return next;
        });
      } else if (data) {
        setReactions((prev) => {
          const next = new Map(prev);
          next.set(messageId, (prev.get(messageId) ?? []).map((r) => r.id === optReaction.id ? (data as Reaction) : r));
          return next;
        });
      }
    }
    setOpenEmojiPicker(null);
  }

  /* ── Auto-scroll to bottom when messages first load ── */
  const prevMsgCount = useRef(0);
  useEffect(() => {
    const count = view.kind === "channel" ? messages.length : view.kind === "dm" ? dmMessages.length : threadMessages.length;
    if (count > 0 && prevMsgCount.current === 0) {
      setTimeout(() => snapToBottom(), 60);
    }
    prevMsgCount.current = count;
  }, [messages.length, dmMessages.length, threadMessages.length, view.kind]);

  /* ── Keep channel members in sync when allUsers loads ── */
  useEffect(() => {
    if (view.kind === "channel" && allUsers.length > 0) {
      void loadChannelMembers(view.wsId, allUsers);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allUsers]);

  const channelWsId = view.kind === "channel" ? view.wsId : null;
  /* ── Realtime: channel ── */
  useEffect(() => {
    if (!channelWsId) return;
    void loadMessages(channelWsId);
    void loadChannelMembers(channelWsId);

    const isGeneral = channelWsId === GENERAL_ID;
    const channel = supabase
      .channel(`chat:${channelWsId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
        const msg = payload.new as ChatMsg;
        const belongsToActiveChannel = isGeneral ? msg.workspace_id === null : msg.workspace_id === channelWsId;
        if (!belongsToActiveChannel) return;
        setMessages((prev) => {
          // Dedup: skip if real ID exists OR if an optimistic version matches
          if (prev.some((m) => m.id === msg.id)) return prev;
          // Remove optimistic version (same user, same body)
          const cleaned = prev.filter((m) => {
            if (!m.id.startsWith("opt-")) return true;
            return !(m.user_id === msg.user_id && m.body === msg.body);
          });
          return [...cleaned, msg];
        });
        enrichProfiles([msg.user_id]);
        if (msg.task_id) loadTasksFromIds([msg.task_id]);
        setTimeout(() => scrollToBottom(true), 50);
      })
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [channelWsId, supabase]);

  const dmPartnerId = view.kind === "dm" ? view.partnerId : null;
  /* ── Realtime: DM ── */
  useEffect(() => {
    if (!dmPartnerId) return;
    const partnerId = dmPartnerId;
    void loadDmMessages(partnerId);

    const channel = supabase
      .channel(`dm:${[uid, partnerId].sort().join("-")}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "direct_messages" }, (payload) => {
        const msg = payload.new as DirectMsg;
        const isOurs = (msg.sender_id === uid && msg.recipient_id === partnerId) || (msg.sender_id === partnerId && msg.recipient_id === uid);
        if (!isOurs) return;
        setDmMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          const cleaned = prev.filter((m) => {
            if (!m.id.startsWith("opt-")) return true;
            return !(m.sender_id === msg.sender_id && m.body === msg.body);
          });
          return [...cleaned, msg];
        });
        if (msg.task_id) loadTasksFromIds([msg.task_id]);
        setTimeout(() => scrollToBottom(true), 50);
      })
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [dmPartnerId, uid, supabase]);

  const activeThreadId = view.kind === "thread" ? view.threadId : null;
  /* ── Realtime: thread ── */
  useEffect(() => {
    if (!activeThreadId) return;
    const threadId = activeThreadId;
    void loadThreadMessages(threadId);

    const channel = supabase
      .channel(`thread:${threadId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_thread_messages", filter: `thread_id=eq.${threadId}` }, (payload) => {
        const msg = payload.new as ThreadMsg;
        setThreadMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          const cleaned = prev.filter((m) => {
            if (!m.id.startsWith("opt-")) return true;
            return !(m.user_id === msg.user_id && m.body === msg.body);
          });
          return [...cleaned, msg];
        });
        enrichProfiles([msg.user_id]);
        if (msg.task_id) loadTasksFromIds([msg.task_id]);
        setTimeout(() => scrollToBottom(true), 50);
      })
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [activeThreadId, supabase]);

  /* ── Realtime: reactions (preserve scroll on updates) ── */
  useEffect(() => {
    const channel = supabase
      .channel("reactions")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_reactions" }, (payload) => {
        const r = payload.new as Reaction;
        setReactions((prev) => {
          const next = new Map(prev);
          const arr = next.get(r.message_id) ?? [];
          const cleaned = arr.filter((x) => {
            if (x.id === r.id) return false;
            if (x.id.startsWith("opt-r-") && x.user_id === r.user_id && x.emoji === r.emoji) return false;
            return true;
          });
          next.set(r.message_id, [...cleaned, r]);
          return next;
        });
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "message_reactions" }, (payload) => {
        const r = payload.old as Partial<Reaction>;
        if (!r.message_id || !r.id) return;
        setReactions((prev) => {
          const next = new Map(prev);
          next.set(r.message_id!, (prev.get(r.message_id!) ?? []).filter((x) => x.id !== r.id));
          return next;
        });
      })
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, []);

  /* ── Load tasks for picker ── */
  const loadAvailableTasks = useCallback(async () => {
    const { data } = await supabase.from("tasks").select("*").is("deleted_at", null).neq("status", "done").order("created_at", { ascending: false }).limit(100);
    setAvailableTasks((data ?? []) as Task[]);
  }, [supabase]);

  /* ── File handling ── */
  function onFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError("File too large (max 10 MB)"); return; }
    setPendingFile(file);
  }
  function clearFile() { setPendingFile(null); if (fileRef.current) fileRef.current.value = ""; }

  async function uploadFile(file: File): Promise<{ url: string; name: string; type: string } | null> {
    if (!uid) return null;
    setUploading(true);
    const ext = file.name.split(".").pop() ?? "bin";
    const path = `${uid}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("chat-attachments").upload(path, file, { cacheControl: "3600", upsert: false });
    setUploading(false);
    if (upErr) { setError(upErr.message.includes("not found") ? "Chat attachments storage not set up yet." : upErr.message); return null; }
    const { data: urlData } = supabase.storage.from("chat-attachments").getPublicUrl(path);
    return { url: urlData.publicUrl, name: file.name, type: file.type };
  }

  /* ── Download helper (fetch + blob to avoid tab switch) ── */
  async function downloadFile(url: string, fileName: string) {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      // Fallback
      window.open(url, "_blank");
    }
  }

  /* ── Send: channel ── */
  async function sendChannelMessage(taskId?: string) {
    if (view.kind !== "channel" || !uid) return;
    if (!body.trim() && !pendingFile && !taskId) return;
    setSending(true);
    setError(null);

    let attach: { url: string; name: string; type: string } | null = null;
    if (pendingFile) { attach = await uploadFile(pendingFile); if (!attach) { setSending(false); return; } }

    const isGeneral = view.wsId === GENERAL_ID;
    const msgBody = body.trim() || (attach ? `Shared ${attach.name}` : taskId ? "Shared a task" : "");

    // Optimistic
    const optId = `opt-${Date.now()}`;
    setMessages((prev) => [...prev, {
      id: optId, workspace_id: isGeneral ? null : view.wsId, user_id: uid, body: msgBody,
      task_id: taskId ?? null, attachment_url: attach?.url ?? null, attachment_name: attach?.name ?? null,
      attachment_type: attach?.type ?? null, created_at: new Date().toISOString(),
    }]);
    setBody(""); clearFile(); setShowTaskPicker(false);
    setTimeout(() => scrollToBottom(true), 30);

    const { error: e } = await supabase.from("chat_messages").insert({
      workspace_id: isGeneral ? null : view.wsId, user_id: uid, body: msgBody,
      task_id: taskId ?? null, attachment_url: attach?.url ?? null, attachment_name: attach?.name ?? null, attachment_type: attach?.type ?? null,
    });
    if (e) { setError(e.message); setMessages((prev) => prev.filter((m) => m.id !== optId)); }
    setSending(false);
  }

  /* ── Send: DM ── */
  async function sendDm(taskId?: string) {
    if (view.kind !== "dm" || !uid) return;
    const partnerId = view.partnerId;
    if (!body.trim() && !pendingFile && !taskId) return;
    setSending(true);
    setError(null);

    let attach: { url: string; name: string; type: string } | null = null;
    if (pendingFile) { attach = await uploadFile(pendingFile); if (!attach) { setSending(false); return; } }

    const msgBody = body.trim() || (attach ? `Shared ${attach.name}` : taskId ? "Shared a task" : "");

    const optId = `opt-${Date.now()}`;
    setDmMessages((prev) => [...prev, {
      id: optId, sender_id: uid, recipient_id: partnerId, body: msgBody,
      task_id: taskId ?? null, attachment_url: attach?.url ?? null, attachment_name: attach?.name ?? null,
      attachment_type: attach?.type ?? null, read: false, created_at: new Date().toISOString(),
    }]);
    setBody(""); clearFile(); setShowTaskPicker(false);
    setTimeout(() => scrollToBottom(true), 30);

    const { error: e } = await supabase.from("direct_messages").insert({
      sender_id: uid, recipient_id: partnerId, body: msgBody,
      task_id: taskId ?? null, attachment_url: attach?.url ?? null, attachment_name: attach?.name ?? null, attachment_type: attach?.type ?? null,
    });
    if (e) { setError(e.message); setDmMessages((prev) => prev.filter((m) => m.id !== optId)); }
    else if (!dmConversations.some((c) => c.id === partnerId)) {
      const prof = profiles.get(partnerId);
      if (prof) setDmConversations((prev) => [{ id: partnerId, profile: prof }, ...prev]);
    }
    setSending(false);
  }

  /* ── Send: thread ── */
  async function sendThreadMessage(taskId?: string) {
    if (view.kind !== "thread" || !uid) return;
    const threadId = view.threadId;
    if (!body.trim() && !pendingFile && !taskId) return;
    setSending(true);
    setError(null);

    let attach: { url: string; name: string; type: string } | null = null;
    if (pendingFile) { attach = await uploadFile(pendingFile); if (!attach) { setSending(false); return; } }

    const msgBody = body.trim() || (attach ? `Shared ${attach.name}` : taskId ? "Shared a task" : "");

    const optId = `opt-${Date.now()}`;
    setThreadMessages((prev) => [...prev, {
      id: optId, thread_id: threadId, user_id: uid, body: msgBody,
      task_id: taskId ?? null, attachment_url: attach?.url ?? null, attachment_name: attach?.name ?? null,
      attachment_type: attach?.type ?? null, created_at: new Date().toISOString(),
    }]);
    setBody(""); clearFile(); setShowTaskPicker(false);
    setTimeout(() => scrollToBottom(true), 30);

    const { error: e } = await supabase.from("chat_thread_messages").insert({
      thread_id: threadId, user_id: uid, body: msgBody,
      task_id: taskId ?? null, attachment_url: attach?.url ?? null, attachment_name: attach?.name ?? null, attachment_type: attach?.type ?? null,
    });
    if (e) { setError(e.message); setThreadMessages((prev) => prev.filter((m) => m.id !== optId)); }
    setSending(false);
  }

  /* ── Create thread ── */
  async function createThread() {
    if (!uid || newThreadMembers.size === 0) return;
    const name = newThreadName.trim() || Array.from(newThreadMembers).map((id) => {
      const p = profiles.get(id);
      return p?.display_name || p?.email?.split("@")[0] || "User";
    }).join(", ");

    const { data: thread, error: e1 } = await supabase
      .from("chat_threads")
      .insert({ name, created_by: uid })
      .select("id,name,created_by,created_at")
      .single();

    if (e1 || !thread) { setError(e1?.message ?? "Failed to create thread"); return; }

    // Add members (creator + selected)
    const allMembers = [uid, ...Array.from(newThreadMembers)];
    const { error: e2 } = await supabase.from("chat_thread_members").insert(
      allMembers.map((userId) => ({ thread_id: thread.id, user_id: userId }))
    );
    if (e2) { setError(e2.message); return; }

    // Refresh & navigate
    await loadThreads(uid, profiles);
    setView({ kind: "thread", threadId: thread.id });
    setShowNewThread(false);
    setNewThreadName("");
    setNewThreadMembers(new Set());
  }

  /* ── Navigation helpers ── */
  function switchToChannel(wsId: string) { prevMsgCount.current = 0; setView({ kind: "channel", wsId }); setShowNewDm(false); setShowNewThread(false); }
  function startDm(userId: string) {
    prevMsgCount.current = 0;
    setView({ kind: "dm", partnerId: userId });
    setShowNewDm(false);
    setDmSearch("");
    if (!dmConversations.some((c) => c.id === userId)) {
      const prof = profiles.get(userId);
      if (prof) setDmConversations((prev) => [{ id: userId, profile: prof }, ...prev]);
    }
  }
  function openThread(threadId: string) { prevMsgCount.current = 0; setView({ kind: "thread", threadId }); setShowNewThread(false); }

  /* ── Derived ── */
  const activeWsName = view.kind === "channel" ? (view.wsId === GENERAL_ID ? "General" : allWorkspaces.find((w) => w.id === view.wsId)?.name ?? "Chat") : "";
  const dmPartnerProfile = view.kind === "dm" ? profiles.get(view.partnerId) : null;
  const dmPartnerName = dmPartnerProfile?.display_name || dmPartnerProfile?.email?.split("@")[0] || "User";
  const activeThread = view.kind === "thread" ? threads.find((t) => t.id === view.threadId) : null;

  const headerName = view.kind === "channel" ? activeWsName : view.kind === "dm" ? dmPartnerName : activeThread?.name ?? "Thread";

  // Group messages by day
  function groupByDay<T extends { created_at: string }>(msgs: T[]): Array<{ day: string; msgs: T[] }> {
    const grouped: Array<{ day: string; msgs: T[] }> = [];
    msgs.forEach((m) => {
      const day = fmtDay(m.created_at);
      if (grouped.length === 0 || grouped[grouped.length - 1].day !== day) grouped.push({ day, msgs: [m] });
      else grouped[grouped.length - 1].msgs.push(m);
    });
    return grouped;
  }

  const groupedChannel = useMemo(() => groupByDay(messages), [messages]);
  const groupedDm = useMemo(() => groupByDay(dmMessages), [dmMessages]);
  const groupedThread = useMemo(() => groupByDay(threadMessages), [threadMessages]);

  const filteredTasks = useMemo(() => {
    const q = taskSearch.toLowerCase().trim();
    if (!q) return availableTasks.slice(0, 20);
    return availableTasks.filter((t) => t.title.toLowerCase().includes(q)).slice(0, 20);
  }, [availableTasks, taskSearch]);

  const filteredUsers = useMemo(() => {
    const q = dmSearch.toLowerCase().trim();
    return allUsers.filter((u) => u.id !== uid).filter((u) => !q || u.display_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)).slice(0, 20);
  }, [allUsers, dmSearch, uid]);

  const filteredThreadUsers = useMemo(() => {
    const q = threadSearch.toLowerCase().trim();
    return allUsers.filter((u) => u.id !== uid).filter((u) => !q || u.display_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)).slice(0, 30);
  }, [allUsers, threadSearch, uid]);

  /* ── Send handler ── */
  const sendHandler = view.kind === "channel" ? sendChannelMessage : view.kind === "dm" ? sendDm : sendThreadMessage;

  /* ── Mention helpers ── */
  /* Members scoped to the current conversation (for mentions) */
  const conversationMembers = useMemo((): Profile[] => {
    if (view.kind === "channel") return channelMembers;
    if (view.kind === "thread") return activeThread?.member_profiles ?? [];
    if (view.kind === "dm") {
      const partner = dmPartnerProfile;
      return partner ? [partner] : [];
    }
    return [];
  }, [view, channelMembers, activeThread, dmPartnerProfile]);

  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return conversationMembers
      .filter((u) => u.id !== uid)
      .filter((u) => {
        if (!q) return true;
        return (
          u.display_name?.toLowerCase().includes(q) ||
          u.email?.toLowerCase().includes(q)
        );
      })
      .slice(0, 6);
  }, [mentionQuery, conversationMembers, uid]);

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setBody(val);

    // Detect @mention trigger
    const cursor = e.target.selectionStart ?? val.length;
    const textBefore = val.slice(0, cursor);
    // Find the last @ that isn't preceded by a word character
    const atMatch = textBefore.match(/(^|[^a-zA-Z0-9])@([a-zA-Z0-9 ]*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[2]);
      setMentionStart(cursor - atMatch[2].length - 1); // position of the @
      setMentionIdx(0);
    } else {
      setMentionQuery(null);
    }
  }

  function insertMention(user: Profile) {
    const displayName = user.display_name || user.email?.split("@")[0] || "User";
    const before = body.slice(0, mentionStart);
    const after = body.slice(mentionStart + 1 + (mentionQuery?.length ?? 0)); // skip @ + query
    const newBody = `${before}@${displayName} ${after}`;
    setBody(newBody);
    setMentionQuery(null);
    // Restore focus
    setTimeout(() => {
      const inp = inputRef.current;
      if (inp) {
        inp.focus();
        const pos = before.length + 1 + displayName.length + 1;
        inp.setSelectionRange(pos, pos);
      }
    }, 0);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Handle mention navigation
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIdx((i) => Math.min(i + 1, mentionCandidates.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        insertMention(mentionCandidates[mentionIdx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    // Normal enter = send
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendWithMentions();
    }
  }

  /** Extract @mentions from body and send notifications */
  async function sendWithMentions(taskId?: string) {
    // Extract mentioned names from body
    const mentionRegex = /@([a-zA-Z0-9 ]+?)(?=\s|$|@)/g;
    const mentionedNames: string[] = [];
    let match;
    const currentBody = body;
    while ((match = mentionRegex.exec(currentBody)) !== null) {
      mentionedNames.push(match[1].trim());
    }

    // Resolve to user IDs
    const mentionedUserIds: string[] = [];
    mentionedNames.forEach((name) => {
      const lower = name.toLowerCase();
      const found = allUsers.find(
        (u) =>
          u.display_name?.toLowerCase() === lower ||
          u.email?.toLowerCase().split("@")[0] === lower
      );
      if (found && found.id !== uid) mentionedUserIds.push(found.id);
    });

    // Send the actual message
    await sendHandler(taskId);

    // Send notifications for mentions
    if (mentionedUserIds.length > 0 && uid) {
      const preview = currentBody.slice(0, 100);
      for (const mentionedUid of mentionedUserIds) {
        try {
          await supabase.from("notifications").insert({
            user_id: mentionedUid,
            kind: "mention",
            title: `You were mentioned in a message`,
            body: preview,
            actor_id: uid,
          });
        } catch { /* notifications table may not exist */ }
      }
    }
  }

  /* ── Task card ── */
  function TaskCard({ taskId }: { taskId: string }) {
    const task = taskCache.get(taskId);
    if (!task) return <div className="chatTaskCard chatTaskCardLoading">Loading task…</div>;
    return (
      <div className="chatTaskCard">
        <div className="chatTaskCardHeader">
          <span className="chatTaskCardIcon">&#9745;</span>
          <span className={`chatTaskCardStatus ${task.status}`}>{task.status === "done" ? "Done" : task.status === "in_progress" ? "In Progress" : "Open"}</span>
        </div>
        <div className="chatTaskCardTitle">{task.title}</div>
        {task.description ? <div className="chatTaskCardDesc">{task.description.slice(0, 100)}{task.description.length > 100 ? "…" : ""}</div> : null}
        <div className="chatTaskCardMeta">
          {task.due_date ? <span>Due {task.due_date}</span> : task.is_asap ? <span className="chatTaskAsap">ASAP</span> : null}
          {task.company ? <><span className="chatTaskDot">·</span><span>{task.company}</span></> : null}
        </div>
      </div>
    );
  }

  /* ── Attachment block ── */
  function AttachmentBlock({ url, name, type }: { url: string; name: string | null; type: string | null }) {
    const fileName = name ?? "Attachment";

    if (isImageType(type)) {
      return (
        <div className="chatAttachment chatAttachmentImg">
          <img
            src={url}
            alt={fileName}
            className="chatAttachImg"
            onClick={() => setLightboxUrl(url)}
            style={{ cursor: "zoom-in" }}
          />
          <button
            type="button"
            className="chatDownloadBtn"
            onClick={(e) => { e.stopPropagation(); void downloadFile(url, fileName); }}
            title="Download"
          >
            &#8681;
          </button>
        </div>
      );
    }
    return (
      <div className="chatAttachment chatAttachmentFile">
        <button
          type="button"
          className="chatAttachFileChip"
          onClick={() => void downloadFile(url, fileName)}
          title="Download"
        >
          <span className="chatAttachFileIcon">&#128206;</span>
          <span className="chatAttachFileName">{fileName}</span>
          <span className="chatAttachFileDl">&#8595;</span>
        </button>
      </div>
    );
  }

  /* ── Reactions display ── */
  function ReactionChips({ messageId }: { messageId: string }) {
    const msgReactions = reactions.get(messageId) ?? [];
    if (!msgReactions.length) return null;

    // Group by emoji
    const grouped = new Map<string, { emoji: string; users: string[]; count: number }>();
    msgReactions.forEach((r) => {
      const g = grouped.get(r.emoji) ?? { emoji: r.emoji, users: [], count: 0 };
      g.users.push(r.user_id);
      g.count++;
      grouped.set(r.emoji, g);
    });

    return (
      <div className="rxnChips">
        {Array.from(grouped.values()).map((g) => {
          const iReacted = uid ? g.users.includes(uid) : false;
          const tooltip = g.users.map((id) => {
            const p = profiles.get(id);
            return p?.display_name || p?.email?.split("@")[0] || "User";
          }).join(", ");
          return (
            <button
              key={g.emoji}
              type="button"
              className={`rxnChip ${iReacted ? "rxnChipMine" : ""}`}
              onClick={(e) => { e.stopPropagation(); void toggleReaction(messageId, g.emoji); }}
              title={tooltip}
            >
              <span className="rxnEmoji">{g.emoji}</span>
              <span className="rxnCount">{g.count}</span>
            </button>
          );
        })}
      </div>
    );
  }

  /* ── Member dot with hover popup (border-only, like workspace page) ── */
  function MemberDot({ profile, size = 22 }: { profile: Profile; size?: number }) {
    const color = profile.user_color || "#72c8ff";
    const fontSize = size <= 20 ? 7 : size <= 24 ? 8 : 10;
    return (
      <div
        className="cMemberDot"
        style={{
          width: size, height: size, fontSize,
          borderColor: color,
        }}
        onMouseEnter={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setHoverMember({ profile, rect });
        }}
        onMouseLeave={() => setHoverMember((prev) => prev?.profile.id === profile.id ? null : prev)}
      >
        {userInitials(profile.display_name, profile.email)}
      </div>
    );
  }

  /* ── Render body with @mentions bolded ── */
  function renderWithMentions(text: string): React.ReactNode {
    // Split on @mentions: @Name (word chars + spaces, terminated by next @ or end of string)
    const parts = text.split(/(@[a-zA-Z0-9 ]+?)(?=\s|$|@)/g);
    if (parts.length <= 1) return text;
    return parts.map((part, i) => {
      if (part.startsWith("@")) {
        const mentionName = part.slice(1).trim();
        const isKnown = allUsers.some(
          (u) =>
            u.display_name?.toLowerCase() === mentionName.toLowerCase() ||
            u.email?.toLowerCase().split("@")[0] === mentionName.toLowerCase()
        );
        if (isKnown) {
          return <span key={i} className="chatMention">{part}</span>;
        }
      }
      return part;
    });
  }

  /* ── Msg bubble ── */
  function MsgBubble({ msgId, userId, body: msgBody, taskId, attachUrl, attachName, attachType, time, isMe }: {
    msgId: string; userId: string; body: string; taskId?: string | null;
    attachUrl?: string | null; attachName?: string | null; attachType?: string | null;
    time: string; isMe: boolean;
  }) {
    const prof = profiles.get(userId);
    const name = prof?.display_name || prof?.email?.split("@")[0] || "User";
    const color = prof?.user_color;
    const pickerOpen = openEmojiPicker === msgId;

    return (
      <div className={`chatBubbleRow ${isMe ? "chatBubbleMe" : ""}`}>
        {!isMe ? (
          <div className="chatAvatar" style={color ? { borderColor: color, background: `${color}22` } : undefined}>
            {userInitials(prof?.display_name, prof?.email)}
          </div>
        ) : null}
        <div className="chatBubbleWrap">
          <div className={`chatBubble ${isMe ? "chatBubbleSelf" : ""}`}>
          {!isMe ? <div className="chatBubbleName" style={color ? { color } : undefined}>{name}</div> : null}
          {msgBody ? <div className="chatBubbleBody">{renderWithMentions(msgBody)}</div> : null}
            {taskId ? <TaskCard taskId={taskId} /> : null}
            {attachUrl ? <AttachmentBlock url={attachUrl} name={attachName ?? null} type={attachType ?? null} /> : null}
            <div className="chatBubbleTime">{fmtTime(time)}</div>

            {/* Quick react button */}
            {!msgId.startsWith("opt-") && (
              <button
                type="button"
                className="rxnTrigger"
                onClick={(e) => { e.stopPropagation(); setOpenEmojiPicker(pickerOpen ? null : msgId); }}
                title="React"
              >
                &#128578;
              </button>
            )}
          </div>

          {/* Emoji picker dropdown */}
          {pickerOpen && (
            <div className="rxnPicker">
              {QUICK_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className="rxnPickerEmoji"
                  onClick={(ev) => { ev.stopPropagation(); void toggleReaction(msgId, e); }}
                >
                  {e}
                </button>
              ))}
            </div>
          )}

          <ReactionChips messageId={msgId} />
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="screen"><div className="screenInner"><div className="panel">Loading…</div></div></div>;
  }

  // Which messages to show?
  const currentGrouped = view.kind === "channel" ? groupedChannel : view.kind === "dm" ? groupedDm : groupedThread;
  const emptyLabel = view.kind === "channel" ? `No messages yet in #${activeWsName}` : view.kind === "dm" ? `Start a conversation with ${dmPartnerName}` : `No messages yet in ${activeThread?.name ?? "this thread"}`;
  const placeholder = view.kind === "channel" ? `Message #${activeWsName}…` : view.kind === "dm" ? `Message ${dmPartnerName}…` : `Message ${activeThread?.name ?? "thread"}…`;

  return (
    <div className="chatScreen">
      {/* ── Sidebar ── */}
      <div className="chatSidebar">
        <div className="chatSidebarTitle">Channels</div>
        <div className="chatWsList">
          <button className={`chatWsBtn ${view.kind === "channel" && view.wsId === GENERAL_ID ? "active" : ""}`} onClick={() => switchToChannel(GENERAL_ID)}>
            <span className="chatWsHash">&#127760;</span>General
          </button>
          <div className="chatWsDivider" />
          {allWorkspaces.map((w) => (
            <button key={w.id} className={`chatWsBtn ${view.kind === "channel" && view.wsId === w.id ? "active" : ""}`} onClick={() => switchToChannel(w.id)}>
              <span className="chatWsHash">#</span>{w.name}
            </button>
          ))}
        </div>

        {/* Threads */}
        <div className="chatSidebarTitle chatDmTitle">
          Threads
          <button className="chatNewDmBtn" onClick={() => setShowNewThread(true)} title="New thread" type="button">+</button>
        </div>
        <div className="chatWsList chatDmList">
          {threads.map((t) => (
            <button key={t.id} className={`chatWsBtn chatDmBtn ${view.kind === "thread" && view.threadId === t.id ? "active" : ""}`} onClick={() => openThread(t.id)}>
              <span className="chatWsHash" style={{ fontSize: 13 }}>&#128172;</span>
              <span className="chatDmName">{t.name}</span>
            </button>
          ))}
          {threads.length === 0 && <div className="chatDmEmpty">No threads yet</div>}
        </div>

        {/* DMs */}
        <div className="chatSidebarTitle chatDmTitle">
          Direct Messages
          <button className="chatNewDmBtn" onClick={() => setShowNewDm(true)} title="New message" type="button">+</button>
        </div>
        <div className="chatWsList chatDmList">
          {dmConversations.map((c) => (
            <button key={c.id} className={`chatWsBtn chatDmBtn ${view.kind === "dm" && view.partnerId === c.id ? "active" : ""}`} onClick={() => startDm(c.id)}>
              <span className="chatDmAvatar" style={c.profile.user_color ? { borderColor: c.profile.user_color } : undefined}>
                {userInitials(c.profile.display_name, c.profile.email)}
              </span>
              <span className="chatDmName">{c.profile.display_name || c.profile.email?.split("@")[0] || "User"}</span>
            </button>
          ))}
          {dmConversations.length === 0 && <div className="chatDmEmpty">No conversations yet</div>}
        </div>
      </div>

      {/* ── Image lightbox ── */}
      {lightboxUrl && (
        <div className="chatLightbox" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="Preview" className="chatLightboxImg" onClick={(e) => e.stopPropagation()} />
          <button type="button" className="chatLightboxClose" onClick={() => setLightboxUrl(null)}>&#10005;</button>
        </div>
      )}

      {/* ── New DM modal ── */}
      {showNewDm && (
        <div className="chatNewDmOverlay" onClick={() => setShowNewDm(false)}>
          <div className="chatNewDmModal" onClick={(e) => e.stopPropagation()}>
            <div className="chatNewDmHeader">
              <span>New Message</span>
              <button type="button" className="chatNewDmClose" onClick={() => setShowNewDm(false)}>&#10005;</button>
            </div>
            <input className="chatNewDmSearch" value={dmSearch} onChange={(e) => setDmSearch(e.target.value)} placeholder="Search users…" autoFocus />
            <div className="chatNewDmList">
              {filteredUsers.map((u) => (
                <button key={u.id} className="chatNewDmUser" onClick={() => startDm(u.id)}>
                  <div className="chatDmAvatar" style={u.user_color ? { borderColor: u.user_color } : undefined}>{userInitials(u.display_name, u.email)}</div>
                  <div>
                    <div className="chatNewDmUserName">{u.display_name || u.email?.split("@")[0] || "User"}</div>
                    {u.email ? <div className="chatNewDmUserEmail">{u.email}</div> : null}
                  </div>
                </button>
              ))}
              {filteredUsers.length === 0 && <div className="chatDmEmpty">No users found</div>}
            </div>
          </div>
        </div>
      )}

      {/* ── New thread modal ── */}
      {showNewThread && (
        <div className="chatNewDmOverlay" onClick={() => setShowNewThread(false)}>
          <div className="chatNewDmModal" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "80vh" }}>
            <div className="chatNewDmHeader">
              <span>New Thread</span>
              <button type="button" className="chatNewDmClose" onClick={() => setShowNewThread(false)}>&#10005;</button>
            </div>
            <div style={{ padding: "8px 16px 0" }}>
              <input className="chatNewDmSearch" value={newThreadName} onChange={(e) => setNewThreadName(e.target.value)} placeholder="Thread name (optional)" style={{ margin: 0, width: "100%", boxSizing: "border-box" }} />
            </div>
            {newThreadMembers.size > 0 && (
              <div className="chatThreadSelectedRow">
                {Array.from(newThreadMembers).map((id) => {
                  const p = profiles.get(id);
                  return (
                    <span key={id} className="chatThreadSelectedChip">
                      {p?.display_name || p?.email?.split("@")[0] || "User"}
                      <button type="button" className="chatThreadChipX" onClick={() => setNewThreadMembers((prev) => { const n = new Set(prev); n.delete(id); return n; })}>&#10005;</button>
                    </span>
                  );
                })}
              </div>
            )}
            <input className="chatNewDmSearch" value={threadSearch} onChange={(e) => setThreadSearch(e.target.value)} placeholder="Add people…" />
            <div className="chatNewDmList">
              {filteredThreadUsers.map((u) => {
                const selected = newThreadMembers.has(u.id);
                return (
                  <button key={u.id} className={`chatNewDmUser ${selected ? "chatNewDmUserSelected" : ""}`}
                    onClick={() => setNewThreadMembers((prev) => { const n = new Set(prev); if (n.has(u.id)) n.delete(u.id); else n.add(u.id); return n; })}>
                    <div className="chatDmAvatar" style={u.user_color ? { borderColor: u.user_color } : undefined}>{userInitials(u.display_name, u.email)}</div>
                    <div>
                      <div className="chatNewDmUserName">{u.display_name || u.email?.split("@")[0] || "User"}</div>
                      {u.email ? <div className="chatNewDmUserEmail">{u.email}</div> : null}
                    </div>
                    {selected && <span className="chatThreadCheckmark">&#10003;</span>}
                  </button>
                );
              })}
            </div>
            <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <button className="primaryBtn btnFull" disabled={newThreadMembers.size === 0} onClick={() => void createThread()}>
                Create Thread ({newThreadMembers.size} member{newThreadMembers.size !== 1 ? "s" : ""})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main chat area ── */}
      <div className="chatMain">
        <div className="chatHeader">
          <span className="chatWsHash" style={{ fontSize: 18 }}>{view.kind === "dm" ? "👤" : view.kind === "thread" ? "💬" : "#"}</span>
          <span className="chatHeaderName">{headerName}</span>
          {view.kind === "thread" && activeThread?.member_profiles && activeThread.member_profiles.length > 0 && (
            <div className="chatHeaderAvatars">
              {activeThread.member_profiles.slice(0, 8).map((p) => <MemberDot key={p.id} profile={p} size={28} />)}
              {activeThread.member_profiles.length > 8 && <span className="chatHeaderAvatarMore">+{activeThread.member_profiles.length - 8}</span>}
            </div>
          )}
          {view.kind === "channel" && channelMembers.length > 0 && (
            <div className="chatHeaderAvatars">
              {channelMembers.slice(0, 8).map((p) => <MemberDot key={p.id} profile={p} size={28} />)}
              {channelMembers.length > 8 && <span className="chatHeaderAvatarMore">+{channelMembers.length - 8}</span>}
            </div>
          )}
          <div style={{ flex: 1 }} />
          {view.kind === "channel" && (
            <button type="button" className="chatMembersBtn" onClick={() => setShowMembers((v) => !v)} title="Members">
              <span>&#128101;</span>
              <span className="chatMembersBtnCount">{channelMembers.length}</span>
            </button>
          )}
        </div>

        {error ? <div className="profileToast profileToastError" style={{ margin: "8px 16px 0" }}>{error}</div> : null}

        <div className="chatBodyRow">
          <div className="chatMessages" ref={scrollRef} onClick={() => { if (openEmojiPicker) setOpenEmojiPicker(null); }}>
            {currentGrouped.length === 0 ? (
              <div className="chatEmpty">
                <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }}>&#128172;</div>
                <div>{emptyLabel}</div>
                <div className="muted">Send a message below!</div>
              </div>
            ) : (
              currentGrouped.map((g) => (
                <div key={g.day}>
                  <div className="chatDayDivider"><span className="chatDayLabel">{g.day}</span></div>
                  {g.msgs.map((m: any) => {
                    const mUserId = m.user_id ?? m.sender_id;
                    return (
                      <MsgBubble key={m.id} msgId={m.id} userId={mUserId} body={m.body} taskId={m.task_id}
                        attachUrl={m.attachment_url} attachName={m.attachment_name} attachType={m.attachment_type}
                        time={m.created_at} isMe={mUserId === uid} />
                    );
                  })}
                </div>
              ))
            )}
            <div ref={bottomRef} style={{ height: 1, flexShrink: 0 }} />
          </div>

          {showMembers && view.kind === "channel" && (
            <div className="chatMembersPanel">
              <div className="chatMembersPanelHead">
                <span>Members</span>
                <span className="chatMembersPanelCount">{channelMembers.length}</span>
              </div>
              <div className="chatMembersPanelList">
                {channelMembers.map((p) => (
                  <button key={p.id} className="chatMemberItem" onClick={() => { if (p.id !== uid) startDm(p.id); }} title={p.id !== uid ? "Send direct message" : "You"}>
                    <div className="chatMemberAvatar" style={p.user_color ? { borderColor: p.user_color } : undefined}>{userInitials(p.display_name, p.email)}</div>
                    <div className="chatMemberName">{p.display_name || p.email?.split("@")[0] || "User"}</div>
                    {p.id === uid && <span className="chatMemberYou">you</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {showTaskPicker && (
          <div className="chatTaskPicker">
            <div className="chatTaskPickerHead">
              <span>Share a task</span>
              <button type="button" className="chatNewDmClose" onClick={() => setShowTaskPicker(false)}>&#10005;</button>
            </div>
            <input className="chatNewDmSearch" value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} placeholder="Search tasks…" autoFocus />
            <div className="chatTaskPickerList">
              {filteredTasks.map((t) => (
                <button key={t.id} className="chatTaskPickerItem" onClick={() => void sendWithMentions(t.id)}>
                  <div className="chatTaskPickerTitle">{t.title}</div>
                  <div className="chatTaskPickerMeta">{t.due_date ?? (t.is_asap ? "ASAP" : "No date")}{t.company ? ` · ${t.company}` : ""}</div>
                </button>
              ))}
              {filteredTasks.length === 0 && <div className="chatDmEmpty">No tasks found</div>}
            </div>
          </div>
        )}

        {pendingFile ? (
          <div className="chatPendingFile">
            <span className="chatPendingFileIcon">{isImageType(pendingFile.type) ? "🖼" : "📎"}</span>
            <span className="chatPendingFileName">{pendingFile.name}</span>
            <span className="muted">{humanSize(pendingFile.size)}</span>
            <button type="button" className="chatPendingFileRemove" onClick={clearFile}>&#10005;</button>
          </div>
        ) : null}

        {/* ── Mention autocomplete popup ── */}
        {mentionQuery !== null && mentionCandidates.length > 0 && (
          <div className="mentionPopup">
            {mentionCandidates.map((u, i) => (
              <button
                key={u.id}
                type="button"
                className={`mentionItem ${i === mentionIdx ? "mentionItemActive" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); insertMention(u); }}
              >
                <div className="mentionAvatar" style={u.user_color ? { borderColor: u.user_color } : undefined}>
                  {userInitials(u.display_name, u.email)}
                </div>
                <div className="mentionInfo">
                  <span className="mentionName">{u.display_name || u.email?.split("@")[0] || "User"}</span>
                  {u.email ? <span className="mentionEmail">{u.email}</span> : null}
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="chatComposer">
          <input type="file" ref={fileRef} style={{ display: "none" }} onChange={onFileSelect} accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip" />
          <button type="button" className="chatAttachBtn" onClick={() => fileRef.current?.click()} title="Attach file" disabled={sending}>&#128206;</button>
          <button type="button" className="chatAttachBtn chatTaskShareBtn" onClick={() => { if (!showTaskPicker) void loadAvailableTasks(); setShowTaskPicker((v) => !v); }} title="Share a task" disabled={sending}>&#9745;</button>
          <input
            ref={inputRef}
            className="chatInput"
            value={body}
            onChange={onInputChange}
            placeholder={placeholder}
            onKeyDown={onInputKeyDown}
            disabled={sending}
          />
          <button className="chatSendBtn" onClick={() => void sendWithMentions()} disabled={sending || (!body.trim() && !pendingFile)}>
            {uploading ? "Uploading…" : sending ? "…" : "Send"}
          </button>
        </div>
      </div>

      {/* ── Member hover popup ── */}
      {hoverMember && (() => {
        const popW = 170;
        const popLeft = Math.min(
          Math.max(8, hoverMember.rect.left + hoverMember.rect.width / 2),
          window.innerWidth - popW / 2 - 8
        );
        const fitsBelow = hoverMember.rect.bottom + 200 < window.innerHeight;
        const popTop = fitsBelow ? hoverMember.rect.bottom + 6 : hoverMember.rect.top - 6;
        const transformOrigin = fitsBelow ? "top center" : "bottom center";
        return (
        <div
          className="cMemberPopup"
          style={{ top: popTop, left: popLeft, transformOrigin, ...(fitsBelow ? {} : { transform: "translateX(-50%) translateY(-100%)" }) }}
          onMouseEnter={() => {/* keep open */}}
          onMouseLeave={() => setHoverMember(null)}
        >
          <div className="cMemberPopupDot" style={{ borderColor: hoverMember.profile.user_color || "#72c8ff" }}>
            {userInitials(hoverMember.profile.display_name, hoverMember.profile.email)}
          </div>
          <div className="cMemberPopupName">{hoverMember.profile.display_name || hoverMember.profile.email?.split("@")[0] || "User"}</div>
          {hoverMember.profile.email && <div className="cMemberPopupEmail">{hoverMember.profile.email}</div>}
        </div>
        );
      })()}
    </div>
  );
}
