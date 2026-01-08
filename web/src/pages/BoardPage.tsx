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

function formatDue(d: string) {
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

type RowTask = TaskWithAge & { creator_profile?: Profile | null };

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

  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const [popping, setPopping] = useState<Set<string>>(() => new Set());

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

    const tReq = supabase
      .from("tasks_with_age")
      .select(
        "id,title,description,due_date,status,created_at,created_by,workspace_id,age_hours",
      )
      .eq("workspace_id", workspaceId)
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
        ...(t ?? []).map((task) => task.created_by),
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
      setTasks(
        (t ?? []).map((task) => ({
          ...task,
          creator_profile: byId.get(task.created_by) ?? null,
        })) as RowTask[],
      );
    } else {
      setMembers([]);
      setTasks((t ?? []) as RowTask[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    if (!workspaceId) return;
    void load();
  }, [workspaceId]);

  useEffect(() => {
    if (!selected) return;
    setEditTitle(selected.title);
    setEditDueDate(selected.due_date);
    setEditDescription(selected.description);
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
        due_date: dueDate,
        created_by: uid,
        workspace_id: workspaceId,
        status: "open" satisfies TaskStatus,
      });
      if (e) throw new Error(e.message);

      setTitle("");
      setDueDate("");
      setDescription("");
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
          due_date: editDueDate,
          description: editDescription.trim(),
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

    // Optimistic UI
    setTasks((cur) =>
      cur.map((t) => (t.id === taskId ? { ...t, status: next } : t)),
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
      const { error: e } = await supabase
        .from("tasks")
        .update({ status: next })
        .eq("id", taskId);
      if (e) throw new Error(e.message);
      // realtime + load keeps state consistent
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
    const list = q
      ? tasks.filter((t) => t.title.toLowerCase().includes(q))
      : tasks;

    return [...list].sort((a, b) => {
      if (sortKey === "title") {
        const cmp = a.title.toLowerCase().localeCompare(b.title.toLowerCase());
        return sortDir === "asc" ? cmp : -cmp;
      }
      const dueCmp = a.due_date.localeCompare(b.due_date);
      if (dueCmp !== 0) return sortDir === "asc" ? dueCmp : -dueCmp;
      const cmp = b.created_at.localeCompare(a.created_at);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [tasks, query, sortKey, sortDir]);

  const activeTasks = useMemo(
    () => filteredSorted.filter((t) => t.status !== "done"),
    [filteredSorted],
  );
  const completeTasks = useMemo(
    () => filteredSorted.filter((t) => t.status === "done"),
    [filteredSorted],
  );

  // Bubbles: hide done tasks (except while popping).
  const bubbleTasks = useMemo(
    () => tasks.filter((t) => t.status !== "done" || popping.has(t.id)),
    [tasks, popping],
  );

  // Stable layout ordering for physics anchor points.
  const layoutOrder = useMemo(() => {
    const now = Date.now();
    return [...bubbleTasks].sort((a, b) => {
      // bias urgent closer to center via anchor ordering
      const aDue = new Date(a.due_date).getTime();
      const bDue = new Date(b.due_date).getTime();
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

  function bubbleVisual(t: RowTask) {
    const now = Date.now();
    const daysUntilDue = Math.ceil(
      (new Date(t.due_date).getTime() - now) / (1000 * 60 * 60 * 24),
    );
    const size = clamp(154 - daysUntilDue * 10, 92, 168);
    const hue = clamp(185 - daysUntilDue * 8, 10, 200);
    return { size, r: size / 2, hue };
  }

  // Physics loop: bounce off walls + bounce off each other + gently pull toward a grid anchor.
  useEffect(() => {
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
      const vx = ((hh % 2 === 0 ? 1 : -1) * (40 + (hh % 60))) as number;
      const vy = (((hh / 3) % 2 === 0 ? 1 : -1) *
        (40 + ((hh / 7) % 60))) as number;
      sim.current.set(id, { x, y, vx, vy });
    }

    function step(t: number) {
      if (!canvasRef.current) return;
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

        // tiny swirl to keep motion alive
        const hh = hash(workspaceId + id + "swirl");
        const sx = ((hh % 1000) / 1000 - 0.5) * 26;
        const sy = (((hh / 1000) % 1000) / 1000 - 0.5) * 26;
        node.vx += sx * dt;
        node.vy += sy * dt;

        // damping
        node.vx *= 0.992;
        node.vy *= 0.992;

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
        btn.style.transform = `translate3d(${node.x - r}px, ${node.y - r}px, 0)`;
      }

      rafId.current = window.requestAnimationFrame(step);
    }

    rafId.current = window.requestAnimationFrame(step);

    return () => {
      if (rafId.current) window.cancelAnimationFrame(rafId.current);
      rafId.current = null;
      lastT.current = 0;
    };
  }, [layoutOrder, layoutIndex, workspaceId]);

  if (loading) {
    return (
      <div className="screen">
        <div className="screenInner">
          <div className="panel">Loading…</div>
        </div>
      </div>
    );
  }

  const onToggleSort = (key: "due" | "title") => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="boardScreen">
      <div className="boardHeader slim">
        <div className="boardHeaderLeft">
          <div className="kicker">Workspace</div>
          <div className="boardHeaderTitle">{workspace?.name ?? "Board"}</div>
          <div className="muted">{members.length} member(s)</div>
        </div>
        <div className="boardHeaderRight">
          <div className="memberRow" title="Workspace members">
            {members.slice(0, 6).map(({ profile, member }) => (
              <div
                key={member.user_id}
                className="memberAvatar"
                title={profile?.email ?? member.user_id}
              >
                {initials(
                  profile?.display_name ?? profile?.email ?? member.user_id,
                )}
              </div>
            ))}
            {members.length > 6 ? (
              <div className="memberMore">+{members.length - 6}</div>
            ) : null}
          </div>
          <button
            className="secondaryBtn compact"
            onClick={() => void load()}
            type="button"
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
                    <span className="chip">{formatDue(t.due_date)}</span>
                    {t.creator_profile ? (
                      <span className="chip">
                        {t.creator_profile.display_name ??
                          t.creator_profile.email}
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
                    <span className="chip">{formatDue(t.due_date)}</span>
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

        <div className="bubbleCanvas" ref={canvasRef}>
          <div className="gridOverlay" aria-hidden="true" />

          {layoutOrder.map((t) => {
            const { size, hue } = bubbleVisual(t);
            const isPop = popping.has(t.id);
            return (
              <button
                key={t.id}
                ref={(node) => {
                  if (!node) bubbleEls.current.delete(t.id);
                  else bubbleEls.current.set(t.id, node);
                }}
                className={`taskBubble ${t.id === selectedId ? "selected" : ""} ${isPop ? "popping" : ""}`}
                onClick={() => setSelectedId(t.id)}
                style={
                  {
                    width: `${size}px`,
                    height: `${size}px`,
                    left: 0,
                    top: 0,
                    ["--hue" as never]: hue,
                  } as never
                }
                type="button"
              >
                <div className="bubbleInner">
                  <div className="bubbleLabel">{t.title}</div>
                  <div className="bubbleMeta">
                    {formatAgeHours(t.age_hours)} · {formatDue(t.due_date)}
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
                    />
                  </label>
                  <label className="field">
                    <div className="fieldLabel">Description</div>
                    <textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      rows={4}
                    />
                  </label>
                  <div className="row" style={{ marginTop: 14 }}>
                    <button
                      className="primaryBtn"
                      onClick={updateTask}
                      disabled={busy || !editTitle.trim() || !editDueDate}
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
                  <div className="titleLg">{selected.title}</div>
                  <div className="muted">Due {selected.due_date}</div>
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
              />
            </label>
            <label className="field">
              <div className="fieldLabel">Description</div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
            </label>
            <button
              className="primaryBtn"
              onClick={createTask}
              type="button"
              disabled={
                creating || !title.trim() || !dueDate || !description.trim()
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
