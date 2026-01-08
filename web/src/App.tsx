import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "./lib/supabaseClient";
import "./app.css";

type Workspace = {
  id: string;
  name: string;
  join_code: string;
  created_at: string;
};

type Task = {
  id: string;
  title: string;
  description: string;
  due_date: string; // YYYY-MM-DD
  status: "open" | "in_progress" | "done" | "archived";
  created_at: string;
  created_by: string;
  workspace_id: string;
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    const supabase = getSupabase();
    let isMounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data.session ?? null);
      setLoadingSession(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      isMounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <div className="page">
        <div className="card">
          <h1>TaskBubble</h1>
          <p>
            Add your Supabase credentials to <code>web/.env</code> first.
          </p>
          <ol>
            <li>
              Copy <code>web/env.example</code> → <code>web/.env</code>
            </li>
            <li>
              Fill <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>
            </li>
            <li>Restart the dev server</li>
          </ol>
        </div>
      </div>
    );
  }

  if (loadingSession) {
    return (
      <div className="page">
        <div className="card">Loading…</div>
      </div>
    );
  }

  if (!session) {
    return <Auth />;
  }

  return <AuthedApp />;
}

function Auth() {
  const supabase = getSupabase();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "signin") {
        const { error: e } = await supabase.auth.signInWithPassword({ email, password });
        if (e) throw e;
      } else {
        const { error: e } = await supabase.auth.signUp({ email, password });
        if (e) throw e;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="card">
        <h1>TaskBubble</h1>
        <p>{mode === "signin" ? "Sign in to your workspace." : "Create an account."}</p>

        <label className="label">
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
        </label>
        <label className="label">
          Password
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
        </label>

        {error ? <div className="error">{error}</div> : null}

        <div className="row">
          <button onClick={submit} disabled={busy || !email || password.length < 6}>
            {busy ? "Working…" : mode === "signin" ? "Sign in" : "Sign up"}
          </button>
          <button
            className="secondary"
            onClick={() => setMode((m) => (m === "signin" ? "signup" : "signin"))}
            disabled={busy}
          >
            {mode === "signin" ? "Need an account?" : "Have an account?"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AuthedApp() {
  const supabase = getSupabase();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isEmailConfirmed, setIsEmailConfirmed] = useState<boolean | null>(null);

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  );

  async function loadWorkspaces() {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("workspaces")
      .select("id,name,join_code,created_at")
      .order("created_at", { ascending: true });
    if (e) {
      setError(e.message);
      setLoading(false);
      return;
    }
    setWorkspaces((data ?? []) as Workspace[]);
    setActiveWorkspaceId((prev) => prev ?? (data?.[0]?.id ?? null));
    setLoading(false);
  }

  useEffect(() => {
    void loadWorkspaces();
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      if (!u) return;
      setUserEmail(u.email ?? null);
      // Supabase returns either `email_confirmed_at` or `confirmed_at` depending on auth settings/version
      const confirmedAt = (u as unknown as { email_confirmed_at?: string | null; confirmed_at?: string | null })
        .email_confirmed_at ?? (u as unknown as { confirmed_at?: string | null }).confirmed_at ?? null;
      setIsEmailConfirmed(Boolean(confirmedAt));
    });
  }, [supabase]);

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <div className="page">
      <div className="topbar">
        <div className="brand">TaskBubble</div>
        {userEmail ? (
          <div className="muted">
            {userEmail} — {isEmailConfirmed ? "confirmed" : "not confirmed"}
          </div>
        ) : null}
        <div className="spacer" />
        <button className="secondary" onClick={signOut}>
          Sign out
        </button>
      </div>

      <div className="layout">
        <div className="sidebar card">
          <h2>Workspaces</h2>
          {loading ? <div>Loading…</div> : null}
          {error ? <div className="error">{error}</div> : null}

          <div className="list">
            {workspaces.map((w) => (
              <button
                key={w.id}
                className={`listItem ${w.id === activeWorkspaceId ? "active" : ""}`}
                onClick={() => setActiveWorkspaceId(w.id)}
              >
                <div className="listTitle">{w.name}</div>
                <div className="listSub">join: {w.join_code}</div>
              </button>
            ))}
          </div>

          <WorkspaceActions onChanged={loadWorkspaces} />
        </div>

        <div className="main">
          {activeWorkspace ? (
            <BubbleBoard key={activeWorkspace.id} workspace={activeWorkspace} />
          ) : (
            <div className="card">No workspace yet. Create or join one.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkspaceActions({ onChanged }: { onChanged: () => void }) {
  const supabase = getSupabase();
  const [newName, setNewName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createWorkspace() {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.rpc("create_workspace", { p_name: newName });
    if (e) setError(e.message);
    setBusy(false);
    setNewName("");
    onChanged();
  }

  async function joinWorkspace() {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.rpc("join_workspace_by_code", { p_join_code: joinCode });
    if (e) setError(e.message);
    setBusy(false);
    setJoinCode("");
    onChanged();
  }

  return (
    <div className="actions">
      <h3>Join / Create</h3>
      <label className="label">
        Create workspace
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" />
      </label>
      <button onClick={createWorkspace} disabled={busy || !newName.trim()}>
        Create
      </button>

      <div className="divider" />

      <label className="label">
        Join by code
        <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="Code" />
      </label>
      <button onClick={joinWorkspace} disabled={busy || !joinCode.trim()}>
        Join
      </button>

      {error ? <div className="error">{error}</div> : null}
    </div>
  );
}

function BubbleBoard({ workspace }: { workspace: Workspace }) {
  const supabase = getSupabase();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );

  async function loadTasks() {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("tasks")
      .select("id,title,description,due_date,status,created_at,created_by,workspace_id")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false });
    if (e) {
      setError(e.message);
      setLoading(false);
      return;
    }
    setTasks((data ?? []) as Task[]);
    setLoading(false);
  }

  useEffect(() => {
    void loadTasks();
  }, [workspace.id]);

  async function createTask() {
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      setError("Not signed in.");
      return;
    }

    const { error: e } = await supabase.from("tasks").insert({
      title,
      description,
      due_date: dueDate,
      created_by: uid,
      workspace_id: workspace.id,
    });
    if (e) {
      setError(e.message);
      return;
    }
    setTitle("");
    setDueDate("");
    setDescription("");
    await loadTasks();
  }

  const bubbles = useMemo(() => {
    const seed = workspace.id;
    function hash(str: string) {
      let h = 0;
      for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
      return Math.abs(h);
    }
    return tasks.map((t) => {
      const h = hash(seed + t.id);
      const x = (h % 80) + 5; // 5..85
      const y = ((h / 97) % 80) + 5; // 5..85
      const daysUntilDue = Math.ceil(
        (new Date(t.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      const size = Math.max(70, Math.min(140, 140 - daysUntilDue * 6));
      return { task: t, x, y, size };
    });
  }, [tasks, workspace.id]);

  return (
    <div className="board card">
      <div className="boardHeader">
        <div>
          <h2>{workspace.name}</h2>
          <div className="muted">Click a bubble to view details.</div>
        </div>
        <button className="secondary" onClick={loadTasks}>
          Refresh
        </button>
      </div>

      {loading ? <div>Loading tasks…</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <div className="boardBody">
        <div className="bubbleArea">
          {bubbles.map(({ task, x, y, size }) => (
            <button
              key={task.id}
              className={`bubble ${task.id === selectedTaskId ? "selected" : ""}`}
              style={{
                left: `${x}%`,
                top: `${y}%`,
                width: `${size}px`,
                height: `${size}px`,
              }}
              onClick={() => setSelectedTaskId(task.id)}
              title={task.title}
            >
              <div className="bubbleTitle">{task.title}</div>
              <div className="bubbleSub">{task.due_date}</div>
            </button>
          ))}
        </div>

        <div className="details">
          {selectedTask ? (
            <div>
              <h3>{selectedTask.title}</h3>
              <div className="muted">Due: {selectedTask.due_date}</div>
              <p>{selectedTask.description}</p>
            </div>
          ) : (
            <div className="muted">Select a bubble to see details.</div>
          )}

          <div className="divider" />

          <h3>Create task</h3>
          <label className="label">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="label">
            Due date
            <input value={dueDate} onChange={(e) => setDueDate(e.target.value)} type="date" />
          </label>
          <label className="label">
            Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
          </label>
          <button onClick={createTask} disabled={!title.trim() || !dueDate || !description.trim()}>
            Add bubble
          </button>
        </div>
      </div>
    </div>
  );
}
