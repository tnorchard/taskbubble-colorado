import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import type { WorkspaceWithMeta } from "../types";

export function WorkspacesPage() {
  const supabase = getSupabase();
  const nav = useNavigate();

  const [workspaces, setWorkspaces] = useState<WorkspaceWithMeta[]>([]);
  const [username, setUsername] = useState("friend");
  const [myTasks, setMyTasks] = useState<
    Array<{ id: string; title: string; due_date: string; workspace_id: string; company?: string | null }>
  >([]);
  const [tasksICreated, setTasksICreated] = useState<
    Array<{ id: string; title: string; due_date: string; workspace_id: string; company?: string | null }>
  >([]);
  const [workspaceNameById, setWorkspaceNameById] = useState<Map<string, string>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createName, setCreateName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(
    () => [...workspaces].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [workspaces],
  );

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("workspaces")
      .select("id,name,created_at")
      .order("created_at", { ascending: true });
    if (e) {
      setError(e.message);
      setLoading(false);
      return;
    }
    const ws = (data ?? []) as WorkspaceWithMeta[];
    if (ws.length) {
      const ids = ws.map((w) => w.id);
      
      // Fetch member counts
      const { data: memData } = await supabase
        .from("workspace_members")
        .select("workspace_id, user_id")
        .in("workspace_id", ids);
      const memCounts = new Map<string, number>();
      (memData ?? []).forEach((m) => memCounts.set(m.workspace_id, (memCounts.get(m.workspace_id) ?? 0) + 1));
      
      // Fetch task counts
      const { data: taskData } = await supabase
        .from("tasks")
        .select("workspace_id")
        .in("workspace_id", ids)
        .is("deleted_at", null);
      const taskCounts = new Map<string, number>();
      (taskData ?? []).forEach((t) => taskCounts.set(t.workspace_id, (taskCounts.get(t.workspace_id) ?? 0) + 1));

      ws.forEach((w) => {
        w.member_count = memCounts.get(w.id) ?? 0;
        w.task_count = taskCounts.get(w.id) ?? 0;
      });
    }
    setWorkspaces(ws);

    // Load dashboard tasks for the home page
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (uid) {
      // Set username for welcome message
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, email")
        .eq("id", uid)
        .maybeSingle();
      if (profile) {
        setUsername(profile.display_name?.trim() || profile.email?.split("@")[0] || "friend");
      }

      // My tasks = tasks assigned to me (responsible_id)
      const { data: assignedData } = await supabase
        .from("tasks")
        .select("id,title,due_date,workspace_id,company,status")
        .eq("responsible_id", uid)
        .is("deleted_at", null)
        .order("due_date", { ascending: true })
        .limit(8);

      // Tasks I created
      const { data: createdData } = await supabase
        .from("tasks")
        .select("id,title,due_date,workspace_id,company,status")
        .eq("created_by", uid)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(8);

      const assigned = (assignedData ?? []) as Array<{
        id: string;
        title: string;
        due_date: string;
        workspace_id: string;
        company?: string | null;
      }>;
      const created = (createdData ?? []) as Array<{
        id: string;
        title: string;
        due_date: string;
        workspace_id: string;
        company?: string | null;
      }>;

      setMyTasks(assigned);
      setTasksICreated(created);
      const map = new Map<string, string>();
      ws.forEach((w) => map.set(w.id, w.name));
      setWorkspaceNameById(map);
    } else {
      setMyTasks([]);
      setTasksICreated([]);
      setWorkspaceNameById(new Map());
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createWorkspace() {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.rpc("create_workspace", { p_name: createName.trim() });
    if (e) setError(e.message);
    setCreateName("");
    setBusy(false);
    await load();
  }

  async function joinWorkspace() {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.rpc("join_workspace_by_code", { p_join_code: joinCode.trim() });
    if (e) setError(e.message);
    setJoinCode("");
    setBusy(false);
    await load();
  }

  function openWorkspace(id: string) {
    try {
      localStorage.setItem("tb:lastWorkspaceId", id);
    } catch {
      // ignore storage errors
    }
    nav(`/w/${id}`);
  }

  return (
    <div className="screen wsScreen">
      <div className="wsCenter">
        <div className="wsHero">
          <div className="kicker">Home</div>
          <div className="wsTitle">Welcome back, {username}.</div>
          <div className="muted">Pick a workspace or track your tasks across the team.</div>
        </div>

        {error ? <div className="errorBox" style={{ marginBottom: 20 }}>{error}</div> : null}

        <div className="dashboardLayout">
          {/* 1. Workspaces Island */}
          <div className="dashboardMain">
            <div className="dashboardSection">
              <div className="wsCardHeader">
                <div className="wsCardTitle">Workspaces</div>
                {loading ? <div className="muted">Loading…</div> : null}
              </div>
              <div className="wsGrid">
                {sorted.map((w) => (
                  <button key={w.id} className="wsTile" onClick={() => openWorkspace(w.id)} type="button">
                    <div className="wsTileTop">
                      <div className="wsName">{w.name}</div>
                      <div className="wsCount">{w.member_count ?? 0}</div>
                    </div>
                    <div className="wsMeta">
                      {w.member_count ?? 0} member(s) · {w.task_count ?? 0} task(s)
                    </div>
                  </button>
                ))}
                {!loading && sorted.length === 0 ? <div className="muted">No workspaces yet.</div> : null}
              </div>
            </div>
          </div>

          {/* 2. Tasks Island */}
          <div className="dashboardSide">
            <div className="dashboardSection">
              <div className="wsCardHeader">
                <div className="wsCardTitle">My tasks</div>
                <div className="muted">Assigned to you</div>
              </div>
              {myTasks.length ? (
                <div className="wsListStack">
                  {myTasks.map((t) => (
                    <button
                      key={t.id}
                      className="wsTile wsTaskTile"
                      onClick={() => openWorkspace(t.workspace_id)}
                      type="button"
                    >
                      <div className="wsTileTop">
                        <div className="wsName">{t.title}</div>
                        <div className="wsTag">{t.company ?? "N/A"}</div>
                      </div>
                      <div className="wsMeta">
                        Due {t.due_date} · {workspaceNameById.get(t.workspace_id) ?? "Workspace"}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="muted" style={{ padding: "4px 0" }}>Nothing assigned yet.</div>
              )}
            </div>

            <div className="dashboardSection">
              <div className="wsCardHeader">
                <div className="wsCardTitle">Tasks I created</div>
                <div className="muted">Recent</div>
              </div>
              {tasksICreated.length ? (
                <div className="wsListStack">
                  {tasksICreated.map((t) => (
                    <button
                      key={t.id}
                      className="wsTile wsTaskTile"
                      onClick={() => openWorkspace(t.workspace_id)}
                      type="button"
                    >
                      <div className="wsTileTop">
                        <div className="wsName">{t.title}</div>
                        <div className="wsTag">{t.company ?? "N/A"}</div>
                      </div>
                      <div className="wsMeta">
                        Due {t.due_date} · {workspaceNameById.get(t.workspace_id) ?? "Workspace"}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="muted" style={{ padding: "4px 0" }}>No created tasks yet.</div>
              )}
            </div>
          </div>
        </div>

        {/* 3. Actions Island */}
        <div className="dashboardActions">
          <div className="dashboardSection wsMini">
            <div className="miniTitle">Create Workspace</div>
            <label className="field">
              <div className="fieldLabel">Workspace name</div>
              <input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Design Team" />
            </label>
            <button className="primaryBtn btnFull" onClick={createWorkspace} type="button" disabled={busy || !createName.trim()}>
              Create workspace
            </button>
          </div>

          <div className="dashboardSection wsMini">
            <div className="miniTitle">Join Workspace</div>
            <label className="field">
              <div className="fieldLabel">Join code</div>
              <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="e.g. 7a2c91bf10" />
            </label>
            <button className="secondaryBtn btnFull" onClick={joinWorkspace} type="button" disabled={busy || !joinCode.trim()}>
              Join workspace
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


