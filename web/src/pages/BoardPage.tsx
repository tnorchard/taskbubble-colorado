import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import type {
  Profile,
  TaskStatus,
  TaskWithAge,
  TaskComment,
  AuditLogEntry,
  Workspace,
  WorkspaceMember,
} from "../types";

function hash(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatDue(d: string | null | undefined, isAsap?: boolean) {
  if (isAsap || !d) return "ASAP";
  const dt = new Date(d + "T00:00:00");
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(dt);
}

function formatAgeHours(age: number) {
  const h = Math.max(0, Math.floor(age));
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  const rem = h % 24;
  return rem ? `${days}d ${rem}h` : `${days}d`;
}

function initials(name: string) {
  const n = name.includes("@") ? name.split("@")[0] : name;
  const parts = n
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(" ")
    .filter(Boolean);
  const a = parts[0]?.[0] ?? "U";
  const b = parts[1]?.[0] ?? parts[0]?.[1] ?? "";
  return (a + b).toUpperCase();
}

type RowTask = TaskWithAge & {
  creator_profile?: Profile | null;
  completed_profile?: Profile | null;
  responsible_profile?: Profile | null;
};

type SimNode = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export function BoardPage() {
  const supabase = getSupabase();
  const nav = useNavigate();
  const { id } = useParams();
  const workspaceId = id ?? "";

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [tasks, setTasks] = useState<RowTask[]>([]);
  const [members, setMembers] = useState<
    Array<{ member: WorkspaceMember; profile: Profile | null }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Hover popup for member dots
  const [hoverMember, setHoverMember] = useState<{ profile: Profile; rect: DOMRect } | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<"due" | "title">("due");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [urgencyFilter, setUrgencyFilter] = useState<
    "all" | "asap" | "urgent"
  >("all");
  const [companyFilter, setCompanyFilter] = useState<Set<string>>(
    () => new Set(),
  );
  const [assignmentFilter, setAssignmentFilter] = useState<
    "all" | "mine" | "unassigned"
  >("all");

  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [asap, setAsap] = useState(false);
  const [description, setDescription] = useState("");
  const [responsibleId, setResponsibleId] = useState("");
  const COMPANY_PRESETS = ["BTB", "Panels", "TKO", "Eugene", "Bloomberg", "Media", "Other", "None"] as const;
  const [company, setCompany] = useState("");
  const [customCompany, setCustomCompany] = useState("");
  const [creating, setCreating] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editAsap, setEditAsap] = useState(false);
  const [editDescription, setEditDescription] = useState("");
  const [editResponsibleId, setEditResponsibleId] = useState("");
  const [editCompany, setEditCompany] = useState("");
  const [editCustomCompany, setEditCustomCompany] = useState("");
  const [busy, setBusy] = useState(false);

  const [viewMode, setViewMode] = useState<"board" | "list" | "people" | "kanban">("board");

  // Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(320);

  function onResizeStart(e: React.MouseEvent) {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartW.current = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = dragStartX.current - ev.clientX;
      const newW = Math.max(280, Math.min(600, dragStartW.current + delta));
      setSidebarWidth(newW);
    };
    const onUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const [popping, setPopping] = useState<Set<string>>(() => new Set());

  const [sidebarMode, setSidebarMode] = useState<"list" | "details" | "create">("list");

  // Task comments
  const [comments, setComments] = useState<(TaskComment & { profile?: Profile | null })[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [commentSending, setCommentSending] = useState(false);
  const commentsEndRef = useRef<HTMLDivElement>(null);

  // Audit log
  const [auditLog, setAuditLog] = useState<(AuditLogEntry & { actor_profile?: Profile | null })[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [showAudit, setShowAudit] = useState(false);

  // Kanban drag
  const [dragId, setDragId] = useState<string | null>(null);

  // Workspace quick-switch
  const [allWorkspaces, setAllWorkspaces] = useState<Array<{ id: string; name: string }>>([]);
  const [wsDropOpen, setWsDropOpen] = useState(false);

  useEffect(() => {
    if (selectedId) {
      setSidebarMode("details");
    }
  }, [selectedId]);

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data }) => setCurrentUserId(data.user?.id ?? null))
      .catch(() => setCurrentUserId(null));
  }, [supabase]);

  const userColors = useMemo(() => {
    const map = new Map<string, string>();
    const palette = [
      "#64b5ff", "#a885ff", "#ff85a1", "#ffb385",
      "#85ff9e", "#85fff3", "#ffeb85", "#ff85f3",
      "#ef4444", "#f97316", "#eab308", "#22c55e",
      "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
      "#f43f5e", "#d946ef", "#14b8a6", "#84cc16",
      "#6366f1", "#0ea5e9", "#f59e0b", "#10b981",
    ];
    let fallbackIdx = 0;
    members.forEach(({ member, profile }) => {
      const chosen = profile?.user_color;
      if (chosen) {
        map.set(member.user_id, chosen);
      } else {
        // Use position-based fallback so each member gets a distinct color
        map.set(member.user_id, palette[fallbackIdx % palette.length]);
        fallbackIdx++;
      }
    });
    return map;
  }, [members]);

  const selected = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId],
  );
  const createRef = useRef<HTMLDivElement | null>(null);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const bubbleEls = useRef<Map<string, HTMLButtonElement>>(new Map());
  const sim = useRef<Map<string, SimNode>>(new Map());
  const rafId = useRef<number | null>(null);
  const lastT = useRef<number>(0);

  const loadDebounce = useRef<number | null>(null);
  function scheduleLoad() {
    if (loadDebounce.current) window.clearTimeout(loadDebounce.current);
    loadDebounce.current = window.setTimeout(() => {
      void load();
    }, 250);
  }

  async function load() {
    setLoading(true);
    setError(null);

    const wsReq = supabase
      .from("workspaces")
      .select("id,name,created_at")
      .eq("id", workspaceId)
      .maybeSingle();

    // NOTE: We query from `tasks` (not `tasks_with_age`) to avoid hard dependency on view schema.
    // We'll compute `age_hours` client-side so the UI doesn't crash if a migration hasn't been applied yet.
    const tReq = supabase
      .from("tasks")
      .select("*")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("due_date", { ascending: true })
      .order("created_at", { ascending: false });

    const mReq = supabase
      .from("workspace_members")
      .select("workspace_id,user_id,role,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });

    const [
      { data: ws, error: wsErr },
      { data: t, error: tErr },
      { data: m, error: mErr },
    ] = await Promise.all([wsReq, tReq, mReq]);

    if (wsErr) setError(wsErr.message);
    if (tErr) setError(tErr.message);
    if (mErr) setError(mErr.message);

    setWorkspace((ws as Workspace) ?? null);

    const membersRaw = (m ?? []) as WorkspaceMember[];
    const userIds = Array.from(
      new Set([
        ...membersRaw.map((x) => x.user_id),
        ...(t ?? []).map((task: any) => task.created_by),
        ...(t ?? [])
          .map((task: any) => task.completed_by)
          .filter((id: any): id is string => Boolean(id)),
        ...(t ?? [])
          .map((task: any) => task.responsible_id)
          .filter((id: any): id is string => Boolean(id)),
      ]),
    );

    // Also load all workspaces for quick-switch
    supabase.from("workspaces").select("id,name").order("name").then(({ data: allWs }) => {
      setAllWorkspaces((allWs ?? []) as Array<{ id: string; name: string }>);
    });

    if (userIds.length) {
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id,email,display_name,avatar_url,user_color")
        .in("id", userIds);
      const profiles = (profilesData ?? []) as Profile[];
      const byId = new Map(profiles.map((p) => [p.id, p]));

      setMembers(
        membersRaw.map((mem) => ({
          member: mem,
          profile: byId.get(mem.user_id) ?? null,
        })),
      );
      const now = Date.now();
      setTasks(
        (t ?? []).map((task: any) => ({
          ...task,
          age_hours:
            typeof task.created_at === "string"
              ? (now - new Date(task.created_at).getTime()) / 3600000
              : 0,
          creator_profile: byId.get(task.created_by) ?? null,
          completed_profile: task.completed_by
            ? byId.get(task.completed_by) ?? null
            : null,
          responsible_profile: task.responsible_id
            ? byId.get(task.responsible_id) ?? null
            : null,
        })) as RowTask[],
      );
    } else {
      setMembers([]);
      const now = Date.now();
      setTasks(
        (t ?? []).map((task: any) => ({
          ...task,
          age_hours:
            typeof task.created_at === "string"
              ? (now - new Date(task.created_at).getTime()) / 3600000
              : 0,
        })) as RowTask[],
      );
    }

    setLoading(false);
  }

  useEffect(() => {
    if (!workspaceId) return;
    try {
      localStorage.setItem("tb:lastWorkspaceId", workspaceId);
    } catch {
      // ignore storage errors
    }
    void load();
  }, [workspaceId]);

  useEffect(() => {
    if (!selected) return;
    setEditTitle(selected.title);
    setEditDueDate(selected.due_date ?? "");
    setEditAsap(Boolean(selected.is_asap));
    setEditDescription(selected.description);
    setEditResponsibleId(selected.responsible_id ?? "");
    const co = selected.company ?? "";
    const isPreset = COMPANY_PRESETS.includes(co as any) || co === "";
    setEditCompany(isPreset ? co : "Other");
    setEditCustomCompany(isPreset ? "" : co);
    setIsEditing(false);
  }, [selected]);

  useEffect(() => {
    function handler() {
      createRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    window.addEventListener("tb:newTask", handler);
    return () => window.removeEventListener("tb:newTask", handler);
  }, []);

  // Realtime: keep everyone in sync on create/edit/complete.
  useEffect(() => {
    if (!workspaceId) return;

    const channel = supabase
      .channel(`tasks:${workspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => scheduleLoad(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, workspaceId]);

  async function createTask() {
    setCreating(true);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Not signed in.");

      const { error: e } = await supabase.from("tasks").insert({
        title: title.trim(),
        description: description.trim(),
        due_date: asap ? null : dueDate,
        created_by: uid,
        workspace_id: workspaceId,
        status: "open" satisfies TaskStatus,
        responsible_id: responsibleId || null,
        company: (company === "Other" ? customCompany.trim() : company === "None" ? "" : company) || null,
        is_asap: asap,
      });
      if (e) throw new Error(e.message);

      setTitle("");
      setDueDate("");
      setAsap(false);
      setDescription("");
      setResponsibleId("");
      setCompany("");
      setCustomCompany("");
      await logAudit("task_created", null, { title: title.trim() });
      // Notify responsible if assigned
      if (responsibleId && responsibleId !== uid) {
        try { await supabase.from("notifications").insert({ user_id: responsibleId, kind: "task_assigned", title: `You were assigned "${title.trim()}"`, workspace_id: workspaceId, actor_id: uid }); } catch { /* table may not exist */ }
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setCreating(false);
    }
  }

  async function updateTask() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase
        .from("tasks")
        .update({
          title: editTitle.trim(),
          due_date: editAsap ? null : editDueDate,
          description: editDescription.trim(),
          responsible_id: editResponsibleId || null,
          company: (editCompany === "Other" ? editCustomCompany.trim() : editCompany === "None" ? "" : editCompany) || null,
          is_asap: editAsap,
        })
        .eq("id", selected.id);
      if (e) throw new Error(e.message);
      await logAudit("task_updated", selected.id, { title: editTitle.trim() });
      // Notify if reassigned
      if (editResponsibleId && editResponsibleId !== selected.responsible_id && editResponsibleId !== currentUserId) {
        try { await supabase.from("notifications").insert({ user_id: editResponsibleId, kind: "task_assigned", title: `You were assigned "${editTitle.trim()}"`, workspace_id: workspaceId, actor_id: currentUserId }); } catch { /* ok */ }
      }
      setIsEditing(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTask() {
    if (!selected || !window.confirm("Delete this task?")) return;
    setBusy(true);
    setError(null);
    try {
      await logAudit("task_deleted", selected.id, { title: selected.title });
      const { error: e } = await supabase
        .from("tasks")
        .delete()
        .eq("id", selected.id);
      if (e) throw new Error(e.message);
      setSelectedId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function setTaskStatus(taskId: string, next: TaskStatus) {
    const prev = tasks.find((t) => t.id === taskId)?.status ?? "open";

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id ?? null;
    const nowIso = new Date().toISOString();
    const meProfile = uid
      ? members.find((m) => m.member.user_id === uid)?.profile ?? null
      : null;

    // Optimistic UI
    setTasks((cur) =>
      cur.map((t) =>
        t.id !== taskId
          ? t
          : next === "done"
            ? {
                ...t,
                status: next,
                completed_at: nowIso,
                completed_by: uid,
                completed_profile: meProfile,
              }
            : {
                ...t,
                status: next,
                completed_at: null,
                completed_by: null,
                completed_profile: null,
              },
      ),
    );

    // Pop effect when completing
    if (next === "done") {
      setPopping((s) => {
        const n = new Set(s);
        n.add(taskId);
        return n;
      });
      window.setTimeout(() => {
        setPopping((s) => {
          const n = new Set(s);
          n.delete(taskId);
          return n;
        });
      }, 360);
    }

    try {
      // Try to write completion metadata (requires migration 0006). If columns don't exist yet,
      // gracefully fall back to updating only the status so the app remains usable.
      const payload: Record<string, unknown> = { status: next };
      if (next === "done") {
        payload.completed_at = nowIso;
        payload.completed_by = uid;
      } else {
        payload.completed_at = null;
        payload.completed_by = null;
      }

      const { error: e1 } = await supabase.from("tasks").update(payload).eq("id", taskId);
      if (e1) {
        const msg = e1.message ?? "";
        const looksLikeMissingCols =
          msg.includes("completed_at") ||
          msg.includes("completed_by") ||
          msg.includes("column") ||
          msg.includes("does not exist");
        if (looksLikeMissingCols) {
          const { error: e2 } = await supabase
            .from("tasks")
            .update({ status: next })
            .eq("id", taskId);
          if (e2) throw new Error(e2.message);
          setError(
            "Completion tracking columns aren’t in your database yet. Apply migration `0006_add_task_completion_fields.sql` to see who completed tasks and when.",
          );
        } else {
          throw new Error(e1.message);
        }
      }
      await logAudit(next === "done" ? "task_completed" : "task_reopened", taskId, { from: prev, to: next });
      // Notify task creator on completion
      const theTask = tasks.find((t) => t.id === taskId);
      if (next === "done" && theTask?.created_by && theTask.created_by !== uid) {
        try { await supabase.from("notifications").insert({ user_id: theTask.created_by, kind: "task_completed", title: `"${theTask.title}" was completed`, workspace_id: workspaceId, actor_id: uid }); } catch { /* ok */ }
      }
      // No full reload — optimistic update already applied above
      setDragId(null);
    } catch (e) {
      // revert if update failed
      setTasks((cur) =>
        cur.map((t) => (t.id === taskId ? { ...t, status: prev } : t)),
      );
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }

  // ── Comments ──
  async function loadComments(taskId: string) {
    setCommentsLoading(true);
    const { data } = await supabase.from("task_comments").select("*").eq("task_id", taskId).order("created_at", { ascending: true });
    const rows = (data ?? []) as TaskComment[];
    const uids = Array.from(new Set(rows.map((c) => c.user_id)));
    let profMap = new Map<string, Profile>();
    if (uids.length) {
      const { data: profs } = await supabase.from("profiles").select("id,email,display_name,avatar_url,user_color").in("id", uids);
      ((profs ?? []) as Profile[]).forEach((p) => profMap.set(p.id, p));
    }
    setComments(rows.map((c) => ({ ...c, profile: profMap.get(c.user_id) ?? null })));
    setCommentsLoading(false);
    setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  useEffect(() => {
    if (selected) void loadComments(selected.id);
    else setComments([]);
  }, [selected?.id]);

  // Realtime comments
  useEffect(() => {
    if (!selected) return;
    const ch = supabase.channel(`comments:${selected.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "task_comments", filter: `task_id=eq.${selected.id}` },
        () => void loadComments(selected.id))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [selected?.id]);

  async function addComment() {
    if (!commentBody.trim() || !selected || !currentUserId) return;
    setCommentSending(true);
    await supabase.from("task_comments").insert({ task_id: selected.id, user_id: currentUserId, body: commentBody.trim() });
    // Also log audit
    try { await supabase.from("audit_log").insert({ workspace_id: workspaceId, task_id: selected.id, actor_id: currentUserId, action: "comment_added", details: { body: commentBody.trim().slice(0, 100) } }); } catch { /* ok */ }
    // Notify task creator/responsible
    const targets = new Set<string>();
    if (selected.created_by && selected.created_by !== currentUserId) targets.add(selected.created_by);
    if (selected.responsible_id && selected.responsible_id !== currentUserId) targets.add(selected.responsible_id);
    for (const uid of targets) {
      try { await supabase.from("notifications").insert({ user_id: uid, kind: "mention", title: `New comment on "${selected.title}"`, body: commentBody.trim().slice(0, 100), workspace_id: workspaceId, task_id: selected.id, actor_id: currentUserId }); } catch { /* ok */ }
    }
    setCommentBody("");
    setCommentSending(false);
  }

  // ── Audit log ──
  async function loadAuditLog() {
    setAuditLoading(true);
    const { data } = await supabase.from("audit_log").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(50);
    const rows = (data ?? []) as AuditLogEntry[];
    const uids = Array.from(new Set(rows.map((e) => e.actor_id).filter(Boolean) as string[]));
    let profMap = new Map<string, Profile>();
    if (uids.length) {
      const { data: profs } = await supabase.from("profiles").select("id,email,display_name,avatar_url,user_color").in("id", uids);
      ((profs ?? []) as Profile[]).forEach((p) => profMap.set(p.id, p));
    }
    setAuditLog(rows.map((e) => ({ ...e, actor_profile: e.actor_id ? profMap.get(e.actor_id) ?? null : null })));
    setAuditLoading(false);
  }

  // ── Audit helper ──
  async function logAudit(action: string, taskId?: string | null, details?: Record<string, unknown>) {
    if (!currentUserId) return;
    try { await supabase.from("audit_log").insert({ workspace_id: workspaceId, task_id: taskId ?? null, actor_id: currentUserId, action, details: details ?? {} }); } catch { /* ok */ }
  }

  // ── Kanban drag-drop ──
  function onDragStart(id: string) { setDragId(id); }
  async function onDropColumn(status: TaskStatus) {
    if (!dragId) return;
    const task = tasks.find((t) => t.id === dragId);
    if (!task || task.status === status) { setDragId(null); return; }
    await setTaskStatus(dragId, status);
    setDragId(null);
  }

  const filteredSorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = tasks
      .filter((t) => matchesUrgencyFilter(t))
      .filter((t) => matchesCompanyFilter(t))
      .filter((t) => matchesAssignmentFilter(t));

    const textFiltered = q
      ? list.filter((t) => {
          const titleMatch = t.title.toLowerCase().includes(q);
          const companyMatch = t.company?.toLowerCase().includes(q);
          const responsibleMatch =
            t.responsible_profile?.display_name?.toLowerCase().includes(q) ||
            t.responsible_profile?.email?.toLowerCase().includes(q);
          return titleMatch || companyMatch || responsibleMatch;
        })
      : list;

    return [...textFiltered].sort((a, b) => {
      // In list view, push completed tasks to the bottom
      if (viewMode === "list") {
        const aDone = a.status === "done" ? 1 : 0;
        const bDone = b.status === "done" ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
      }

      if (sortKey === "title") {
        const cmp = a.title.toLowerCase().localeCompare(b.title.toLowerCase());
        return sortDir === "asc" ? cmp : -cmp;
      }
      // Due sorting: ASAP first, then due date
      const aDue = a.is_asap ? "0000-00-00" : (a.due_date ?? "9999-12-31");
      const bDue = b.is_asap ? "0000-00-00" : (b.due_date ?? "9999-12-31");
      const dueCmp = aDue.localeCompare(bDue);
      if (dueCmp !== 0) return sortDir === "asc" ? dueCmp : -dueCmp;
      const cmp = b.created_at.localeCompare(a.created_at);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [
    tasks,
    query,
    sortKey,
    sortDir,
    urgencyFilter,
    companyFilter,
    assignmentFilter,
    currentUserId,
    viewMode,
  ]);

  const activeTasks = useMemo(
    () => filteredSorted.filter((t) => t.status !== "done"),
    [filteredSorted],
  );
  const completeTasks = useMemo(
    () => filteredSorted.filter((t) => t.status === "done"),
    [filteredSorted],
  );

  const completedTodayCount = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return tasks.filter(
      (t) =>
        t.status === "done" &&
        new Date((t.completed_at ?? t.updated_at ?? t.created_at) as string).getTime() >=
          startOfToday.getTime(),
    ).length;
  }, [tasks]);

  // Bubbles: hide done tasks (except while popping).
  const bubbleTasks = useMemo(
    () => filteredSorted.filter((t) => t.status !== "done" || popping.has(t.id)),
    [filteredSorted, popping],
  );

  // Stable layout ordering for physics anchor points.
  const layoutOrder = useMemo(() => {
    const now = Date.now();
    return [...bubbleTasks].sort((a, b) => {
      // bias urgent closer to center via anchor ordering
      const aDue = a.is_asap || !a.due_date ? 0 : new Date(a.due_date).getTime();
      const bDue = b.is_asap || !b.due_date ? 0 : new Date(b.due_date).getTime();
      const aDays = Math.ceil((aDue - now) / (1000 * 60 * 60 * 24));
      const bDays = Math.ceil((bDue - now) / (1000 * 60 * 60 * 24));
      if (aDays !== bDays) return aDays - bDays;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [bubbleTasks]);

  const layoutIndex = useMemo(() => {
    const m = new Map<string, number>();
    layoutOrder.forEach((t, i) => m.set(t.id, i));
    return m;
  }, [layoutOrder]);

  function urgencyLevel(t: RowTask) {
    // ASAP tasks are always max urgency.
    if (t.is_asap || !t.due_date) return 1;

    const created = new Date(t.created_at).getTime();
    const due = new Date(t.due_date + "T00:00:00").getTime();
    const now = Date.now();

    if (!Number.isFinite(created) || !Number.isFinite(due)) return 0;
    if (due <= now) return 1;

    // Step size = (due - created) / 20 (e.g., if that equals ~3h, intensity increases every ~3h).
    const total = Math.max(1, due - created);
    const elapsed = clamp(now - created, 0, total);
    const raw = elapsed / total; // 0..1
    const steps = 20;
    const stepped = Math.round(raw * steps) / steps;
    return clamp(stepped, 0, 1);
  }

  function urgencyColor(u: number) {
    // Interpolate from warm amber (low urgency) -> deep blood-red (high urgency)
    const t = clamp(u, 0, 1);
    const r = Math.round(255);
    const g = Math.round(180 - t * 170); // 180 -> 10
    const b = Math.round(80 - t * 75);  // 80  -> 5
    return `rgba(${r}, ${g}, ${b}, ${0.55 + t * 0.35})`;
  }

  function matchesUrgencyFilter(t: RowTask) {
    if (urgencyFilter === "all") return true;
    if (urgencyFilter === "asap") return Boolean(t.is_asap);
    if (t.is_asap) return false;

    const u = urgencyLevel(t);
    if (urgencyFilter === "urgent") return u >= 0.7;
    // "soon" and "later" removed
    return true;
  }

  function matchesCompanyFilter(t: RowTask) {
    if (companyFilter.size === 0) return true;
    if (!t.company) return false;
    return companyFilter.has(t.company);
  }

  function matchesAssignmentFilter(t: RowTask) {
    if (assignmentFilter === "all") return true;
    if (assignmentFilter === "mine") {
      return Boolean(currentUserId && t.responsible_id === currentUserId);
    }
    if (assignmentFilter === "unassigned") return !t.responsible_id;
    return true;
  }

  /** Age-based redness: the longer a task has existed, the redder it gets.
   *  Starts tinting after 12h, fully red by ~7 days. */
  function ageRedTint(ageHours: number): number {
    return clamp((ageHours - 12) / (7 * 24 - 12), 0, 1); // 0..1
  }

  function bubbleVisual(t: RowTask) {
    const now = Date.now();
    const dueMs =
      t.is_asap || !t.due_date ? now : new Date(t.due_date + "T00:00:00").getTime();
    const daysUntilDue = Math.ceil((dueMs - now) / (1000 * 60 * 60 * 24));

    // Blend urgency + age to decide redness
    const ageFactor = ageRedTint(t.age_hours);
    const redFactor = Math.max(urgencyLevel(t), ageFactor);
    const isAsap = Boolean(t.is_asap);

    // Size: base + age growth (old tasks grow up to 10px bigger)
    const size = clamp(98 - daysUntilDue * 5 + ageFactor * 10, 60, 130);

    let color: string | undefined;

    if (t.responsible_id) {
      const base = userColors.get(t.responsible_id) ?? "rgba(100,181,255,0.6)";

      if (ageFactor > 0.1) {
        color = `color-mix(in srgb, ${base} ${Math.round((1 - ageFactor * 0.6) * 100)}%, ${urgencyColor(redFactor)})`;
      } else {
        color = base;
      }
    } else {
      color = urgencyColor(redFactor);
    }

    return { size, r: size / 2, color, u: redFactor, isAsap };
  }

  // Physics loop: bounce off walls + bounce off each other + gently pull toward a grid anchor.
  useEffect(() => {
    if (viewMode !== "board") return;
    const el = canvasRef.current;
    if (!el) return;

    // Clean up any nodes for tasks that are no longer visible
    const visibleIds = new Set(layoutOrder.map((t) => t.id));
    for (const id of sim.current.keys()) {
      if (!visibleIds.has(id)) sim.current.delete(id);
    }

    function ensureNode(
      id: string,
      i: number,
      n: number,
      w: number,
      h: number,
    ) {
      if (sim.current.has(id)) return;
      const cols = Math.max(2, Math.ceil(Math.sqrt(n)));
      const rows = Math.ceil(n / cols);
      const marginX = 20;
      const marginY = 24;
      const cellW = (w - marginX * 2) / cols;
      const cellH = (h - marginY * 2) / rows;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const hh = hash(workspaceId + id);
      const jx = ((hh % 1000) / 1000 - 0.5) * cellW * 0.35;
      const jy = (((hh / 1000) % 1000) / 1000 - 0.5) * cellH * 0.35;
      const x = marginX + cellW * (col + 0.5) + jx;
      const y = marginY + cellH * (row + 0.5) + jy;
      const vx = ((hh % 2 === 0 ? 1 : -1) * (60 + (hh % 80))) as number;
      const vy = (((hh / 3) % 2 === 0 ? 1 : -1) *
        (60 + ((hh / 7) % 80))) as number;
      sim.current.set(id, { x, y, vx, vy });
    }

    function step(t: number) {
      // When switching views or during load() we briefly unmount the canvas.
      // Keep the RAF alive so bubbles resume instantly when the canvas reappears.
      if (!canvasRef.current) {
        rafId.current = window.requestAnimationFrame(step);
        return;
      }
      const rect = canvasRef.current.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w <= 10 || h <= 10) {
        rafId.current = window.requestAnimationFrame(step);
        return;
      }

      const dt = lastT.current
        ? Math.min(0.033, (t - lastT.current) / 1000)
        : 0.016;
      lastT.current = t;

      const ids = layoutOrder.map((x) => x.id);
      const n = Math.max(1, ids.length);

      // Create nodes for any new bubbles
      for (let i = 0; i < ids.length; i++) ensureNode(ids[i], i, n, w, h);

      // Precompute radii and anchor points
      const cols = Math.max(2, Math.ceil(Math.sqrt(n)));
      const rows = Math.ceil(n / cols);
      const marginX = 20;
      const marginY = 24;
      const cellW = (w - marginX * 2) / cols;
      const cellH = (h - marginY * 2) / rows;

      const rById = new Map<string, number>();
      const anchorById = new Map<string, { ax: number; ay: number }>();

      for (const task of layoutOrder) {
        const { r } = bubbleVisual(task);
        rById.set(task.id, r);
        const idx = layoutIndex.get(task.id) ?? 0;
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const hh = hash(workspaceId + task.id);
        const jx = ((hh % 1000) / 1000 - 0.5) * cellW * 0.18;
        const jy = (((hh / 1000) % 1000) / 1000 - 0.5) * cellH * 0.18;
        const ax = marginX + cellW * (col + 0.5) + jx;
        const ay = marginY + cellH * (row + 0.5) + jy;
        anchorById.set(task.id, { ax, ay });
      }

      // Integrate
      for (const id of ids) {
        const node = sim.current.get(id);
        if (!node) continue;
        const r = rById.get(id) ?? 50;
        const anchor = anchorById.get(id);

        // spring toward anchor (gentle pull so bubbles stay in zone)
        const k = 1.8;
        if (anchor) {
          node.vx += (anchor.ax - node.x) * k * dt;
          node.vy += (anchor.ay - node.y) * k * dt;
        }

        // perpetual drift (Lissajous-ish, multi-frequency for organic feel)
        const hh = hash(workspaceId + id + "swirl");
        const phase = (hh % 1000) / 1000 * Math.PI * 2;
        const amp = 30 + ((hh / 9) % 20); // stronger than before
        const tt = t / 1000;
        node.vx += Math.sin(tt * 1.1 + phase) * amp * dt;
        node.vy += Math.cos(tt * 0.85 + phase * 1.3) * amp * dt;
        // secondary wobble
        node.vx += Math.cos(tt * 0.6 + phase * 2.1) * (amp * 0.35) * dt;
        node.vy += Math.sin(tt * 0.7 + phase * 0.7) * (amp * 0.35) * dt;

        // Very light damping — keep them lively
        node.vx *= 0.997;
        node.vy *= 0.997;

        node.x += node.vx * dt;
        node.y += node.vy * dt;

        // walls
        if (node.x < r) {
          node.x = r;
          node.vx = Math.abs(node.vx) * 0.92;
        }
        if (node.x > w - r) {
          node.x = w - r;
          node.vx = -Math.abs(node.vx) * 0.92;
        }
        if (node.y < r) {
          node.y = r;
          node.vy = Math.abs(node.vy) * 0.92;
        }
        if (node.y > h - r) {
          node.y = h - r;
          node.vy = -Math.abs(node.vy) * 0.92;
        }
      }

      // Collisions (a couple relaxation passes for stability)
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const aId = ids[i];
            const bId = ids[j];
            const a = sim.current.get(aId);
            const b = sim.current.get(bId);
            if (!a || !b) continue;
            const ar = rById.get(aId) ?? 50;
            const br = rById.get(bId) ?? 50;

            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy) || 0.0001;
            const minDist = ar + br + 2;
            if (dist >= minDist) continue;

            const nx = dx / dist;
            const ny = dy / dist;
            const overlap = minDist - dist;

            // Separate
            a.x -= nx * (overlap / 2);
            a.y -= ny * (overlap / 2);
            b.x += nx * (overlap / 2);
            b.y += ny * (overlap / 2);

            // Bounce (elastic-ish)
            const rvx = b.vx - a.vx;
            const rvy = b.vy - a.vy;
            const relAlongN = rvx * nx + rvy * ny;
            if (relAlongN > 0) continue;

            const restitution = 0.9;
            const impulse = (-(1 + restitution) * relAlongN) / 2;
            const ix = impulse * nx;
            const iy = impulse * ny;
            a.vx -= ix;
            a.vy -= iy;
            b.vx += ix;
            b.vy += iy;
          }
        }
      }

      // Paint DOM
      for (const id of ids) {
        const node = sim.current.get(id);
        const btn = bubbleEls.current.get(id);
        const r = rById.get(id) ?? 50;
        if (!node || !btn) continue;
        btn.style.setProperty("--x", `${node.x - r}px`);
        btn.style.setProperty("--y", `${node.y - r}px`);
      }

      rafId.current = window.requestAnimationFrame(step);
    }

    rafId.current = window.requestAnimationFrame(step);

    return () => {
      if (rafId.current) window.cancelAnimationFrame(rafId.current);
      rafId.current = null;
      lastT.current = 0;
    };
  }, [layoutOrder, layoutIndex, workspaceId, viewMode]);

  const onToggleSort = (key: "due" | "title") => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const toggleCompanyChip = (c: string) => {
    setCompanyFilter((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const anyFilterActive = urgencyFilter !== "all" || assignmentFilter !== "all" || companyFilter.size > 0;
  const uniqueCompanies = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => { if (t.company) set.add(t.company); });
    return Array.from(set).sort();
  }, [tasks]);

  if (loading) {
    return (
      <div className="screen">
        <div className="screenInner">
          <div className="panel">Loading…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bpScreen">
      {/* ── Compact header ── */}
      <div className="bpHeader">
        <div className="bpHeaderLeft">
          <div className="bpWsNameWrap">
            <div className="bpWsName">{workspace?.name ?? "Board"}</div>
            {allWorkspaces.length > 1 ? (
              <button type="button" className="bpWsCaret" onClick={() => setWsDropOpen((v) => !v)} title="Switch workspace">
                {wsDropOpen ? "▲" : "▼"}
              </button>
            ) : null}
            {wsDropOpen ? (
              <div className="bpWsDropdown">
                {allWorkspaces.filter((w) => w.id !== workspaceId).map((w) => (
                  <button key={w.id} type="button" className="bpWsDropItem"
                    onClick={() => { setWsDropOpen(false); nav(`/w/${w.id}`); }}>
                    {w.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="bpStats">
            <span><b>{members.length}</b> members</span>
            <span className="bpStatDot" />
            <span><b>{activeTasks.length}</b> active</span>
            <span className="bpStatDot" />
            <span><b>{completedTodayCount}</b> done today</span>
          </div>
        </div>
        <div className="bpHeaderRight">
          <div className="bpMembers">
            {members.slice(0, 8).map(({ profile, member }) => (
              <div
                key={member.user_id}
                className="bpMemberDot"
                style={{ borderColor: userColors.get(member.user_id) || "rgba(255,255,255,0.2)" }}
                onMouseEnter={(e) => {
                  if (profile) {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setHoverMember({ profile, rect });
                  }
                }}
                onMouseLeave={() => setHoverMember((prev) => prev?.profile.id === profile?.id ? null : prev)}
              >
                {initials(profile?.display_name ?? profile?.email ?? member.user_id)}
              </div>
            ))}
            {members.length > 8 ? <div className="bpMemberMore">+{members.length - 8}</div> : null}
          </div>
        </div>
      </div>

      {error ? <div className="profileToast profileToastError" style={{ margin: "0 auto 8px", maxWidth: 1320 }}>{error}</div> : null}

      {/* ── Filter bar ── */}
      <div className="bpFilters">
        <div className="bpFilterRow">
          {/* View switcher */}
          <div className="bpFilterGroup">
            <div className="bpFilterLabel">View</div>
            <div className="bpViewTabs">
              {([["board", "Bubbles"], ["kanban", "Kanban"], ["list", "List"], ["people", "People"]] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={`bpViewTab ${viewMode === v ? "active" : ""}`}
                  onClick={() => setViewMode(v as any)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="bpFilterSep" />

          {/* Urgency */}
          <div className="bpFilterGroup">
            <div className="bpFilterLabel">Urgency</div>
            <div className="bpChipGroup">
              {["all", "asap", "urgent"].map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`bpChip ${urgencyFilter === v ? "active" : ""} ${v === "urgent" ? "danger" : ""}`}
                  onClick={() => setUrgencyFilter(v as any)}
                >
                  {v === "all" ? "All" : v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="bpFilterSep" />

          {/* Assignment */}
          <div className="bpFilterGroup">
            <div className="bpFilterLabel">Assigned</div>
            <div className="bpChipGroup">
              <button
                type="button"
                className={`bpChip ${assignmentFilter === "mine" ? "active" : ""}`}
                onClick={() => setAssignmentFilter((v) => (v === "mine" ? "all" : "mine"))}
              >
                Mine
              </button>
              <button
                type="button"
                className={`bpChip ${assignmentFilter === "unassigned" ? "active" : ""}`}
                onClick={() => setAssignmentFilter((v) => (v === "unassigned" ? "all" : "unassigned"))}
              >
                Unassigned
              </button>
            </div>
          </div>

          {/* Company chips */}
          {uniqueCompanies.length > 0 ? (
            <>
              <div className="bpFilterSep" />
              <div className="bpFilterGroup">
                <div className="bpFilterLabel">Company</div>
                <div className="bpChipGroup">
                  {uniqueCompanies.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`bpChip bpChipCo ${companyFilter.has(c) ? "active" : ""}`}
                      onClick={() => toggleCompanyChip(c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          <div style={{ flex: 1 }} />

          {anyFilterActive ? (
            <button
              type="button"
              className="bpChip bpChipReset"
              onClick={() => {
                setUrgencyFilter("all");
                setAssignmentFilter("all");
                setCompanyFilter(new Set());
              }}
            >
              Clear filters
            </button>
          ) : null}

          <button className="bpRefresh" onClick={() => void load()} type="button" title="Refresh">
            &#8635;
          </button>
        </div>
      </div>

      {/* ── Main grid: canvas + sidebar ── */}
      <div className="bpGrid">
        <div className="bpCanvas">
          {viewMode === "board" ? (
            <div className="bubbleCanvas" ref={canvasRef}>
              <div className="gridOverlay" aria-hidden="true" />
              {layoutOrder.map((t) => {
                const { size, color, u, isAsap } = bubbleVisual(t);
                const isPop = popping.has(t.id);
                const urgent = u >= 0.15;
                const showFire = isAsap || u >= 0.85;
                return (
                  <button
                    key={t.id}
                    ref={(node) => {
                      if (!node) bubbleEls.current.delete(t.id);
                      else {
                        bubbleEls.current.set(t.id, node);
                        const simNode = sim.current.get(t.id);
                        if (simNode) {
                          const r = size / 2;
                          node.style.setProperty("--x", `${simNode.x - r}px`);
                          node.style.setProperty("--y", `${simNode.y - r}px`);
                        }
                      }
                    }}
                    className={`taskBubble ${urgent ? "urgent" : ""} ${showFire ? "onFire" : ""} ${t.id === selectedId ? "selected" : ""} ${isPop ? "popping" : ""}`}
                    onClick={() => setSelectedId(t.id)}
                    style={
                      {
                        width: `${size}px`,
                        height: `${size}px`,
                        ["--user-color" as never]: color,
                        ["--urgency" as never]: u,
                        ["--throbDur" as never]: `${Math.max(1.0, 5 - u * 4)}s`,
                        ["--shakeDur" as never]: `${Math.max(0.3, 1.2 - u * 1)}s`,
                        ["--shakeAmp" as never]: `${(0.3 + u * 1.0).toFixed(1)}px`,
                      } as never
                    }
                    type="button"
                  >
                    {/* Fire ring for ASAP / very urgent */}
                    {showFire ? <div className="bubbleFireRing" aria-hidden="true" /> : null}
                    <div className="bubbleInner">
                      <div className="bubbleLabel">{t.title}</div>
                      <div className="bubbleMeta">
                        {t.company ? `${t.company} · ` : ""}
                        {formatAgeHours(t.age_hours)} · {formatDue(t.due_date, t.is_asap)}
                      </div>
                    </div>
                  </button>
                );
              })}
              {layoutOrder.length === 0 ? (
                <div className="emptyCenter">
                  <div className="emptyTitle">No tasks yet</div>
                  <div className="muted">Create a task and watch it float.</div>
                </div>
              ) : null}
            </div>
          ) : viewMode === "kanban" ? (
            <div className="kanbanCanvas">
              {(["open", "in_progress", "done"] as const).map((col) => {
                const colTasks = filteredSorted.filter((t) => t.status === col);
                const label = col === "open" ? "To Do" : col === "in_progress" ? "In Progress" : "Done";
                return (
                  <div
                    key={col}
                    className={`kanbanCol ${dragId ? "kanbanColDrop" : ""}`}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("kanbanColOver"); }}
                    onDragLeave={(e) => e.currentTarget.classList.remove("kanbanColOver")}
                    onDrop={(e) => { e.currentTarget.classList.remove("kanbanColOver"); void onDropColumn(col); }}
                  >
                    <div className="kanbanColHead">
                      <span className={`kanbanColDot kanbanDot-${col}`} />
                      <span className="kanbanColLabel">{label}</span>
                      <span className="kanbanColCount">{colTasks.length}</span>
                    </div>
                    <div className="kanbanColBody">
                      {colTasks.map((t) => (
                        <div
                          key={t.id}
                          className={`kanbanCard ${t.id === selectedId ? "active" : ""}`}
                          draggable
                          onDragStart={() => onDragStart(t.id)}
                          onDragEnd={() => setDragId(null)}
                          onClick={() => setSelectedId(t.id)}
                        >
                          <div className="kanbanCardTitle">{t.title}</div>
                          <div className="kanbanCardMeta">
                            <span>{formatDue(t.due_date, t.is_asap)}</span>
                            {t.company ? <><span className="bpStatDot" /><span>{t.company}</span></> : null}
                            {t.responsible_profile ? (
                              <><span className="bpStatDot" /><span>{t.responsible_profile.display_name ?? t.responsible_profile.email}</span></>
                            ) : null}
                          </div>
                        </div>
                      ))}
                      {colTasks.length === 0 ? <div className="kanbanEmpty">Drop tasks here</div> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : viewMode === "list" ? (
            <div className="listViewCanvas">
              <div className="listViewHeader">
                <div className="listViewTitle">Task List</div>
                <div className="muted">{filteredSorted.length} tasks</div>
              </div>
              <div className="listViewScroll">
                {filteredSorted.map((t) => (
                  <div
                    key={t.id}
                    className={`listViewRow ${t.id === selectedId ? "active" : ""} ${t.status === "done" ? "done" : ""}`}
                    onClick={() => setSelectedId(t.id)}
                  >
                    <div className="listViewStatus">
                      <button
                        type="button"
                        className={`statusCircle ${t.status}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void setTaskStatus(t.id, t.status === "done" ? "open" : "done");
                        }}
                      >
                        {t.status === "done" ? "✓" : ""}
                      </button>
                    </div>
                    <div className="listViewContent">
                      <div className="listViewMain">
                        <div className="listViewTaskTitle">{t.title}</div>
                        {t.is_asap && <span className="asapBadge">ASAP</span>}
                      </div>
                      <div className="listViewMeta">
                        <span className="metaItem">{formatDue(t.due_date, t.is_asap)}</span>
                        <span className="metaItem">{formatAgeHours(t.age_hours)}</span>
                        {t.company && <span className="metaItem company">{t.company}</span>}
                        {t.responsible_profile && (
                          <span className="metaItem">
                            {t.responsible_profile.display_name ?? t.responsible_profile.email}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="listViewChevron">&#8250;</div>
                  </div>
                ))}
                {filteredSorted.length === 0 && (
                  <div className="emptyCenter">
                    <div className="emptyTitle">No tasks found</div>
                    <div className="muted">Try adjusting your filters.</div>
                  </div>
                )}
              </div>
            </div>
          ) : viewMode === "people" ? (
            <div className="peopleViewCanvas">
              <div className="peopleViewScroll horizontallyScrollable">
                {members.map(({ profile, member }) => {
                  const personTasks = filteredSorted.filter(
                    (t) => t.responsible_id === member.user_id
                  );
                  const color = userColors.get(member.user_id) || "var(--primary)";
                  
                  return (
                    <div key={member.user_id} className="personColumn">
                      <div className="personHeader" style={{ ["--user-color" as any]: color }}>
                        <div className="personAvatar">
                          {initials(profile?.display_name ?? profile?.email ?? member.user_id)}
                        </div>
                        <div className="personInfo">
                          <div className="personName">
                            {profile?.display_name ?? profile?.email?.split("@")[0] ?? "User"}
                          </div>
                          <div className="personTaskCount">{personTasks.length} tasks</div>
                        </div>
                      </div>
                      <div className="personTasksScroll">
                        {personTasks.map((t) => (
                          <div
                            key={t.id}
                            className={`personTaskCard ${t.id === selectedId ? "active" : ""} ${t.status === "done" ? "done" : ""}`}
                            onClick={() => setSelectedId(t.id)}
                          >
                            <div className="personTaskTitle">{t.title}</div>
                            <div className="personTaskMeta">
                              <span className="personTaskChip">{formatDue(t.due_date, t.is_asap)}</span>
                              {t.company && <span className="personTaskChip company">{t.company}</span>}
                            </div>
                          </div>
                        ))}
                        {personTasks.length === 0 && (
                          <div className="personEmpty">No tasks assigned</div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {filteredSorted.some(t => !t.responsible_id) && (
                  <div className="personColumn unassigned">
                    <div className="personHeader">
                      <div className="personAvatar">?</div>
                      <div className="personInfo">
                        <div className="personName">Unassigned</div>
                        <div className="personTaskCount">
                          {filteredSorted.filter(t => !t.responsible_id).length} tasks
                        </div>
                      </div>
                    </div>
                    <div className="personTasksScroll">
                      {filteredSorted
                        .filter(t => !t.responsible_id)
                        .map((t) => (
                          <div
                            key={t.id}
                            className={`personTaskCard ${t.id === selectedId ? "active" : ""} ${t.status === "done" ? "done" : ""}`}
                            onClick={() => setSelectedId(t.id)}
                          >
                            <div className="personTaskTitle">{t.title}</div>
                            <div className="personTaskMeta">
                              <span className="personTaskChip">{formatDue(t.due_date, t.is_asap)}</span>
                              {t.company && <span className="personTaskChip company">{t.company}</span>}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* ── Resize handle ── */}
        <div className="bpResizeHandle" onMouseDown={onResizeStart} title="Drag to resize" />

        {/* ── Sidebar ── */}
        <div className="bpSidebar" style={{ width: sidebarWidth, minWidth: 280, maxWidth: 600, flexShrink: 0 }}>
          <div className="bpSidebarTabs">
            <button
              className={`bpSideTab ${sidebarMode === "list" ? "active" : ""}`}
              onClick={() => setSidebarMode("list")}
            >
              Tasks
            </button>
            <button
              className={`bpSideTab ${sidebarMode === "details" ? "active" : ""} ${!selected ? "disabled" : ""}`}
              onClick={() => selected && setSidebarMode("details")}
              disabled={!selected}
            >
              Details
            </button>
            <button
              className={`bpSideTab ${sidebarMode === "create" ? "active" : ""}`}
              onClick={() => setSidebarMode("create")}
            >
              + New
            </button>
          </div>

          <div className="bpSideBody">
            {sidebarMode === "list" && (
              <>
                <div className="bpSideControls">
                  <div className="segmented">
                    <button type="button" className={`segBtn ${sortKey === "due" ? "active" : ""}`} onClick={() => onToggleSort("due")}>
                      Due {sortKey === "due" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                    </button>
                    <button type="button" className={`segBtn ${sortKey === "title" ? "active" : ""}`} onClick={() => onToggleSort("title")}>
                      Title {sortKey === "title" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                    </button>
                  </div>
                </div>
                <input
                  className="bpSearch"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search tasks…"
                />
                <div className="bpTaskSection">
                  <div className="bpTaskSectionHead">
                    <span>Active</span><span className="bpTaskSectionCount">{activeTasks.length}</span>
                  </div>
                  <div className="bpTaskScroll">
                    {activeTasks.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={`bpTaskRow ${t.id === selectedId ? "active" : ""}`}
                        onClick={() => setSelectedId(t.id)}
                      >
                        <div className="bpTaskRowTitle">{t.title}</div>
                        <div className="bpTaskRowMeta">
                          <span className="bpTaskChip">{formatDue(t.due_date, t.is_asap)}</span>
                          {t.company ? <span className="bpTaskChip co">{t.company}</span> : null}
                        </div>
                      </button>
                    ))}
                    {activeTasks.length === 0 && <div className="muted" style={{ padding: 12 }}>No active tasks.</div>}
                  </div>
                </div>
                <div className="bpTaskSection">
                  <div className="bpTaskSectionHead">
                    <span>Complete</span><span className="bpTaskSectionCount">{completeTasks.length}</span>
                  </div>
                  <div className="bpTaskScroll">
                    {completeTasks.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={`bpTaskRow done ${t.id === selectedId ? "active" : ""}`}
                        onClick={() => setSelectedId(t.id)}
                      >
                        <div className="bpTaskRowTitle">{t.title}</div>
                        <div className="bpTaskRowMeta">
                          <span className="bpTaskChip">{formatDue(t.due_date, t.is_asap)}</span>
                        </div>
                      </button>
                    ))}
                    {completeTasks.length === 0 && <div className="muted" style={{ padding: 12 }}>Nothing yet.</div>}
                  </div>
                </div>
              </>
            )}

            {sidebarMode === "details" && selected && (
              <div className="bpDetailCard">
                <div className="bpDetailTop">
                  <div className={`statusPill ${selected.status}`}>
                    {selected.status === "done" ? "✓ Complete" : "○ Active"}
                  </div>
                  {urgencyLevel(selected) >= 0.7 && selected.status !== "done" && (
                    <div className="urgentPill">Urgent</div>
                  )}
                  {!isEditing && (
                    <button className="bpChip" style={{ marginLeft: "auto" }} onClick={() => setIsEditing(true)}>Edit</button>
                  )}
                </div>

                {isEditing ? (
                  <div className="bpEditForm">
                    <label className="field"><div className="fieldLabel">Title</div>
                      <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} /></label>
                    <label className="field"><div className="fieldLabel">Due date</div>
                      <input value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} type="date" disabled={editAsap} /></label>
                    <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <input type="checkbox" checked={editAsap} onChange={(e) => setEditAsap(e.target.checked)} style={{ width: "auto" }} />
                      <span className="fieldLabel" style={{ margin: 0 }}>ASAP</span></label>
                    <label className="field"><div className="fieldLabel">Description</div>
                      <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} /></label>
                    <label className="field"><div className="fieldLabel">Responsible</div>
                      <select value={editResponsibleId} onChange={(e) => setEditResponsibleId(e.target.value)}>
                        <option value="">Any</option>
                        {members.map(({ profile, member }) => (
                          <option key={member.user_id} value={member.user_id}>
                            {profile?.display_name ?? profile?.email ?? member.user_id}
                          </option>
                        ))}
                      </select></label>
                    <label className="field"><div className="fieldLabel">Company</div>
                      <select value={editCompany} onChange={(e) => setEditCompany(e.target.value)}>
                        <option value="">Select…</option>
                        {COMPANY_PRESETS.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select></label>
                    {editCompany === "Other" ? (
                      <label className="field"><div className="fieldLabel">Custom Company</div>
                        <input value={editCustomCompany} onChange={(e) => setEditCustomCompany(e.target.value)} placeholder="Enter company name" /></label>
                    ) : null}
                    <div className="bpEditActions">
                      <button className="primaryBtn" onClick={updateTask} disabled={busy}>Save</button>
                      <button className="bpChip" onClick={() => setIsEditing(false)}>Cancel</button>
                      <div style={{ flex: 1 }} />
                      <button className="adminDeleteBtn" onClick={deleteTask}>Delete</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="bpDetailTitle">{selected.title}</div>
                    <div className="bpDetailChips">
                      <span className="bpDetailChip bpDetailChipDue">
                        <span className="bpDetailChipIcon">&#128197;</span>
                        {formatDue(selected.due_date, selected.is_asap)}
                      </span>
                      {selected.company ? (
                        <span className="bpDetailChip bpDetailChipCompany">
                          <span className="bpDetailChipIcon">&#127970;</span>
                          {selected.company}
                        </span>
                      ) : null}
                      {selected.responsible_profile ? (
                        <span className="bpDetailChip bpDetailChipPerson" style={{ borderColor: userColors.get(selected.responsible_id ?? "") ?? "var(--border)" }}>
                          <span className="bpDetailChipIcon">&#128100;</span>
                          {selected.responsible_profile.display_name ?? selected.responsible_profile.email}
                        </span>
                      ) : null}
                      <span className={`bpDetailChip bpDetailChipStatus ${selected.status}`}>
                        {selected.status === "done" ? "✓ Done" : selected.status === "in_progress" ? "◐ In Progress" : "○ Open"}
                      </span>
                    </div>
                    {selected.description ? <div className="bpDetailDesc">{selected.description}</div> : null}
                    <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {selected.status === "done" ? (
                        <button className="secondaryBtn" onClick={() => void setTaskStatus(selected.id, "open")}>Reopen</button>
                      ) : (
                        <button className="primaryBtn" onClick={() => void setTaskStatus(selected.id, "done")}>Mark complete</button>
                      )}
                    </div>

                    {/* Comments */}
                    <div className="bpCommentsSection">
                      <div className="bpCommentsSectionHead">
                        <span>Comments</span>
                        <span className="bpTaskSectionCount">{comments.length}</span>
                      </div>
                      {commentsLoading ? <div className="muted" style={{ padding: 8, fontSize: 12 }}>Loading…</div> : (
                        <div className="bpCommentsList">
                          {comments.map((c) => (
                            <div key={c.id} className="bpCommentRow">
                              <div className="bpCommentAvatar">
                                {initials(c.profile?.display_name ?? c.profile?.email ?? "U")}
                              </div>
                              <div className="bpCommentBody">
                                <div className="bpCommentMeta">
                                  <span className="bpCommentAuthor">{c.profile?.display_name ?? c.profile?.email?.split("@")[0] ?? "User"}</span>
                                  <span className="bpCommentTime">{new Date(c.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                                </div>
                                <div className="bpCommentText">{c.body}</div>
                              </div>
                            </div>
                          ))}
                          {comments.length === 0 && !commentsLoading ? <div className="muted" style={{ padding: 8, fontSize: 12 }}>No comments yet.</div> : null}
                          <div ref={commentsEndRef} />
                        </div>
                      )}
                      <div className="bpCommentComposer">
                        <input className="bpCommentInput" value={commentBody} onChange={(e) => setCommentBody(e.target.value)}
                          placeholder="Add a comment…" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void addComment(); } }} disabled={commentSending} />
                        <button className="bpCommentSend" type="button" onClick={() => void addComment()} disabled={commentSending || !commentBody.trim()}>
                          {commentSending ? "…" : "Send"}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {sidebarMode === "create" && (
              <div className="bpDetailCard">
                <div className="bpDetailTitle" style={{ marginBottom: 12 }}>New Task</div>
                <label className="field"><div className="fieldLabel">Title</div>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title…" /></label>
                <label className="field"><div className="fieldLabel">Due date</div>
                  <input value={dueDate} onChange={(e) => setDueDate(e.target.value)} type="date" disabled={asap} /></label>
                <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={asap} onChange={(e) => setAsap(e.target.checked)} style={{ width: "auto" }} />
                  <span className="fieldLabel" style={{ margin: 0 }}>ASAP</span></label>
                <label className="field"><div className="fieldLabel">Description</div>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></label>
                <label className="field"><div className="fieldLabel">Responsible</div>
                  <select value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}>
                    <option value="">Any</option>
                    {members.map(({ profile, member }) => (
                      <option key={member.user_id} value={member.user_id}>
                        {profile?.display_name ?? profile?.email ?? member.user_id}
                      </option>
                    ))}
                  </select></label>
                <label className="field"><div className="fieldLabel">Company</div>
                  <select value={company} onChange={(e) => setCompany(e.target.value)}>
                    <option value="">Select…</option>
                    {COMPANY_PRESETS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select></label>
                {company === "Other" ? (
                  <label className="field"><div className="fieldLabel">Custom Company</div>
                    <input value={customCompany} onChange={(e) => setCustomCompany(e.target.value)} placeholder="Enter company name" /></label>
                ) : null}
                <button
                  className="primaryBtn btnFull"
                  style={{ marginTop: 10 }}
                  onClick={async () => { await createTask(); setSidebarMode("list"); }}
                  disabled={creating || !title.trim()}
                >
                  {creating ? "Creating…" : "Add task"}
                </button>
              </div>
            )}

            {/* Audit log toggle */}
            <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <button className="bpChip" style={{ width: "100%", justifyContent: "center" }} type="button"
                onClick={() => { setShowAudit((v) => !v); if (!showAudit) void loadAuditLog(); }}>
                {showAudit ? "Hide" : "Show"} Activity Log
              </button>
              {showAudit ? (
                <div className="bpAuditList">
                  {auditLoading ? <div className="muted" style={{ padding: 8, fontSize: 12 }}>Loading…</div> : null}
                  {auditLog.map((e) => {
                    const who = e.actor_profile?.display_name ?? e.actor_profile?.email?.split("@")[0] ?? "System";
                    const actionMap: Record<string, string> = {
                      task_created: "created a task",
                      task_updated: "updated a task",
                      task_deleted: "deleted a task",
                      task_completed: "completed a task",
                      task_reopened: "reopened a task",
                      task_assigned: "assigned a task",
                      comment_added: "commented",
                      member_joined: "joined",
                      member_removed: "was removed",
                    };
                    const detail = (e.details as any)?.title ? `"${(e.details as any).title}"` : "";
                    return (
                      <div key={e.id} className="bpAuditRow">
                        <div className="bpAuditText"><b>{who}</b> {actionMap[e.action] ?? e.action} {detail}</div>
                        <div className="bpAuditTime">{new Date(e.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                      </div>
                    );
                  })}
                  {!auditLoading && auditLog.length === 0 ? <div className="muted" style={{ padding: 8, fontSize: 12 }}>No activity recorded yet.</div> : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* ── Member hover popup ── */}
      {hoverMember && (() => {
        const popW = 170;
        const popLeft = Math.min(Math.max(8, hoverMember.rect.left + hoverMember.rect.width / 2), window.innerWidth - popW / 2 - 8);
        const fitsBelow = hoverMember.rect.bottom + 160 < window.innerHeight;
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
              {initials(hoverMember.profile.display_name ?? hoverMember.profile.email ?? "U")}
            </div>
            <div className="cMemberPopupName">{hoverMember.profile.display_name || hoverMember.profile.email?.split("@")[0] || "User"}</div>
            {hoverMember.profile.email && <div className="cMemberPopupEmail">{hoverMember.profile.email}</div>}
          </div>
        );
      })()}
    </div>
  );
}
