import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "./lib/supabaseClient";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { LandingPage } from "./pages/LandingPage";
import { AuthPage } from "./pages/AuthPage";
import { WorkspacesPage } from "./pages/WorkspacesPage";
import { BoardPage } from "./pages/BoardPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ChatPage } from "./pages/ChatPage";
import { CalendarPage } from "./pages/CalendarPage";
import type { Notification } from "./types";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoadingSession(false); return; }
    let supabase;
    try { supabase = getSupabase(); } catch (e) { throw e; }
    let isMounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data.session ?? null);
      setLoadingSession(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => { setSession(nextSession); });
    return () => { isMounted = false; sub.subscription.unsubscribe(); };
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <div className="page"><div className="card"><h1>TaskBubble</h1>
        <p>Add your Supabase credentials to <code>web/.env</code> first.</p>
        <ol><li>Copy <code>web/env.example</code> → <code>web/.env</code></li>
        <li>Fill <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code></li>
        <li>Restart the dev server</li></ol></div></div>
    );
  }

  if (loadingSession) return <div className="page"><div className="card">Loading…</div></div>;

  return <AuthedRouter session={session} />;
}

function AuthedRouter({ session }: { session: Session | null }) {
  const supabase = getSupabase();
  const nav = useNavigate();
  const loc = useLocation();

  async function signOut() { await supabase.auth.signOut(); nav("/"); }

  // Public routes (landing + auth) — accessible without session
  const isPublicRoute = loc.pathname === "/" || loc.pathname === "/auth";

  // Don't redirect away from /auth if there's a recovery hash (password reset flow)
  const isRecovery = loc.pathname === "/auth" && (loc.hash.includes("type=recovery") || loc.search.includes("type=recovery"));

  // Redirect authenticated users away from public pages (unless password recovery)
  if (session && isPublicRoute && !isRecovery) return <Navigate to="/workspaces" replace />;

  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/auth" element={<AuthPage />} />
      {/* Authenticated */}
      <Route path="/workspaces" element={session ? <AuthedFrame onSignOut={signOut}><WorkspacesPage /></AuthedFrame> : <Navigate to="/auth" replace />} />
      <Route path="/w/:id" element={session ? <AuthedFrame onSignOut={signOut}><BoardPage /></AuthedFrame> : <Navigate to="/auth" replace />} />
      <Route path="/profile" element={session ? <AuthedFrame onSignOut={signOut}><ProfilePage /></AuthedFrame> : <Navigate to="/auth" replace />} />
      <Route path="/chat" element={session ? <AuthedFrame onSignOut={signOut}><ChatPage /></AuthedFrame> : <Navigate to="/auth" replace />} />
      <Route path="/calendar" element={session ? <AuthedFrame onSignOut={signOut}><CalendarPage /></AuthedFrame> : <Navigate to="/auth" replace />} />
      <Route path="*" element={<Navigate to={session ? "/workspaces" : "/"} replace />} />
    </Routes>
  );
}

/* ── helpers ── */
function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

type SearchResult = { type: "task" | "workspace" | "chat"; id: string; title: string; sub: string; wsId?: string };

