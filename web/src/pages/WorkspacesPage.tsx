import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import type { Workspace } from "../types";

export function WorkspacesPage() {
  const supabase = getSupabase();
  const nav = useNavigate();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
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
      .select("id,name,join_code,created_at")
      .order("created_at", { ascending: true });
    if (e) {
      setError(e.message);
      setLoading(false);
      return;
    }
    setWorkspaces((data ?? []) as Workspace[]);
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
    <div className="screen">
      <div className="screenInner">
        <div className="headerRow">
          <div>
            <div className="kicker">Workspaces</div>
            <h1 className="h1">Choose where you want to work.</h1>
            <div className="muted">
              You’re automatically enrolled in <b>Home</b>. Create or join more workspaces any time.
            </div>
          </div>
        </div>

        <div className="grid2">
          <div className="panel">
            <div className="panelTitle">Your workspaces</div>
            {loading ? <div className="muted">Loading…</div> : null}
            {error ? <div className="errorBox">{error}</div> : null}

            <div className="wsList">
              {sorted.map((w) => (
                <button key={w.id} className="wsCard" onClick={() => openWorkspace(w.id)} type="button">
                  <div className="wsName">{w.name}</div>
                  <div className="wsMeta">Join code: {w.join_code}</div>
                  <div className="wsGo">Open →</div>
                </button>
              ))}
              {!loading && sorted.length === 0 ? <div className="muted">No workspaces yet.</div> : null}
            </div>
          </div>

          <div className="panel">
            <div className="panelTitle">Join or create</div>

            <div className="split">
              <div className="miniPanel">
                <div className="miniTitle">Create a workspace</div>
                <label className="field">
                  <div className="fieldLabel">Name</div>
                  <input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Design Team" />
                </label>
                <button
                  className="primaryBtn"
                  onClick={createWorkspace}
                  type="button"
                  disabled={busy || !createName.trim()}
                >
                  Create
                </button>
              </div>

              <div className="miniPanel">
                <div className="miniTitle">Join with a code</div>
                <label className="field">
                  <div className="fieldLabel">Code</div>
                  <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="e.g. 7a2c91bf10" />
                </label>
                <button className="secondaryBtn" onClick={joinWorkspace} type="button" disabled={busy || !joinCode.trim()}>
                  Join
                </button>
              </div>
            </div>

            <div className="muted" style={{ marginTop: 12 }}>
              Tip: click a workspace card to open the bubble board.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


