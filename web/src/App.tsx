import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "./lib/supabaseClient";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AuthPage } from "./pages/AuthPage";
import { WorkspacesPage } from "./pages/WorkspacesPage";
import { BoardPage } from "./pages/BoardPage";

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
      <Route path="*" element={<Navigate to={session ? "/workspaces" : "/auth"} replace />} />
    </Routes>
  );
}

function AuthedFrame({ children, onSignOut }: { children: React.ReactNode; onSignOut: () => void }) {
  const supabase = getSupabase();
  const loc = useLocation();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isEmailConfirmed, setIsEmailConfirmed] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      if (!u) return;
      setUserEmail(u.email ?? null);
      const confirmedAt = (u as unknown as { email_confirmed_at?: string | null; confirmed_at?: string | null })
        .email_confirmed_at ?? (u as unknown as { confirmed_at?: string | null }).confirmed_at ?? null;
      setIsEmailConfirmed(Boolean(confirmedAt));
    });
  }, [supabase]);

  const onBoard = loc.pathname.startsWith("/w/");

  function newTask() {
    window.dispatchEvent(new Event("tb:newTask"));
  }

  const meInitials = userEmail ? userEmail.split("@")[0].slice(0, 2).toUpperCase() : "ME";

  return (
    <div className="appShell">
      <div className="appTopbar">
        <div className="brandRow">
          <div className="logoMark sm">TB</div>
          <div className="brandText">TaskBubbles</div>
        </div>

        <div className="navPills">
          <Link className={`navPill ${loc.pathname === "/workspaces" ? "active" : ""}`} to="/workspaces">
            Workspaces
          </Link>
          <div className={`navPill ${onBoard ? "active" : "disabled"}`}>{onBoard ? "Tasks" : "Tasks"}</div>
          <div className="navPill disabled">Chat</div>
        </div>

        <div className="spacer" />

        {onBoard ? (
          <button className="primaryBtn headerPrimary" onClick={newTask} type="button">
            + New Task
          </button>
        ) : null}

        <button className="iconBtn" type="button" title="Notifications (coming soon)">
          <span className="notifDot" />
          🔔
        </button>

        <div className="avatarCircle" title={userEmail ?? "User"}>
          {meInitials}
        </div>

        {userEmail ? (
          <div className={`userBadge ${isEmailConfirmed ? "ok" : "warn"}`} title="Email confirmation status">
            {isEmailConfirmed ? "confirmed" : "not confirmed"}
          </div>
        ) : null}

        <button className="secondaryBtn" onClick={onSignOut} type="button">
          Sign out
        </button>
      </div>

      {children}
    </div>
  );
}
