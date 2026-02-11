import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";

type Mode = "signin" | "signup" | "forgot";

export function AuthPage() {
  const supabase = getSupabase();
  const [searchParams] = useSearchParams();

  const [mode, setMode] = useState<Mode>(() => {
    const m = searchParams.get("mode");
    if (m === "signup") return "signup";
    return "signin";
  });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Reset messages when switching modes
  useEffect(() => { setError(null); setSuccess(null); }, [mode]);

  const canSubmit = useMemo(() => {
    if (!email.trim() || email.trim().length < 4) return false;
    if (mode === "forgot") return true;
    if (password.length < 6) return false;
    if (mode === "signup" && !fullName.trim()) return false;
    return true;
  }, [email, password, fullName, mode]);

  function friendlyError(msg: string): string {
    if (msg.includes("rate limit") || msg.includes("rate_limit"))
      return "Too many requests — please wait a few minutes and try again.";
    if (msg.includes("User already registered"))
      return "An account with this email already exists. Try signing in instead.";
    if (msg.includes("Invalid login credentials"))
      return "Incorrect email or password. Please try again.";
    if (msg.includes("Password should be at least"))
      return "Password must be at least 6 characters.";
    return msg;
  }

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      if (mode === "forgot") {
        const { error: e } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/auth`,
        });
        if (e) throw e;
        setSuccess("Password reset email sent! Check your inbox.");
        return;
      }

      if (mode === "signin") {
        const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (e) throw e;
      } else {
        const { data, error: e } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: fullName.trim(),
              display_name: displayName.trim() || fullName.trim().split(" ")[0],
            },
          },
        });
        if (e) throw e;

        if (data.user) {
          const dn = displayName.trim() || fullName.trim().split(" ")[0];
          await supabase.from("profiles").upsert({
            id: data.user.id,
            display_name: dn,
            email: email.trim(),
          }, { onConflict: "id" });
        }

        setSuccess("Account created! You can now sign in.");
        setMode("signin");
        setPassword("");
        return;
      }
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : "Unknown error"));
    } finally {
      setBusy(false);
    }
  }

  const headings: Record<Mode, { title: string; sub: string }> = {
    signin: { title: "Welcome back", sub: "Sign in to access your workspaces." },
    signup: { title: "Create your account", sub: "Set up your profile and get started." },
    forgot: { title: "Reset your password", sub: "Enter your email and we'll send you a reset link." },
  };

  return (
    <div className="authPage">
      {/* Minimal top bar */}
      <nav className="authPageNav">
        <Link to="/" className="authPageBrand">
          <div className="landingLogo sm">TB</div>
          <span className="authPageBrandName">TaskBubble</span>
        </Link>
      </nav>

      <div className="authPageCenter">
        <div className="authCard3">
          {/* Tabs — only show for signin / signup */}
          {mode !== "forgot" ? (
            <div className="authTabs3">
              <button className={`authTab3 ${mode === "signin" ? "active" : ""}`} onClick={() => setMode("signin")} type="button" disabled={busy}>
                Sign In
              </button>
              <button className={`authTab3 ${mode === "signup" ? "active" : ""}`} onClick={() => setMode("signup")} type="button" disabled={busy}>
                Sign Up
              </button>
            </div>
          ) : null}

          {/* Header */}
          <div className="authCard3Header">
            <h1 className="authCard3Title">{headings[mode].title}</h1>
            <p className="authCard3Sub">{headings[mode].sub}</p>
          </div>

          {success ? <div className="authSuccess">{success}</div> : null}
          {error ? <div className="authError">{error}</div> : null}

          {/* Name fields for signup */}
          {mode === "signup" ? (
            <>
              <label className="authField">
                <div className="authFieldLabel">Full Name <span className="authRequired">*</span></div>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} type="text"
                  placeholder="John Doe" autoComplete="name" />
              </label>
              <label className="authField">
                <div className="authFieldLabel">Display Name <span className="authOptional">(optional)</span></div>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} type="text"
                  placeholder={fullName.trim().split(" ")[0] || "Johnny"} autoComplete="username" />
                <div className="authFieldHint">What others see. Defaults to first name.</div>
              </label>
            </>
          ) : null}

          {/* Email */}
          <label className="authField">
            <div className="authFieldLabel">Email <span className="authRequired">*</span></div>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
              placeholder="you@company.com" autoComplete="email" />
          </label>

          {/* Password — not shown on forgot */}
          {mode !== "forgot" ? (
            <label className="authField">
              <div className="authFieldLabel">Password <span className="authRequired">*</span></div>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password"
                placeholder="At least 6 characters" autoComplete={mode === "signin" ? "current-password" : "new-password"}
                onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
            </label>
          ) : null}

          {/* Forgot password link (sign-in mode only) */}
          {mode === "signin" ? (
            <div className="authForgotRow">
              <button type="button" className="authForgotLink" onClick={() => setMode("forgot")}>
                Forgot your password?
              </button>
            </div>
          ) : null}

          {/* Submit */}
          <button className="authSubmitBtn" onClick={() => void submit()} disabled={!canSubmit || busy} type="button">
            {busy
              ? "Working…"
              : mode === "signin"
              ? "Sign In"
              : mode === "signup"
              ? "Create Account"
              : "Send Reset Link"}
          </button>

          {/* Footer links */}
          <div className="authCard3Footer">
            {mode === "signin" ? (
              <span>Don't have an account? <button type="button" className="authSwitchLink" onClick={() => setMode("signup")}>Sign up</button></span>
            ) : mode === "signup" ? (
              <span>Already have an account? <button type="button" className="authSwitchLink" onClick={() => setMode("signin")}>Sign in</button></span>
            ) : (
              <span>Remember your password? <button type="button" className="authSwitchLink" onClick={() => setMode("signin")}>Back to sign in</button></span>
            )}
          </div>
        </div>
      </div>

      {/* Subtle decorative bubbles */}
      <div className="authPageBubbles" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="authPageBubble" style={{ ["--i" as never]: i } as never} />
        ))}
      </div>
    </div>
  );
}
