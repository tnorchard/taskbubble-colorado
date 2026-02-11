import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import { ShopifyDashboard } from "../components/ShopifyDashboard";
import type { WorkspaceWithMeta } from "../types";

/* ── helpers ── */

function fmtDue(d: string | null) {
  if (!d) return "ASAP";
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function daysUntil(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.ceil((d.getTime() - today.getTime()) / 86400000);
}

/* ── types ── */

type TaskRow = {
  id: string;
  title: string;
  due_date: string | null;
  workspace_id: string;
  company?: string | null;
  status?: string;
  created_at: string;
  updated_at?: string;
  completed_at?: string | null;
  completed_by?: string | null;
  responsible_id?: string | null;
  created_by?: string;
};

type ActivityItem = {
  id: string;
  icon: string;
  text: string;
  sub: string;
  time: string;
  wsId: string;
  actorId?: string | null;
};

type WsExtra = WorkspaceWithMeta & {
  done_count: number;
  last_activity: string | null;
  has_unread: boolean;
};

export function WorkspacesPage() {
  const supabase = getSupabase();
  const nav = useNavigate();

  const [workspaces, setWorkspaces] = useState<WsExtra[]>([]);
  const [username, setUsername] = useState("friend");
  const [myTasks, setMyTasks] = useState<TaskRow[]>([]);
  const [allTasks, setAllTasks] = useState<TaskRow[]>([]);
  const [profileMap, setProfileMap] = useState<Map<string, string>>(new Map());
  const [profileColorMap, setProfileColorMap] = useState<Map<string, string>>(new Map());
  const [myColor, setMyColor] = useState("#64b5ff");
  const [shopifyStoreIds, setShopifyStoreIds] = useState<string[]>([]);
  const [workspaceNameById, setWorkspaceNameById] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createName, setCreateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const sorted = useMemo(
    () => [...workspaces].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [workspaces],
  );

  /* ── due soon / overdue ── */
  const dueSoon = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return myTasks
      .filter((t) => {
        if (t.status === "done" || t.status === "archived") return false;
        if (!t.due_date) return true; // ASAP = always urgent
        const d = daysUntil(t.due_date);
        return d <= 2; // due within 48h or overdue
      })
      .sort((a, b) => {
        if (!a.due_date) return -1;
        if (!b.due_date) return 1;
        return a.due_date.localeCompare(b.due_date);
      })
      .slice(0, 6);
  }, [myTasks]);

  /* ── activity feed ── */
  const activity = useMemo(() => {
    const items: ActivityItem[] = [];
    const wsMap = workspaceNameById;

    // Recently created tasks (last 7 days)
    const weekAgo = Date.now() - 7 * 86400000;
    allTasks.forEach((t) => {
      const ca = new Date(t.created_at).getTime();
      if (ca > weekAgo) {
        const who = t.created_by ? (profileMap.get(t.created_by) ?? "Someone") : "Someone";
        items.push({
          id: `created-${t.id}`,
          icon: "✦",
          text: `${who} created "${t.title}"`,
          sub: wsMap.get(t.workspace_id) ?? "Workspace",
          time: t.created_at,
          wsId: t.workspace_id,
          actorId: t.created_by,
        });
      }
      // Recently completed
      if (t.completed_at) {
        const ct = new Date(t.completed_at).getTime();
        if (ct > weekAgo) {
          const who = t.completed_by ? (profileMap.get(t.completed_by) ?? "Someone") : "Someone";
          items.push({
            id: `done-${t.id}`,
            icon: "✓",
            text: `${who} completed "${t.title}"`,
            sub: wsMap.get(t.workspace_id) ?? "Workspace",
            time: t.completed_at,
            wsId: t.workspace_id,
            actorId: t.completed_by,
          });
        }
      }
    });

    items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    return items.slice(0, 10);
  }, [allTasks, workspaceNameById, profileMap]);

  /* ── quick actions ── */
  const lastWsId = useMemo(() => {
    try { return localStorage.getItem("tb:lastWorkspaceId"); } catch { return null; }
  }, [workspaces]);

  const lastWsName = lastWsId ? workspaceNameById.get(lastWsId) : null;

  /* ── load ── */
  async function load() {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("workspaces").select("id,name,created_at").order("created_at", { ascending: true });
    if (e) { setError(e.message); setLoading(false); return; }

    const ws = (data ?? []) as WsExtra[];
    const ids = ws.map((w) => w.id);

    // Parallel fetches
    const [memRes, taskRes, userRes] = await Promise.all([
      ids.length ? supabase.from("workspace_members").select("workspace_id,user_id").in("workspace_id", ids) : { data: [] },
      ids.length ? supabase.from("tasks").select("id,title,due_date,workspace_id,company,status,created_at,updated_at,completed_at,completed_by,responsible_id,created_by").in("workspace_id", ids).is("deleted_at", null) : { data: [] },
      supabase.auth.getUser(),
    ]);

    const members = (memRes.data ?? []) as Array<{ workspace_id: string; user_id: string }>;
    const tasks = (taskRes.data ?? []) as TaskRow[];
    const currentUid = userRes.data.user?.id ?? null;

    // Collect unique user ids for profile names
    const userIds = new Set<string>();
    tasks.forEach((t) => {
      if (t.created_by) userIds.add(t.created_by);
      if (t.completed_by) userIds.add(t.completed_by);
    });
    let profMap = new Map<string, string>();
    const colorMap = new Map<string, string>();
    if (userIds.size > 0) {
      const { data: profData } = await supabase.from("profiles").select("id,display_name,email,user_color").in("id", Array.from(userIds));
      ((profData ?? []) as Array<{ id: string; display_name: string | null; email: string | null; user_color: string | null }>).forEach((p) => {
        profMap.set(p.id, p.display_name?.trim() || p.email?.split("@")[0] || "User");
        if (p.user_color) colorMap.set(p.id, p.user_color);
      });
    }
    setProfileMap(profMap);
    setProfileColorMap(colorMap);

    // Member counts
    const memCounts = new Map<string, number>();
    members.forEach((m) => memCounts.set(m.workspace_id, (memCounts.get(m.workspace_id) ?? 0) + 1));

    // Task counts + done counts + last activity
    const taskCounts = new Map<string, number>();
    const doneCounts = new Map<string, number>();
    const lastAct = new Map<string, string>();
    tasks.forEach((t) => {
      taskCounts.set(t.workspace_id, (taskCounts.get(t.workspace_id) ?? 0) + 1);
      if (t.status === "done") doneCounts.set(t.workspace_id, (doneCounts.get(t.workspace_id) ?? 0) + 1);
      const ts = t.completed_at ?? t.updated_at ?? t.created_at;
      const prev = lastAct.get(t.workspace_id);
      if (!prev || ts > prev) lastAct.set(t.workspace_id, ts);
    });

    // Unread chat – messages not by me in last 24h
    let unreadWs = new Set<string>();
    if (currentUid && ids.length) {
      const cutoff = new Date(Date.now() - 24 * 3600000).toISOString();
      const { data: chatData } = await supabase
        .from("chat_messages")
        .select("workspace_id")
        .in("workspace_id", ids)
        .neq("user_id", currentUid)
        .gte("created_at", cutoff)
        .limit(100);
      ((chatData ?? []) as Array<{ workspace_id: string }>).forEach((c) => unreadWs.add(c.workspace_id));
    }

    ws.forEach((w) => {
      w.member_count = memCounts.get(w.id) ?? 0;
      w.task_count = taskCounts.get(w.id) ?? 0;
      w.done_count = doneCounts.get(w.id) ?? 0;
      w.last_activity = lastAct.get(w.id) ?? null;
      w.has_unread = unreadWs.has(w.id);
    });
    setWorkspaces(ws);

    const wsNameMap = new Map<string, string>();
    ws.forEach((w) => wsNameMap.set(w.id, w.name));
    setWorkspaceNameById(wsNameMap);

    setAllTasks(tasks);

    // Current user profile + assigned tasks
    if (currentUid) {
      const [{ data: profile }, { data: accessRows }] = await Promise.all([
        supabase.from("profiles").select("display_name,email,user_color").eq("id", currentUid).maybeSingle(),
        supabase.from("user_shopify_access").select("store_id").eq("user_id", currentUid),
      ]);
      if (profile) {
        setUsername(profile.display_name?.trim() || profile.email?.split("@")[0] || "friend");
        setMyColor(profile.user_color ?? "#64b5ff");
      }
      setShopifyStoreIds(((accessRows ?? []) as Array<{ store_id: string }>).map((r) => r.store_id));
      setMyTasks(tasks.filter((t) => t.responsible_id === currentUid));
    } else {
      setMyTasks([]);
    }

    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function createWorkspace() {
    if (!createName.trim()) return;
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc("create_workspace", { p_name: createName.trim() });
    if (e) setError(e.message);
    setCreateName(""); setCreateOpen(false); setBusy(false);
    await load();
  }

  function openWorkspace(id: string) {
    try { localStorage.setItem("tb:lastWorkspaceId", id); } catch { /* ignore */ }
    nav(`/w/${id}`);
  }

  const totalTasks = workspaces.reduce((s, w) => s + (w.task_count ?? 0), 0);
  const totalMembers = workspaces.reduce((s, w) => s + (w.member_count ?? 0), 0);
  const totalDone = workspaces.reduce((s, w) => s + (w.done_count ?? 0), 0);

  return (
    <div className="screen">
      <div className="screenInner" style={{ maxWidth: 1100 }}>
        {/* ── Hero ── */}
        <div className="homeHero">
          <div className="homeHeroText">
            <div className="homeGreeting">
              <span className="homeUserColorDot" style={{ background: myColor }} />
              Welcome back, {username}
            </div>
            <div className="homeSubtext">
              {loading
                ? "Loading your dashboard…"
                : `${workspaces.length} workspace${workspaces.length !== 1 ? "s" : ""} · ${totalTasks} task${totalTasks !== 1 ? "s" : ""} · ${totalDone} done · ${totalMembers} member${totalMembers !== 1 ? "s" : ""}`}
            </div>
          </div>
          <button className="homeCreateBtn" type="button" onClick={() => setCreateOpen((v) => !v)}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
            New Workspace
          </button>
        </div>

        {/* ── Inline Create ── */}
        {createOpen ? (
          <div className="homeCreateBar">
            <input className="homeCreateInput" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Workspace name…" autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") void createWorkspace(); if (e.key === "Escape") setCreateOpen(false); }} />
            <button className="primaryBtn" onClick={() => void createWorkspace()} disabled={busy || !createName.trim()} type="button">{busy ? "Creating…" : "Create"}</button>
            <button className="homeCreateCancel" onClick={() => { setCreateOpen(false); setCreateName(""); }} type="button">Cancel</button>
          </div>
        ) : null}

        {error ? <div className="profileToast profileToastError">{error}</div> : null}

        {/* ── Quick Actions ── */}
        {!loading ? (
          <div className="homeQuickActions">
            {lastWsId && lastWsName ? (
              <button className="homeQA" type="button" onClick={() => openWorkspace(lastWsId)}>
                <span className="homeQAIcon">&#9654;</span>
                Continue in {lastWsName}
              </button>
            ) : null}
            {lastWsId ? (
              <button className="homeQA" type="button" onClick={() => { nav(`/w/${lastWsId}`); }}>
                <span className="homeQAIcon">+</span>
                New Task
              </button>
            ) : null}
            <button className="homeQA" type="button" onClick={() => nav("/chat")}>
              <span className="homeQAIcon">&#128172;</span>
              Open Chat
            </button>
            <button className="homeQA" type="button" onClick={() => nav("/profile")}>
              <span className="homeQAIcon">&#9881;</span>
              Profile
            </button>
          </div>
        ) : null}

        {/* ── Due Soon / Overdue ── */}
        {dueSoon.length > 0 ? (
          <div className="homeDueSoon">
            <div className="homeDueSoonHeader">
              <div className="homeDueSoonIcon">&#9888;</div>
              <div>
                <div className="homeDueSoonTitle">Needs Attention</div>
                <div className="homeDueSoonSub">{dueSoon.length} task{dueSoon.length !== 1 ? "s" : ""} due soon or overdue</div>
              </div>
            </div>
            <div className="homeDueSoonList">
              {dueSoon.map((t) => {
                const days = t.due_date ? daysUntil(t.due_date) : null;
                const isOverdue = days !== null && days < 0;
                const isToday = days === 0;
                const isAsap = t.due_date === null;
                let label = "";
                let cls = "";
                if (isAsap) { label = "ASAP"; cls = "homeUrgAsap"; }
                else if (isOverdue) { label = `${Math.abs(days!)}d overdue`; cls = "homeUrgOverdue"; }
                else if (isToday) { label = "Due today"; cls = "homeUrgToday"; }
                else { label = `Due in ${days}d`; cls = "homeUrgSoon"; }
                return (
                  <button key={t.id} className="homeDueCard" type="button" onClick={() => openWorkspace(t.workspace_id)}>
                    <div className="homeDueTitle">{t.title}</div>
                    <div className="homeDueMeta">
                      <span className={`homeDueBadge ${cls}`}>{label}</span>
                      <span className="homeWsDot" />
                      <span>{workspaceNameById.get(t.workspace_id) ?? "Workspace"}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* ── Shopify Dashboard (per-store access-gated) ── */}
        {shopifyStoreIds.length > 0 ? <ShopifyDashboard allowedStoreIds={shopifyStoreIds} /> : null}

        {/* ── Main Grid ── */}
        <div className="homeGrid">
          {/* Left: Workspaces */}
          <div className="homeSection">
            <div className="homeSectionHeader">
              <div className="homeSectionTitle">Workspaces</div>
              <div className="homeSectionCount">{workspaces.length}</div>
            </div>
            <div className="homeWsGrid">
              {sorted.map((w) => {
                const total = w.task_count ?? 0;
                const done = w.done_count ?? 0;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                return (
                  <button key={w.id} className="homeWsCard" onClick={() => openWorkspace(w.id)} type="button">
                    <div className="homeWsIconWrap">
                      <div className="homeWsIcon">{w.name === "Home" ? "\u2302" : w.name.charAt(0).toUpperCase()}</div>
                      {w.has_unread ? <div className="homeWsUnread" /> : null}
                    </div>
                    <div className="homeWsBody">
                      <div className="homeWsName">
                        {w.name}
                        {w.has_unread ? <span className="homeWsChatBadge">new</span> : null}
                      </div>
                      <div className="homeWsMeta">
                        <span>{w.member_count ?? 0} member{(w.member_count ?? 0) !== 1 ? "s" : ""}</span>
                        <span className="homeWsDot" />
                        <span>{total} task{total !== 1 ? "s" : ""}</span>
                        {w.last_activity ? (
                          <><span className="homeWsDot" /><span>{relTime(w.last_activity)}</span></>
                        ) : null}
                      </div>
                      {/* Progress bar */}
                      {total > 0 ? (
                        <div className="homeWsProgress">
                          <div className="homeWsProgressTrack">
                            <div className="homeWsProgressFill" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="homeWsProgressLabel">{pct}%</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="homeWsArrow">&#8250;</div>
                  </button>
                );
              })}
              {!loading && sorted.length === 0 ? (
                <div className="muted" style={{ padding: 20, textAlign: "center" }}>No workspaces yet. Create one above.</div>
              ) : null}
            </div>
          </div>

          {/* Right column: My Tasks + Activity */}
          <div className="homeRightCol">
            {/* My Tasks */}
            <div className="homeSection">
              <div className="homeSectionHeader">
                <div>
                  <div className="homeSectionTitle">My Tasks</div>
                  <div className="homeSectionSub">Assigned to you</div>
                </div>
                <div className="homeSectionCount">{myTasks.length}</div>
              </div>
              <div className="homeTaskList">
                {myTasks.length === 0 ? (
                  <div className="homeTaskEmpty">
                    <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>&#9744;</div>
                    <div>Nothing assigned to you yet</div>
                  </div>
                ) : (
                  myTasks.slice(0, 8).map((t) => (
                    <button key={t.id} className={`homeTaskCard ${t.status === "done" ? "homeTaskDone" : ""}`} onClick={() => openWorkspace(t.workspace_id)} type="button">
                      <div className="homeTaskTop">
                        <div className="homeTaskTitle">{t.title}</div>
                        {t.status === "done" ? (
                          <span className="homeTaskBadge homeTaskBadgeDone">Done</span>
                        ) : !t.due_date ? (
                          <span className="homeTaskBadge homeTaskBadgeAsap">ASAP</span>
                        ) : daysUntil(t.due_date) < 0 ? (
                          <span className="homeTaskBadge homeTaskBadgeOverdue">Overdue</span>
                        ) : null}
                      </div>
                      <div className="homeTaskMeta">
                        <span>Due {fmtDue(t.due_date)}</span>
                        <span className="homeWsDot" />
                        <span>{workspaceNameById.get(t.workspace_id) ?? "Workspace"}</span>
                        {t.company ? <><span className="homeWsDot" /><span className="homeTaskCompany">{t.company}</span></> : null}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Activity Feed */}
            {activity.length > 0 ? (
              <div className="homeSection">
                <div className="homeSectionHeader">
                  <div>
                    <div className="homeSectionTitle">Recent Activity</div>
                    <div className="homeSectionSub">Across all workspaces</div>
                  </div>
                </div>
                <div className="homeActivityList">
                  {activity.map((a) => (
                    <button key={a.id} className="homeActivityRow" type="button" onClick={() => openWorkspace(a.wsId)}>
                      <div className={`homeActivityIcon ${a.icon === "✓" ? "homeActivityDone" : ""}`}
                        style={a.actorId && profileColorMap.has(a.actorId) ? { borderColor: profileColorMap.get(a.actorId), boxShadow: `0 0 0 2px ${profileColorMap.get(a.actorId)}33` } : undefined}>
                        {a.icon}</div>
                      <div className="homeActivityBody">
                        <div className="homeActivityText">{a.text}</div>
                        <div className="homeActivityMeta">
                          <span>{a.sub}</span>
                          <span className="homeWsDot" />
                          <span>{relTime(a.time)}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
