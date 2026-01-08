import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import type { Profile, TaskWithAge, Workspace, WorkspaceMember } from "../types";

function hash(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function BoardPage() {
  const supabase = getSupabase();
  const { id } = useParams();
  const workspaceId = id ?? "";

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [tasks, setTasks] = useState<(TaskWithAge & { creator_profile?: Profile | null })[]>([]);
  const [members, setMembers] = useState<Array<{ member: WorkspaceMember; profile: Profile | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<"due" | "title">("due");

  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const selected = useMemo(() => tasks.find((t) => t.id === selectedId) ?? null, [tasks, selectedId]);
  const createRef = useRef<HTMLDivElement | null>(null);

  function formatDue(d: string) {
    const dt = new Date(d + "T00:00:00");
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(dt);
  }
  function formatAgeHours(age: number) {
    const h = Math.max(0, Math.floor(age));
    if (h < 24) return `${h}h`;
    const days = Math.floor(h / 24);
    const rem = h % 24;
    return rem ? `${days}d ${rem}h` : `${days}d`;
  }

  async function load() {
    setLoading(true);
    setError(null);

    const wsReq = supabase
      .from("workspaces")
      .select("id,name,join_code,created_at")
      .eq("id", workspaceId)
      .maybeSingle();
    const tReq = supabase
      .from("tasks_with_age")
      .select("id,title,description,due_date,status,created_at,created_by,workspace_id,age_hours")
      .eq("workspace_id", workspaceId)
      .order("due_date", { ascending: true })
      .order("created_at", { ascending: false });
    const mReq = supabase
      .from("workspace_members")
      .select("workspace_id,user_id,role,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });

    const [{ data: ws, error: wsErr }, { data: t, error: tErr }, { data: m, error: mErr }] = await Promise.all([
      wsReq,
      tReq,
      mReq,
    ]);

    if (wsErr) setError(wsErr.message);
    if (tErr) setError(tErr.message);
    if (mErr) setError(mErr.message);

    setWorkspace((ws as Workspace) ?? null);
    setTasks((t ?? []) as TaskWithAge[]);

    const membersRaw = (m ?? []) as WorkspaceMember[];
    const userIds = Array.from(
      new Set([...membersRaw.map((x) => x.user_id), ...(t ?? []).map((task) => task.created_by)]),
    );
    if (userIds.length) {
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id,email,display_name,avatar_url")
        .in("id", userIds);
      const profiles = (profilesData ?? []) as Profile[];
      const byId = new Map(profiles.map((p) => [p.id, p]));
      setMembers(membersRaw.map((mem) => ({ member: mem, profile: byId.get(mem.user_id) ?? null })));
      // attach creator profiles to tasks
      setTasks((t ?? []).map((task) => ({ ...task, creator_profile: byId.get(task.created_by) ?? null })));
    } else {
      setMembers([]);
      setTasks((t ?? []) as TaskWithAge[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    if (!workspaceId) return;
    void load();
  }, [workspaceId]);

  useEffect(() => {
    function handler() {
      createRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    window.addEventListener("tb:newTask", handler);
    return () => window.removeEventListener("tb:newTask", handler);
  }, []);

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
      });
      if (e) throw new Error(e.message);

      setTitle("");
      setDueDate("");
      setDescription("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setCreating(false);
    }
  }

  const bubbles = useMemo(() => {
    const seed = workspaceId;
    const now = Date.now();
    return tasks.map((t) => {
      const h = hash(seed + t.id);
      const x = (h % 86) + 7; // 7..93
      const y = ((h / 97) % 70) + 15; // 15..85
      const daysUntilDue = Math.ceil((new Date(t.due_date).getTime() - now) / (1000 * 60 * 60 * 24));
      const size = clamp(160 - daysUntilDue * 10, 76, 168);
      const hue = clamp(185 - daysUntilDue * 8, 10, 200); // closer due -> warmer
      const drift = 14 + (h % 22);
      const dur = 10 + (h % 9);
      const delay = (h % 13) * -0.35;
      return { t, x, y, size, hue, drift, dur, delay };
    });
  }, [tasks, workspaceId]);

  const filteredSorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? tasks.filter((t) => t.title.toLowerCase().includes(q)) : tasks;
    const sorted = [...list].sort((a, b) => {
      if (sortMode === "title") return a.title.localeCompare(b.title);
      const dueCmp = a.due_date.localeCompare(b.due_date);
      if (dueCmp !== 0) return dueCmp;
      return b.created_at.localeCompare(a.created_at);
    });
    return sorted;
  }, [tasks, query, sortMode]);

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
      <div className="boardHeader">
        <div className="boardHeaderLeft">
          <div className="kicker">Workspace</div>
          <div className="boardHeaderTitle">{workspace?.name ?? "Board"}</div>
          <div className="muted">Join code: {workspace?.join_code ?? "—"}</div>
        </div>
        <div className="boardHeaderRight">
          <div className="memberRow" title="Workspace members">
            {members.slice(0, 6).map(({ profile, member }) => (
              <div key={member.user_id} className="memberAvatar" title={profile?.email ?? member.user_id}>
                {initials(profile?.display_name ?? profile?.email ?? member.user_id)}
              </div>
            ))}
            {members.length > 6 ? <div className="memberMore">+{members.length - 6}</div> : null}
          </div>
          <button className="secondaryBtn compact" onClick={() => void load()} type="button">
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="toastError">{error}</div> : null}

      <div className="boardGrid3">
        <div className="taskListPanel">
          <div className="panelTitleRow">
            <div className="panelTitle" style={{ margin: 0 }}>
              Tasks
            </div>
            <div className="segmented">
              <button
                type="button"
                className={`segBtn ${sortMode === "due" ? "active" : ""}`}
                onClick={() => setSortMode("due")}
              >
                Due
              </button>
              <button
                type="button"
                className={`segBtn ${sortMode === "title" ? "active" : ""}`}
                onClick={() => setSortMode("title")}
              >
                Title
              </button>
            </div>
          </div>

          <input
            className="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title…"
          />

          <div className="taskList">
            {filteredSorted.map((t) => (
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
                  {t.creator_profile ? <span className="chip">{t.creator_profile.display_name ?? t.creator_profile.email}</span> : null}
                </div>
              </button>
            ))}
            {filteredSorted.length === 0 ? <div className="muted">No matching tasks.</div> : null}
          </div>
        </div>

        <div className="bubbleCanvas">
          <div className="gridOverlay" aria-hidden="true" />
          {bubbles.map(({ t, x, y, size, hue, drift, dur, delay }) => (
            <button
              key={t.id}
              className={`taskBubble ${t.id === selectedId ? "selected" : ""}`}
              onClick={() => setSelectedId(t.id)}
              style={
                {
                  left: `${x}%`,
                  top: `${y}%`,
                  width: `${size}px`,
                  height: `${size}px`,
                  ["--hue" as never]: hue,
                  ["--drift" as never]: `${drift}px`,
                  ["--dur" as never]: `${dur}s`,
                  ["--delay" as never]: `${delay}s`,
                } as never
              }
              type="button"
            >
              <div className="bubbleLabel">{t.title}</div>
              <div className="bubbleMeta">
                {formatAgeHours(t.age_hours)} · {formatDue(t.due_date)}
              </div>
            </button>
          ))}

          {tasks.length === 0 ? (
            <div className="emptyCenter">
              <div className="emptyTitle">No tasks yet</div>
              <div className="muted">Create a task and watch it float.</div>
            </div>
          ) : null}
        </div>

        <div className="sidePanel">
          <div className="sideCard">
            <div className="panelTitle">Details</div>
            {selected ? (
              <div>
                <div className="titleLg">{selected.title}</div>
                <div className="muted">Due {selected.due_date}</div>
                <div className="sideBody">{selected.description}</div>
              </div>
            ) : (
              <div className="muted">Click a bubble to see details.</div>
            )}
          </div>

          <div className="sideCard">
            <div className="panelTitle">Create a task</div>
            <div ref={createRef} />
            <label className="field">
              <div className="fieldLabel">Title</div>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ship the new landing page" />
            </label>
            <label className="field">
              <div className="fieldLabel">Due date</div>
              <input value={dueDate} onChange={(e) => setDueDate(e.target.value)} type="date" />
            </label>
            <label className="field">
              <div className="fieldLabel">Description</div>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
            </label>
            <button
              className="primaryBtn"
              onClick={createTask}
              type="button"
              disabled={creating || !title.trim() || !dueDate || !description.trim()}
            >
              {creating ? "Creating…" : "Add bubble"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function initials(name: string) {
  const n = name.includes("@") ? name.split("@")[0] : name;
  const parts = n.replace(/[^a-zA-Z0-9 ]/g, " ").split(" ").filter(Boolean);
  const a = parts[0]?.[0] ?? "U";
  const b = parts[1]?.[0] ?? parts[0]?.[1] ?? "";
  return (a + b).toUpperCase();
}


