import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "./lib/supabaseClient";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AuthPage } from "./pages/AuthPage";
import { WorkspacesPage } from "./pages/WorkspacesPage";
import { BoardPage } from "./pages/BoardPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ChatPage } from "./pages/ChatPage";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      // Don't call Supabase client at all if env vars aren't loaded
      setLoadingSession(false);
      return;
    }

    let supabase;
    try {
      supabase = getSupabase();
    } catch (e) {
      // If something went wrong creating the client, don't blank the app.
      // ErrorBoundary will show the message.
      throw e;
    }
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

  return (
    <AuthedRouter session={session} />
  );
}

function AuthedRouter({ session }: { session: Session | null }) {
  const supabase = getSupabase();
  const nav = useNavigate();
  const loc = useLocation();

  async function signOut() {
    await supabase.auth.signOut();
    nav("/auth");
  }

  // If user isn't authed, force auth screen (except while already there)
  if (!session) {
    if (loc.pathname !== "/auth") return <Navigate to="/auth" replace />;
  }

  // If user is authed and they are on /auth, send them to workspaces
  if (session && loc.pathname === "/auth") return <Navigate to="/workspaces" replace />;

  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route
        path="/workspaces"
        element={
          session ? (
            <AuthedFrame onSignOut={signOut}>
              <WorkspacesPage />
            </AuthedFrame>
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
      <Route
        path="/w/:id"
        element={
          session ? (
            <AuthedFrame onSignOut={signOut}>
              <BoardPage />
            </AuthedFrame>
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
      <Route
        path="/profile"
        element={
          session ? (
            <AuthedFrame onSignOut={signOut}>
              <ProfilePage />
            </AuthedFrame>
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
      <Route
        path="/chat"
        element={
          session ? (
            <AuthedFrame onSignOut={signOut}>
              <ChatPage />
            </AuthedFrame>
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to={session ? "/workspaces" : "/auth"} replace />} />
    </Routes>
  );
}

function AuthedFrame({ children, onSignOut }: { children: React.ReactNode; onSignOut: () => void }) {
  const supabase = getSupabase();
  const loc = useLocation();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [lastWorkspaceId, setLastWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      if (!u) return;
      setUserEmail(u.email ?? null);
      // load display_name for header
      supabase
        .from("profiles")
        .select("display_name")
        .eq("id", u.id)
        .maybeSingle()
        .then(({ data: p }) => setDisplayName(p?.display_name ?? null));
    });
  }, [supabase]);

  // Keep "Workspace" pill pointed at the last opened workspace.
  useEffect(() => {
    const read = () => {
      try {
        setLastWorkspaceId(localStorage.getItem("tb:lastWorkspaceId"));
      } catch {
        setLastWorkspaceId(null);
      }
    };
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);

  const onBoard = loc.pathname.startsWith("/w/");

  const username = displayName?.trim() || (userEmail ? userEmail.split("@")[0] : "me");
  const meInitials = username.slice(0, 2).toUpperCase();

  return (
    <div className="appShell">
      <div className="appTopbar">
        <div className="brandRow">
          <div className="logoMark sm">TB</div>
          <div className="brandText">TaskBubble</div>
        </div>

        <div className="navPills">
          <Link className={`navPill ${loc.pathname === "/workspaces" ? "active" : ""}`} to="/workspaces">
            Home
          </Link>
          <Link
            className={`navPill ${onBoard ? "active" : ""} ${!lastWorkspaceId ? "disabled" : ""}`}
            to={lastWorkspaceId ? `/w/${lastWorkspaceId}` : "/workspaces"}
            aria-disabled={!lastWorkspaceId}
            onClick={(e) => {
              if (!lastWorkspaceId) e.preventDefault();
            }}
          >
            Workspace
          </Link>
          <Link className={`navPill ${loc.pathname === "/chat" ? "active" : ""}`} to="/chat">
            Chat
          </Link>
        </div>

        <div className="spacer" />

        <button
          className="iconBtn"
          type="button"
          title="Notifications"
          onClick={() => setNotifOpen((v) => !v)}
        >
          <span className="notifDot" />
          🔔
        </button>
        {notifOpen ? (
          <div className="popover" role="dialog" aria-label="Notifications">
            <div className="popoverTitle">Notifications</div>
            <div className="muted">Coming soon. This confirms the button is clickable.</div>
          </div>
        ) : null}

        <Link className="userLink" to="/profile" title="Open profile">
          <div className="avatarCircle">{meInitials}</div>
          <div className="userNameText">{username}</div>
        </Link>

        <button className="secondaryBtn headerBtn" onClick={onSignOut} type="button">
          Sign out
        </button>
      </div>

      {children}
    </div>
  );
}
