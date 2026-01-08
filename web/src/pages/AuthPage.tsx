import { useMemo, useState } from "react";
import { getSupabase } from "../lib/supabaseClient";

export function AuthPage() {
  const supabase = getSupabase();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => email.trim().length > 3 && password.length >= 6, [email, password]);

  async function submit() {
    if (!canSubmit) return;
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
    <div className="authShell">
      <div className="authLeft">
        <div className="logoMark">TB</div>
        <h1 className="authHeadline">
          Tasks that <span className="gradText">float</span>.
        </h1>
        <p className="authSub">
          A modern team task board where each task becomes a bubble. Create, join a workspace, and keep your
          team moving.
        </p>

        <div className="authBubbles" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="decorBubble" style={{ ["--i" as never]: i } as never} />
          ))}
        </div>
      </div>

      <div className="authRight">
        <div className="authCard">
          <div className="authTabs">
            <button
              className={`tab ${mode === "signin" ? "active" : ""}`}
              onClick={() => setMode("signin")}
              type="button"
              disabled={busy}
            >
              Sign in
            </button>
            <button
              className={`tab ${mode === "signup" ? "active" : ""}`}
              onClick={() => setMode("signup")}
              type="button"
              disabled={busy}
            >
              Sign up
            </button>
          </div>

          <div className="authTitle">
            <div className="titleLg">{mode === "signin" ? "Welcome back" : "Create your account"}</div>
            <div className="muted">
              {mode === "signin" ? "Sign in to your workspaces." : "You’ll be enrolled in Home automatically."}
            </div>
          </div>

          <label className="field">
            <div className="fieldLabel">Email</div>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@company.com" />
          </label>

          <label className="field">
            <div className="fieldLabel">Password</div>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="At least 6 characters"
            />
          </label>

          {error ? <div className="errorBox">{error}</div> : null}

          <button className="primaryBtn" onClick={submit} disabled={!canSubmit || busy} type="button">
            {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>

          <div className="authFinePrint">
            Email confirmation is optional. If your account isn’t confirmed, you’ll see <b>not confirmed</b> in the
            header.
          </div>
        </div>
      </div>
    </div>
  );
}


