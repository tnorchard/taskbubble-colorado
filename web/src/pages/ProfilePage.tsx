import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "../lib/supabaseClient";
import type { Profile, Task, Workspace } from "../types";

type TaskWithWorkspace = Task & { workspace_name?: string };

export function ProfilePage() {
  const supabase = getSupabase();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tasks, setTasks] = useState<TaskWithWorkspace[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const workspaceById = useMemo(() => new Map(workspaces.map((w) => [w.id, w])), [workspaces]);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setError(null);
    const [{ data: userData, error: userErr }, { data: wsData }, { data: taskData }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("workspaces").select("id,name,created_at"),
      supabase.from("tasks").select("id,title,description,due_date,status,created_at,created_by,workspace_id"),
    ]);
    if (userErr) setError(userErr.message);
    const uid = userData.user?.id;
    if (!uid) {
      setError("No user session");
      return;
    }
    const { data: profData, error: profErr } = await supabase
      .from("profiles")
      .select("id,email,display_name,avatar_url")
      .eq("id", uid)
      .maybeSingle();
    if (profErr) setError(profErr.message);
    setProfile((profData as Profile) ?? null);
    setDisplayName(profData?.display_name ?? "");
    const ws = (wsData ?? []) as Workspace[];
    setWorkspaces(ws);
    const wsMap = new Map(ws.map((w) => [w.id, w]));
    const mine = (taskData ?? []).filter((t) => t.created_by === uid) as TaskWithWorkspace[];
    mine.forEach((t) => {
      t.workspace_name = wsMap.get(t.workspace_id)?.name;
    });
    setTasks(mine);
  }

  async function saveProfile() {
    setSaving(true);
    setError(null);
    setNotice(null);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      setError("No user session");
      setSaving(false);
      return;
    }
    const { error: e } = await supabase
      .from("profiles")
      .update({ display_name: displayName.trim() || null })
      .eq("id", uid);
    if (e) setError(e.message);
    else setNotice("Profile updated");
    setSaving(false);
    await load();
  }

  async function sendPasswordReset() {
    setNotice(null);
    setError(null);
    if (!profile?.email) {
      setError("No email on file.");
      return;
    }
    const { error: e } = await supabase.auth.resetPasswordForEmail(profile.email, {
      redirectTo: window.location.origin + "/auth",
    });
    if (e) setError(e.message);
    else setNotice("Password reset email sent.");
  }

  return (
    <div className="screen">
      <div className="screenInner">
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panelTitle">Profile</div>
          {error ? <div className="errorBox">{error}</div> : null}
          {notice ? <div className="noticeBox">{notice}</div> : null}
          <div className="profileGrid">
            <div>
              <label className="field">
                <div className="fieldLabel">Display name</div>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                />
              </label>
              <label className="field">
                <div className="fieldLabel">Email</div>
                <input value={profile?.email ?? ""} readOnly />
              </label>
              <div className="profileActions">
                <button className="primaryBtn btnFull" onClick={saveProfile} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </button>
                <button className="secondaryBtn btnFull" onClick={sendPasswordReset} type="button">
                  Reset password
                </button>
              </div>
            </div>
            <div className="profileCard">
              <div className="panelTitle" style={{ marginBottom: 6 }}>
                Tasks you created
              </div>
              <div className="muted" style={{ marginBottom: 8 }}>
                Title · Workspace
              </div>
              <div className="taskList small">
                {tasks.map((t) => (
                  <div key={t.id} className="taskRow static">
                    <div className="taskRowTitle">{t.title}</div>
                    <div className="taskRowMeta">
                      <span className="chip">{t.workspace_name ?? t.workspace_id}</span>
                    </div>
                  </div>
                ))}
                {tasks.length === 0 ? <div className="muted">No tasks yet.</div> : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


