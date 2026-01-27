import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import type {
  Profile,
  TaskStatus,
  TaskWithAge,
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

function formatDateTime(d: string) {
  const dt = new Date(d);
  return dt.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<"due" | "title">("due");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [urgencyFilter, setUrgencyFilter] = useState<
    "all" | "asap" | "urgent" | "soon" | "later"
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
  const [company, setCompany] = useState("");
  const [creating, setCreating] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editAsap, setEditAsap] = useState(false);
  const [editDescription, setEditDescription] = useState("");
  const [editResponsibleId, setEditResponsibleId] = useState("");
  const [editCompany, setEditCompany] = useState("");
  const [busy, setBusy] = useState(false);

  const [viewMode, setViewMode] = useState<"board" | "calendar" | "list" | "people">("board");
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const [popping, setPopping] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data }) => setCurrentUserId(data.user?.id ?? null))
      .catch(() => setCurrentUserId(null));
  }, [supabase]);

  const userColors = useMemo(() => {
    const map = new Map<string, string>();
    const palette = [
      "#64b5ff", // blue
      "#a885ff", // purple
      "#ff85a1", // pink
      "#ffb385", // orange
      "#85ff9e", // green
      "#85fff3", // teal
      "#ffeb85", // yellow
      "#ff85f3", // magenta
    ];
    members.forEach(({ member }) => {
      const h = hash(member.user_id);
      map.set(member.user_id, palette[h % palette.length]);
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

    if (userIds.length) {
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id,email,display_name,avatar_url")
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
    setEditCompany(selected.company ?? "");
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
        company: company || null,
        is_asap: asap,
      });
      if (e) throw new Error(e.message);

      setTitle("");
      setDueDate("");
      setAsap(false);
      setDescription("");
      setResponsibleId("");
      setCompany("");
      // realtime will refresh, but do an eager refresh for responsiveness
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
          company: editCompany || null,
          is_asap: editAsap,
        })
        .eq("id", selected.id);
      if (e) throw new Error(e.message);
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
      // realtime will trigger scheduleLoad, but let's do an eager refresh
      // to ensure the local state is perfectly in sync with the DB order.
      await load();
    } catch (e) {
      // revert if update failed
      setTasks((cur) =>
        cur.map((t) => (t.id === taskId ? { ...t, status: prev } : t)),
      );
      setError(e instanceof Error ? e.message : "Unknown error");
    }
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
  ]);

  const activeTasks = useMemo(
    () => filteredSorted.filter((t) => t.status !== "done"),
    [filteredSorted],
  );
  const completeTasks = useMemo(
    () => filteredSorted.filter((t) => t.status === "done"),
    [filteredSorted],
  );

  // Summary logic
  const oldestTask = useMemo(() => {
    if (tasks.length === 0) return null;
    return [...tasks].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  }, [tasks]);

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
    // Interpolate from orange -> red as urgency increases.
    const t = clamp(u, 0, 1);
    const r = Math.round(255);
    const g = Math.round(150 - t * 120); // 150 -> 30
    const b = Math.round(60 - t * 50); // 60 -> 10
    return `rgba(${r}, ${g}, ${b}, ${0.55 + t * 0.25})`;
  }

  function matchesUrgencyFilter(t: RowTask) {
    if (urgencyFilter === "all") return true;
    if (urgencyFilter === "asap") return Boolean(t.is_asap);
    if (t.is_asap) return false;

    const u = urgencyLevel(t);
    if (urgencyFilter === "urgent") return u >= 0.7;
    if (urgencyFilter === "soon") return u >= 0.35 && u < 0.7;
    if (urgencyFilter === "later") return u < 0.35;
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

  function bubbleVisual(t: RowTask) {
    const now = Date.now();
    const dueMs =
      t.is_asap || !t.due_date ? now : new Date(t.due_date + "T00:00:00").getTime();
    const daysUntilDue = Math.ceil((dueMs - now) / (1000 * 60 * 60 * 24));
    const size = clamp(94 - daysUntilDue * 6, 58, 112);
    const u = urgencyLevel(t);
    const color = t.responsible_id
      ? userColors.get(t.responsible_id)
      : urgencyColor(u);
    return { size, r: size / 2, color, u };
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

        // spring toward anchor
        const k = 2.2; // stronger = less overlap drift
        if (anchor) {
          node.vx += (anchor.ax - node.x) * k * dt;
          node.vy += (anchor.ay - node.y) * k * dt;
        }

        // gentle perpetual drift (time-based) so motion never damps to a full stop
        const hh = hash(workspaceId + id + "swirl");
        const phase = (hh % 1000) / 1000 * Math.PI * 2;
        const amp = 18 + ((hh / 9) % 12); // px/s^2-ish
        const tt = t / 1000;
        node.vx += Math.sin(tt + phase) * amp * dt;
        node.vy += Math.cos(tt * 0.9 + phase) * amp * dt;

        // damping (light) - keep it floaty, not stuck
        node.vx *= 0.9985;
        node.vy *= 0.9985;

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

  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay(); // 0 = Sunday

    const prevMonthLastDay = new Date(year, month, 0).getDate();
    const days: Array<{ date: string; day: number; current: boolean; isToday: boolean }> = [];

    // Padding from prev month
    for (let i = startingDay - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, prevMonthLastDay - i);
      days.push({
        date: d.toISOString().split("T")[0],
        day: d.getDate(),
        current: false,
        isToday: false,
      });
    }

    // Current month
    const todayStr = new Date().toISOString().split("T")[0];
    for (let i = 1; i <= daysInMonth; i++) {
      const dStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
      days.push({
        date: dStr,
        day: i,
        current: true,
        isToday: dStr === todayStr,
      });
    }

    // Padding from next month
    const totalSlots = 42; // 6 rows of 7 days
    const nextMonthPadding = totalSlots - days.length;
    for (let i = 1; i <= nextMonthPadding; i++) {
      const d = new Date(year, month + 1, i);
      days.push({
        date: d.toISOString().split("T")[0],
        day: d.getDate(),
        current: false,
        isToday: false,
      });
    }

    return days;
  }, [currentMonth]);

  const tasksByDate = useMemo(() => {
    const map = new Map<string, RowTask[]>();
    tasks.forEach((t) => {
      const d = t.due_date;
      if (!d || t.is_asap) return;
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(t);
    });
    return map;
  }, [tasks]);

  const asapTasks = useMemo(() => {
    // Calendar lane: show only active ASAP tasks
    return tasks
      .filter((t) => Boolean(t.is_asap) && t.status !== "done")
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
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
    <div className="boardScreen">
      <div className="workspaceTitleStandalone">{workspace?.name ?? "Board"}</div>

      <div className="boardHeader slim">
        <div className="boardHeaderLeft">
          <div className="kicker">Summary</div>
          <div className="summaryDetails">
            <div className="summaryItem">
              <b>{members.length}</b> members
            </div>
            <div className="summaryDivider" />
            <div className="summaryItem">
              <b>{completedTodayCount}</b> completed today
            </div>
            {oldestTask && (
              <>
                <div className="summaryDivider" />
                <div className="summaryItem">
                  Oldest: <b>{oldestTask.title}</b> ({formatAgeHours(oldestTask.age_hours)})
                </div>
              </>
            )}
          </div>
        </div>
        <div className="boardHeaderRight">
          <div className="memberRow fullList" title="Workspace members">
            {members.map(({ profile, member }) => (
              <div
                key={member.user_id}
                className="memberAvatar"
                title={profile?.display_name || profile?.email || member.user_id}
                style={{ ["--user-color" as any]: userColors.get(member.user_id) } as any}
              >
                {initials(profile?.display_name ?? profile?.email ?? member.user_id)}
              </div>
            ))}
          </div>

          <div className="viewDropdownWrapper" style={{ marginLeft: 12 }}>
            <select
              className="viewDropdownSelect"
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as any)}
            >
              <option value="board">Bubbles</option>
              <option value="list">List</option>
              <option value="people">People</option>
              <option value="calendar">Calendar</option>
            </select>
          </div>

          <button
            className="secondaryBtn compact"
            onClick={() => void load()}
            type="button"
            style={{ marginLeft: 8 }}
          >
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="toastError">{error}</div> : null}

      <div className="boardGrid3">
        <div className="taskListPanel splitLists">
          <div className="panelTitleRow">
            <div className="panelTitle" style={{ margin: 0 }}>
              Tasks
            </div>
            <div className="segmented">
              <button
                type="button"
                className={`segBtn ${sortKey === "due" ? "active" : ""}`}
                onClick={() => onToggleSort("due")}
              >
                Due {sortKey === "due" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </button>
              <button
                type="button"
                className={`segBtn ${sortKey === "title" ? "active" : ""}`}
                onClick={() => onToggleSort("title")}
              >
                Title{" "}
                {sortKey === "title" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </button>
            </div>
          </div>

          <input
            className="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title…"
          />

          <div className="taskGroup">
            <div className="taskGroupHeader">
              <div className="taskGroupTitle">Tasks</div>
              <div className="muted">{activeTasks.length}</div>
            </div>
            <div className="taskScroll">
              {activeTasks.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`taskRow ${t.id === selectedId ? "active" : ""}`}
                  onClick={() => setSelectedId(t.id)}
                >
                  <div className="taskRowTitle">{t.title}</div>
                  <div className="taskRowMeta">
                    <span className="chip">{formatAgeHours(t.age_hours)}</span>
                    <span className="chip">{formatDue(t.due_date, t.is_asap)}</span>
                    {t.company ? <span className="chip company">{t.company}</span> : null}
                    {t.responsible_profile ? (
                      <span className="chip responsible" title="Responsible">
                        👤 {t.responsible_profile.display_name ?? t.responsible_profile.email}
                      </span>
                    ) : null}
                  </div>
                </button>
              ))}
              {activeTasks.length === 0 ? (
                <div className="muted" style={{ padding: 10 }}>
                  No tasks.
                </div>
              ) : null}
            </div>
          </div>

          <div className="taskGroup">
            <div className="taskGroupHeader">
              <div className="taskGroupTitle">Complete</div>
              <div className="muted">{completeTasks.length}</div>
            </div>
            <div className="taskScroll">
              {completeTasks.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`taskRow done ${t.id === selectedId ? "active" : ""}`}
                  onClick={() => setSelectedId(t.id)}
                >
                  <div className="taskRowTitle">{t.title}</div>
                  <div className="taskRowMeta">
                    <span className="chip">{formatAgeHours(t.age_hours)}</span>
                    <span className="chip">{formatDue(t.due_date, t.is_asap)}</span>
                    {t.company ? <span className="chip company">{t.company}</span> : null}
                    {t.responsible_profile ? (
                      <span className="chip responsible" title="Responsible">
                        👤 {t.responsible_profile.display_name ?? t.responsible_profile.email}
                      </span>
                    ) : null}
                  </div>
                  <div className="taskRowCompletion">
                    {t.completed_profile || t.completed_at ? (
                      <div className="completionStamp">
                        ✓ Completed {t.completed_at ? formatDateTime(t.completed_at) : ""}
                        {t.completed_profile ? ` by ${t.completed_profile.display_name ?? t.completed_profile.email}` : ""}
                      </div>
                    ) : null}
                  </div>
                </button>
              ))}
              {completeTasks.length === 0 ? (
                <div className="muted" style={{ padding: 10 }}>
                  Nothing completed yet.
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="boardMain">
          <div className="boardFilters">
            <div className="boardFilterSet">
              <span className="filterLabel">Urgency</span>
              <div className="filterGroup">
                {["all", "asap", "urgent", "soon", "later"].map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`filterChip ${v === "urgent" ? "danger" : ""} ${urgencyFilter === v ? "active" : ""}`}
                    onClick={() => setUrgencyFilter(v as any)}
                  >
                    {v === "all" ? "ALL" : v.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="boardFilterSet">
              <span className="filterLabel">Task Type</span>
              <div className="filterGroup">
                <button
                  type="button"
                  className={`filterChip ${assignmentFilter === "mine" ? "active" : ""}`}
                  onClick={() => setAssignmentFilter(v => v === "mine" ? "all" : "mine")}
                >
                  MINE
                </button>
                <button
                  type="button"
                  className={`filterChip ${assignmentFilter === "unassigned" ? "active" : ""}`}
                  onClick={() => setAssignmentFilter(v => v === "unassigned" ? "all" : "unassigned")}
                >
                  UNASSIGNED
                </button>
              </div>
            </div>

            <div className="boardFilterSet">
              <span className="filterLabel">Company</span>
              <div className="filterGroup">
                {["BTB", "OTE", "TKO", "Panels", "Ursus"].map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`filterChip ${companyFilter.has(c) ? "active" : ""}`}
                    onClick={() => toggleCompanyChip(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="filterReset"
              onClick={() => {
                setUrgencyFilter("all");
                setAssignmentFilter("all");
                setCompanyFilter(new Set());
              }}
            >
              RESET
            </button>
          </div>

          {viewMode === "board" ? (
            <div className="bubbleCanvas" ref={canvasRef}>
            <div className="gridOverlay" aria-hidden="true" />

          {layoutOrder.map((t) => {
            const { size, color, u } = bubbleVisual(t);
            const isPop = popping.has(t.id);
            const urgent = u >= 0.15;
            return (
              <button
                key={t.id}
                ref={(node) => {
                  if (!node) bubbleEls.current.delete(t.id);
                  else {
                    bubbleEls.current.set(t.id, node);
                    // Avoid the "pile in the corner" when switching Calendar -> Board by painting
                    // the last known physics position immediately (before next RAF tick).
                    const simNode = sim.current.get(t.id);
                    if (simNode) {
                      const r = size / 2;
                      node.style.setProperty("--x", `${simNode.x - r}px`);
                      node.style.setProperty("--y", `${simNode.y - r}px`);
                    }
                  }
                }}
                className={`taskBubble ${urgent ? "urgent" : ""} ${t.id === selectedId ? "selected" : ""} ${isPop ? "popping" : ""}`}
                onClick={() => setSelectedId(t.id)}
                style={
                  {
                    width: `${size}px`,
                    height: `${size}px`,
                    ["--user-color" as never]: color,
                    ["--urgency" as never]: u,
                    ["--throbDur" as never]: `${Math.max(1.4, 6 - u * 4)}s`,
                    ["--shakeDur" as never]: `${Math.max(0.6, 1.6 - u * 1.1)}s`,
                  } as never
                }
                type="button"
              >
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
                      <span className="metaItem">📅 {formatDue(t.due_date, t.is_asap)}</span>
                      <span className="metaItem">⏱️ {formatAgeHours(t.age_hours)}</span>
                      {t.company && <span className="metaItem company">🏢 {t.company}</span>}
                      {t.responsible_profile && (
                        <span className="metaItem responsible">
                          👤 {t.responsible_profile.display_name ?? t.responsible_profile.email}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="listViewChevron">›</div>
                </div>
              ))}
              {filteredSorted.length === 0 && (
                <div className="emptyCenter">
                  <div className="emptyTitle">No tasks found</div>
                  <div className="muted">Try adjusting your filters or search.</div>
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
              
              {/* Unassigned Column */}
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
        ) : (
          <div className="calendarCanvas">
            <div className="calendarTop">
              <div className="calendarMonthName">
                {currentMonth.toLocaleString(undefined, {
                  month: "long",
                  year: "numeric",
                })}
              </div>
              <div className="segmented">
                <button
                  className="segBtn"
                  onClick={() =>
                    setCurrentMonth(
                      new Date(
                        currentMonth.getFullYear(),
                        currentMonth.getMonth() - 1,
                        1,
                      ),
                    )
                  }
                >
                  ←
                </button>
                <button className="segBtn" onClick={() => setCurrentMonth(new Date())}>
                  Today
                </button>
                <button
                  className="segBtn"
                  onClick={() =>
                    setCurrentMonth(
                      new Date(
                        currentMonth.getFullYear(),
                        currentMonth.getMonth() + 1,
                        1,
                      ),
                    )
                  }
                >
                  →
                </button>
              </div>
            </div>

            {asapTasks.length ? (
              <div className="asapLane" aria-label="ASAP tasks">
                <div className="asapLaneHeader">
                  <div className="asapLaneTitle">ASAP</div>
                  <div className="muted">{asapTasks.length}</div>
                </div>
                <div className="asapLaneScroll">
                  {asapTasks.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`asapPill ${t.id === selectedId ? "active" : ""}`}
                      onClick={() => setSelectedId(t.id)}
                      style={
                        {
                          ["--user-color" as never]: t.responsible_id
                            ? userColors.get(t.responsible_id)
                            : "rgba(255,255,255,0.2)",
                        } as never
                      }
                      title={
                        t.responsible_profile
                          ? `${t.title} (Responsible: ${t.responsible_profile.display_name ?? t.responsible_profile.email})`
                          : t.title
                      }
                    >
                      <span className="asapDot" aria-hidden="true" />
                      <span className="asapText">{t.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="calendarGrid">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="calendarDayHead">
                  {d}
                </div>
              ))}
              {calendarDays.map((day) => (
                <div
                  key={day.date}
                  className={`calendarCell ${day.current ? "" : "otherMonth"} ${day.isToday ? "today" : ""}`}
                >
                  <div className="calendarDayNum">{day.day}</div>
                  <div className="calendarTaskList">
                    {(tasksByDate.get(day.date) || []).map((t) => (
                      <div
                        key={t.id}
                        className={`calendarTask ${t.id === selectedId ? "active" : ""} ${t.status === "done" ? "done" : ""}`}
                        onClick={() => setSelectedId(t.id)}
                        title={t.title}
                      >
                        {t.title}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="sidePanel">
        <div className="sideCard">
            <div className="panelTitleRow">
              <div className="panelTitle">Details</div>
              {selected && !isEditing ? (
                <button
                  className="secondaryBtn compact"
                  onClick={() => setIsEditing(true)}
                  type="button"
                >
                  Edit
                </button>
              ) : null}
            </div>

            {selected ? (
              isEditing ? (
                <div className="editForm">
                  <label className="field">
                    <div className="fieldLabel">Title</div>
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Title"
                    />
                  </label>
                  <label className="field">
                    <div className="fieldLabel">Due date</div>
                    <input
                      value={editDueDate}
                      onChange={(e) => setEditDueDate(e.target.value)}
                      type="date"
                      disabled={editAsap}
                    />
                  </label>
                  <label className="field" style={{ marginTop: -6 }}>
                    <div className="row" style={{ gap: 10, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={editAsap}
                        onChange={(e) => setEditAsap(e.target.checked)}
                        style={{ width: 18, height: 18 }}
                      />
                      <div className="fieldLabel" style={{ margin: 0 }}>
                        ASAP (no due date)
                      </div>
                    </div>
                  </label>
                  <label className="field">
                    <div className="fieldLabel">Description</div>
                    <textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      rows={4}
                    />
                  </label>
                  <label className="field">
                    <div className="fieldLabel">Person Responsible</div>
                    <select
                      value={editResponsibleId}
                      onChange={(e) => setEditResponsibleId(e.target.value)}
                    >
                      <option value="">Any</option>
                      {members.map(({ profile, member }) => (
                        <option key={member.user_id} value={member.user_id}>
                          {profile?.display_name ?? profile?.email ?? member.user_id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <div className="fieldLabel">Company</div>
                    <select
                      value={editCompany}
                      onChange={(e) => setEditCompany(e.target.value)}
                    >
                      <option value="">N/A</option>
                      {["BTB", "OTE", "TKO", "Panels", "Ursus"].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="row" style={{ marginTop: 14 }}>
                    <button
                      className="primaryBtn"
                      onClick={updateTask}
                      disabled={busy || !editTitle.trim() || (!editAsap && !editDueDate)}
                      type="button"
                    >
                      Save
                    </button>
                    <button
                      className="secondaryBtn"
                      onClick={() => setIsEditing(false)}
                      disabled={busy}
                      type="button"
                    >
                      Cancel
                    </button>
                    <div className="spacer" />
                    <button
                      className="secondaryBtn"
                      onClick={deleteTask}
                      disabled={busy}
                      style={{ color: "var(--danger)" }}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="statusBadgeRow">
                    <div className={`statusPill ${selected.status}`}>
                      {selected.status === "done" ? "✓ Complete" : "○ In Progress"}
                    </div>
                    {urgencyLevel(selected) >= 0.7 && selected.status !== "done" ? (
                      <div className="urgentPill">🔥 Urgent</div>
                    ) : null}
                  </div>
                  <div className="titleLg">{selected.title}</div>
                  <div className="muted" style={{ marginBottom: 12 }}>
                    Due {selected.due_date} 
                    {selected.company ? ` · for ${selected.company}` : ""}
                  </div>

                  <div className="tagRow">
                    {selected.is_asap ? <span className="tagChip">ASAP</span> : null}
                    {selected.company ? (
                      <span className="tagChip company">{selected.company}</span>
                    ) : (
                      <span className="tagChip">Company: N/A</span>
                    )}
                    {selected.responsible_profile ? (
                      <span className="tagChip">
                        👤 {selected.responsible_profile.display_name ?? selected.responsible_profile.email}
                      </span>
                    ) : (
                      <span className="tagChip">Responsible: Any</span>
                    )}
                  </div>

                  <div className="taskMetricsRow">
                    <div className="metricBox">
                      <div className="metricLabel">Time Alive</div>
                      <div className="metricValue">{formatAgeHours(selected.age_hours)}</div>
                    </div>
                    {selected.responsible_profile && (
                      <div className="metricBox">
                        <div className="metricLabel">Person Responsible</div>
                        <div className="metricValue" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div className="avatarCircle sm">
                            {initials(selected.responsible_profile.display_name ?? selected.responsible_profile.email ?? "")}
                          </div>
                          {selected.responsible_profile.display_name ?? selected.responsible_profile.email}
                        </div>
                      </div>
                    )}
                  </div>

                  {selected.status === "done" && (
                    <div className="completionHero">
                      <div className="heroLabel">Completion Details</div>
                      <div className="heroGrid">
                        <div className="heroItem">
                          <div className="heroKey">Finished on</div>
                          <div className="heroVal">
                            {selected.completed_at
                              ? formatDateTime(selected.completed_at)
                              : "—"}
                          </div>
                        </div>
                        <div className="heroItem">
                          <div className="heroKey">Completed by</div>
                          <div className="heroVal">
                            {selected.completed_profile
                              ? selected.completed_profile.display_name ??
                                selected.completed_profile.email
                              : "Unknown"}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="sideBody">{selected.description}</div>

                  <div className="row" style={{ marginTop: 14 }}>
                    {selected.status === "done" ? (
                      <button
                        className="secondaryBtn"
                        type="button"
                        onClick={() => void setTaskStatus(selected.id, "open")}
                      >
                        Reopen
                      </button>
                    ) : (
                      <button
                        className="primaryBtn"
                        type="button"
                        onClick={() => void setTaskStatus(selected.id, "done")}
                      >
                        Mark complete
                      </button>
                    )}
                  </div>
                </div>
              )
            ) : (
              <div className="muted">Click a bubble to see details.</div>
            )}
          </div>

          <div className="sideCard">
            <div className="panelTitle">Create a task</div>
            <div ref={createRef} />
            <label className="field">
              <div className="fieldLabel">Title</div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ship the new landing page"
              />
            </label>
            <label className="field">
              <div className="fieldLabel">Due date</div>
              <input
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                type="date"
                disabled={asap}
              />
            </label>
            <label className="field" style={{ marginTop: -6 }}>
              <div className="row" style={{ gap: 10, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={asap}
                  onChange={(e) => setAsap(e.target.checked)}
                  style={{ width: 18, height: 18 }}
                />
                <div className="fieldLabel" style={{ margin: 0 }}>
                  ASAP (no due date)
                </div>
              </div>
            </label>
            <label className="field">
              <div className="fieldLabel">Description</div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
            </label>
            <label className="field">
              <div className="fieldLabel">Person Responsible</div>
              <select
                value={responsibleId}
                onChange={(e) => setResponsibleId(e.target.value)}
              >
                <option value="">Any</option>
                {members.map(({ profile, member }) => (
                  <option key={member.user_id} value={member.user_id}>
                    {profile?.display_name ?? profile?.email ?? member.user_id}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <div className="fieldLabel">Company</div>
              <select
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              >
                <option value="">N/A</option>
                {["BTB", "OTE", "TKO", "Panels", "Ursus"].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primaryBtn"
              onClick={createTask}
              type="button"
              disabled={
                creating || !title.trim() || (!asap && !dueDate) || !description.trim()
              }
            >
              {creating ? "Creating…" : "Add bubble"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
