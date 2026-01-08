import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import type { Workspace, WorkspaceWithMeta } from "../types";

export function WorkspacesPage() {
  const supabase = getSupabase();
  const nav = useNavigate();

  const [workspaces, setWorkspaces] = useState<WorkspaceWithMeta[]>([]);
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
      const { data: memData } = await supabase
        .from("workspace_members")
        .select("workspace_id, user_id")
        .in("workspace_id", ids);
      const counts = new Map<string, number>();
      (memData ?? []).forEach((m) => counts.set(m.workspace_id, (counts.get(m.workspace_id) ?? 0) + 1));
      ws.forEach((w) => (w.member_count = counts.get(w.id) ?? 0));
    }
    setWorkspaces(ws);
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
    nav(`/w/${id}`);
  }

  return (
    <div className="screen wsScreen">
      <div className="wsCenter">
        <div className="wsHero">
          <div className="kicker">Workspaces</div>
          <div className="wsTitle">Pick a workspace to open your bubbles.</div>
          <div className="muted">Home is created automatically. You can create or join more any time.</div>
        </div>

        <div className="wsCardShell">
          <div className="wsCardHeader">
            <div className="wsCardTitle">Your workspaces</div>
            {loading ? <div className="muted">Loading…</div> : null}
          </div>

          {error ? <div className="errorBox">{error}</div> : null}

          <div className="wsGrid">
            {sorted.map((w) => (
              <button key={w.id} className="wsTile" onClick={() => openWorkspace(w.id)} type="button">
                <div className="wsTileTop">
                  <div className="wsName">{w.name}</div>
                  <div className="wsCount">{w.member_count ?? 0}</div>
                </div>
                <div className="wsMeta">{w.member_count ?? 0} member(s)</div>
                <div className="wsGo">Open →</div>
              </button>
            ))}
            {!loading && sorted.length === 0 ? <div className="muted">No workspaces yet.</div> : null}
          </div>

          <div className="wsDivider" />

          <div className="wsActions">
            <div className="miniPanel wsMini">
              <div className="miniTitle">Create</div>
              <label className="field">
                <div className="fieldLabel">Workspace name</div>
                <input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Design Team" />
              </label>
              <button className="primaryBtn btnFull" onClick={createWorkspace} type="button" disabled={busy || !createName.trim()}>
                Create workspace
              </button>
            </div>

            <div className="miniPanel wsMini">
              <div className="miniTitle">Join</div>
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
    </div>
  );
}