function AuthedFrame({ children, onSignOut }: { children: React.ReactNode; onSignOut: () => void }) {
  const supabase = getSupabase();
  const loc = useLocation();
  const nav = useNavigate();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [userColor, setUserColor] = useState<string>("#64b5ff");
  const [userId, setUserId] = useState<string | null>(null);
  const [lastWorkspaceId, setLastWorkspaceId] = useState<string | null>(null);

  // Notifications
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const unreadCount = notifs.filter((n) => !n.read).length;

  // Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimeout = useRef<number | null>(null);

  // Theme
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try { return (localStorage.getItem("tb:theme") as "dark" | "light") || "dark"; } catch { return "dark"; }
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("tb:theme", theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      if (!u) return;
      setUserId(u.id);
      setUserEmail(u.email ?? null);
      supabase.from("profiles").select("display_name,user_color").eq("id", u.id).maybeSingle()
        .then(({ data: p }) => { setDisplayName(p?.display_name ?? null); setUserColor(p?.user_color ?? "#64b5ff"); });
    });
  }, [supabase]);

  // Load notifications
  useEffect(() => {
    if (!userId) return;
    supabase.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30)
      .then(({ data }) => { if (data) setNotifs(data as Notification[]); });

    const channel = supabase.channel(`notif:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => { setNotifs((prev) => [payload.new as Notification, ...prev].slice(0, 50)); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId]);

  // Mark notification as read
  async function markRead(id: string) {
    setNotifs((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    await supabase.from("notifications").update({ read: true }).eq("id", id);
  }

  async function markAllRead() {
    if (!userId) return;
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
    await supabase.from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false);
  }

  // Search
  useEffect(() => {
    if (!searchOpen) return;
    searchRef.current?.focus();
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setSearchOpen(false); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [searchOpen]);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setSearchOpen(true); } };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function onSearchChange(q: string) {
    setSearchQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!q.trim()) { setSearchResults([]); return; }
    searchTimeout.current = window.setTimeout(() => void runSearch(q.trim()), 300);
  }

  async function runSearch(q: string) {
    setSearchLoading(true);
    const results: SearchResult[] = [];

    // Search tasks
    const { data: tasks } = await supabase.from("tasks").select("id,title,workspace_id,company,status").is("deleted_at", null).ilike("title", `%${q}%`).limit(8);
    (tasks ?? []).forEach((t: any) => results.push({ type: "task", id: t.id, title: t.title, sub: `${t.status} ${t.company ? `· ${t.company}` : ""}`, wsId: t.workspace_id }));

    // Search workspaces
    const { data: ws } = await supabase.from("workspaces").select("id,name").ilike("name", `%${q}%`).limit(5);
    (ws ?? []).forEach((w: any) => results.push({ type: "workspace", id: w.id, title: w.name, sub: "Workspace" }));

    // Search chat messages
    const { data: chats } = await supabase.from("chat_messages").select("id,body,workspace_id").ilike("body", `%${q}%`).order("created_at", { ascending: false }).limit(5);
    (chats ?? []).forEach((c: any) => {
      const preview = (c.body as string).length > 60 ? (c.body as string).slice(0, 60) + "…" : c.body;
      results.push({ type: "chat", id: c.id, title: preview, sub: "Chat message", wsId: c.workspace_id });
    });

    // Also search by description
    if (results.length < 10) {
      const { data: descTasks } = await supabase.from("tasks").select("id,title,workspace_id,status").is("deleted_at", null).ilike("description", `%${q}%`).limit(5);
      (descTasks ?? []).forEach((t: any) => {
        if (!results.some((r) => r.id === t.id)) {
          results.push({ type: "task", id: t.id, title: t.title, sub: `${t.status} (matched description)`, wsId: t.workspace_id });
        }
      });
    }

    setSearchResults(results);
    setSearchLoading(false);
  }

  function onSearchSelect(r: SearchResult) {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    if (r.type === "workspace") { nav(`/w/${r.id}`); }
    else if (r.wsId) { nav(`/w/${r.wsId}`); }
  }

  // Workspace nav state
  useEffect(() => {
    const read = () => { try { setLastWorkspaceId(localStorage.getItem("tb:lastWorkspaceId")); } catch { setLastWorkspaceId(null); } };
    read(); window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);

  const onBoard = loc.pathname.startsWith("/w/");
  const username = displayName?.trim() || (userEmail ? userEmail.split("@")[0] : "me");
  const meInitials = username.slice(0, 2).toUpperCase();

  return (
    <div className="appShell">
      <div className="appTopbar">
        <Link className="brandLink" to="/workspaces">
          <div className="logoMark sm">TB</div>
          <div className="brandText">TaskBubble</div>
        </Link>

        <div className="navPills">
          <Link className={`navPill ${loc.pathname === "/workspaces" ? "active" : ""}`} to="/workspaces">
            <span className="navPillIcon">&#9750;</span>Home
          </Link>
          <Link className={`navPill ${onBoard ? "active" : ""} ${!lastWorkspaceId ? "disabled" : ""}`}
            to={lastWorkspaceId ? `/w/${lastWorkspaceId}` : "/workspaces"}
            aria-disabled={!lastWorkspaceId} onClick={(e) => { if (!lastWorkspaceId) e.preventDefault(); }}>
            <span className="navPillIcon">&#9634;</span>Workspace
          </Link>
          <Link className={`navPill ${loc.pathname === "/chat" ? "active" : ""}`} to="/chat">
            <span className="navPillIcon">&#128172;</span>Chat
          </Link>
          <Link className={`navPill ${loc.pathname === "/calendar" ? "active" : ""}`} to="/calendar">
            <span className="navPillIcon">&#128197;</span>Calendar
          </Link>
          <Link className={`navPill ${loc.pathname === "/profile" ? "active" : ""}`} to="/profile">
            <span className="navPillIcon">&#9881;</span>Settings
          </Link>
        </div>

        <div className="spacer" />

        {/* Search */}
        <button className="headerSearchBtn" type="button" onClick={() => setSearchOpen(true)} title="Search (Ctrl+K)">
          <span>&#128269;</span>
          <span className="headerSearchHint">Search…</span>
          <kbd className="headerSearchKbd">⌘K</kbd>
        </button>

        {/* Theme toggle */}
        <button className="iconBtn" type="button" title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          onClick={() => setTheme((t) => t === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "☀" : "☾"}
        </button>

        {/* Notifications */}
        <button className="iconBtn" type="button" title="Notifications" onClick={() => setNotifOpen((v) => !v)} style={{ position: "relative" }}>
          {unreadCount > 0 ? <span className="notifDot" /> : null}
          &#128276;
        </button>

        <Link className="userLink" to="/profile" title="Open profile">
          <div className="avatarCircle" style={{ borderColor: userColor, boxShadow: `0 0 0 2px ${userColor}33` }}>{meInitials}</div>
          <span className="topbarColorDot" style={{ background: userColor }} />
          <div className="userNameText">{username}</div>
        </Link>

        <button className="headerSignOut" onClick={onSignOut} type="button">Sign out</button>
      </div>

      {/* Notification dropdown */}
      {notifOpen ? (
        <div className="notifPanel" onClick={(e) => e.stopPropagation()}>
          <div className="notifPanelHeader">
            <div className="notifPanelTitle">Notifications</div>
            {unreadCount > 0 ? (
              <button className="notifMarkAll" type="button" onClick={() => void markAllRead()}>Mark all read</button>
            ) : null}
          </div>
          <div className="notifPanelList">
            {notifs.length === 0 ? (
              <div className="notifEmpty">No notifications yet</div>
            ) : notifs.map((n) => (
              <button key={n.id} className={`notifItem ${n.read ? "" : "notifUnread"}`} type="button"
                onClick={() => { void markRead(n.id); if (n.workspace_id) nav(`/w/${n.workspace_id}`); setNotifOpen(false); }}>
                <div className="notifItemIcon">
                  {n.kind === "task_assigned" ? "&#9998;" : n.kind === "task_completed" ? "&#10003;" : n.kind === "mention" ? "@" : n.kind === "member_joined" ? "&#43;" : "&#10022;"}
                </div>
                <div className="notifItemBody">
                  <div className="notifItemTitle">{n.title}</div>
                  {n.body ? <div className="notifItemSub">{n.body}</div> : null}
                  <div className="notifItemTime">{relTime(n.created_at)}</div>
                </div>
                {!n.read ? <div className="notifItemDot" /> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Search overlay */}
      {searchOpen ? (
        <div className="searchOverlay" onClick={() => setSearchOpen(false)}>
          <div className="searchModal" onClick={(e) => e.stopPropagation()}>
            <div className="searchInputRow">
              <span className="searchIcon">&#128269;</span>
              <input ref={searchRef} className="searchInput" value={searchQuery} onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search tasks, workspaces, messages…" />
              {searchQuery && <button className="searchClear" type="button" onClick={() => { setSearchQuery(""); setSearchResults([]); }}>&#10005;</button>}
            </div>
            <div className="searchResultsList">
              {searchLoading ? <div className="searchEmpty">Searching…</div> : null}
              {!searchLoading && searchQuery && searchResults.length === 0 ? <div className="searchEmpty">No results for "{searchQuery}"</div> : null}
              {!searchQuery && !searchLoading ? <div className="searchEmpty">Type to search across tasks, workspaces, and chat</div> : null}
              {searchResults.map((r, i) => (
                <button key={`${r.type}-${r.id}-${i}`} className="searchResultItem" type="button" onClick={() => onSearchSelect(r)}>
                  <span className="searchResultType">{r.type === "task" ? "&#9744;" : r.type === "workspace" ? "&#9634;" : "&#128172;"}</span>
                  <div className="searchResultBody">
                    <div className="searchResultTitle">{r.title}</div>
                    <div className="searchResultSub">{r.sub}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {children}
    </div>
  );
}
