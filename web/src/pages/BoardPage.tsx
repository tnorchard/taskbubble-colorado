import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import type { Task, Workspace } from "../types";

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
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const selected = useMemo(() => tasks.find((t) => t.id === selectedId) ?? null, [tasks, selectedId]);

  async function load() {
    setLoading(true);
    setError(null);

    const wsReq = supabase
      .from("workspaces")
      .select("id,name,join_code,created_at")
      .eq("id", workspaceId)
      .maybeSingle();
    const tReq = supabase
      .from("tasks")
      .select("id,title,description,due_date,status,created_at,created_by,workspace_id")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    const [{ data: ws, error: wsErr }, { data: t, error: tErr }] = await Promise.all([wsReq, tReq]);

    if (wsErr) setError(wsErr.message);
    if (tErr) setError(tErr.message);

    setWorkspace((ws as Workspace) ?? null);
    setTasks((t ?? []) as Task[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!workspaceId) return;
    void load();
  }, [workspaceId]);

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
      <div className="boardTop">
        <div className="boardTopLeft">
          <Link to="/workspaces" className="chipLink">
            ← Workspaces
          </Link>
          <div className="boardTitle">
            <div className="kicker">Workspace</div>
            <div className="h1" style={{ margin: 0 }}>
              {workspace?.name ?? "Board"}
            </div>
          </div>
        </div>

        <div className="boardTopRight">
          <button className="secondaryBtn" onClick={() => void load()} type="button">
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="toastError">{error}</div> : null}

      <div className="boardGrid">
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
              <div className="bubbleMeta">{t.due_date}</div>
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


