import { Link } from "react-router-dom";

const FEATURES = [
  { icon: "🫧", title: "Bubble Board", desc: "Tasks float as bubbles — the older a task, the bigger it grows. A unique, visual way to see what needs attention." },
  { icon: "📋", title: "Kanban & List Views", desc: "Switch between classic column-based Kanban and compact list views for structured workflows." },
  { icon: "📅", title: "Calendar & Notes", desc: "Plan across all workspaces. Add personal notes, track due dates, and see everything at a glance." },
  { icon: "💬", title: "Real-time Chat", desc: "Workspace channels and a General channel for the whole team. Share files, images, and stay connected." },
  { icon: "🔔", title: "Live Notifications", desc: "Instant alerts for assignments, completions, mentions, and new members joining your workspace." },
  { icon: "🔍", title: "Global Search", desc: "Find any task, workspace, or message instantly with Cmd+K. Search across everything." },
  { icon: "👥", title: "Team Workspaces", desc: "Create teams, invite with a join code, manage members and roles. Full admin controls built in." },
  { icon: "🌗", title: "Dark & Light Themes", desc: "Gorgeous glassmorphism design in both modes. Your preference is saved automatically." },
];

const STATS = [
  { value: "∞", label: "Workspaces" },
  { value: "Real-time", label: "Collaboration" },
  { value: "Free", label: "To get started" },
];

export function LandingPage() {
  return (
    <div className="landingPage">
      {/* ── Top nav ── */}
      <nav className="landingNav">
        <div className="landingNavInner">
          <div className="landingBrand">
            <div className="landingLogo">TB</div>
            <span className="landingBrandName">TaskBubble</span>
          </div>
          <div className="landingNavRight">
            <Link to="/auth" className="landingSignInBtn">Sign In</Link>
            <Link to="/auth?mode=signup" className="landingGetStartedBtnSm">Get Started</Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="landingHero">
        <div className="landingHeroInner">
          <div className="landingBadge">Modern Task Management</div>
          <h1 className="landingHeadline">
            Where tasks <span className="landingGrad">float</span><br />
            and teams <span className="landingGrad">flow</span>.
          </h1>
          <p className="landingSubtext">
            TaskBubble is a modern workspace with visual bubble boards, real-time chat, calendars, 
            and powerful team tools — built for teams that move fast and think visually.
          </p>
          <div className="landingCTAs">
            <Link to="/auth?mode=signup" className="landingCTAPrimary">
              Get Started — It's Free
            </Link>
            <a href="#features" className="landingCTASecondary">
              See Features
            </a>
          </div>

          {/* Stats row */}
          <div className="landingStats">
            {STATS.map((s) => (
              <div key={s.label} className="landingStat">
                <div className="landingStatVal">{s.value}</div>
                <div className="landingStatLabel">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Decorative bubbles */}
        <div className="landingBubblesWrap" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="landingBubble" style={{ ["--i" as never]: i } as never} />
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section className="landingFeatures" id="features">
        <div className="landingFeaturesInner">
          <div className="landingFeaturesHeader">
            <div className="landingSectionBadge">Features</div>
            <h2 className="landingFeaturesTitle">Everything your team needs</h2>
            <p className="landingFeaturesSub">
              From visual task boards to real-time messaging, TaskBubble has the tools to keep your team aligned and productive.
            </p>
          </div>
          <div className="landingFeatureGrid">
            {FEATURES.map((f) => (
              <div key={f.title} className="landingFeatureCard">
                <div className="landingFeatureIcon">{f.icon}</div>
                <h3 className="landingFeatureTitle">{f.title}</h3>
                <p className="landingFeatureDesc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA band ── */}
      <section className="landingCTABand">
        <div className="landingCTABandInner">
          <h2 className="landingCTABandTitle">Ready to get your team flowing?</h2>
          <p className="landingCTABandSub">Create your free account and set up your first workspace in under a minute.</p>
          <Link to="/auth?mode=signup" className="landingCTAPrimary">
            Create Free Account
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="landingFooter">
        <div className="landingFooterInner">
          <div className="landingFooterBrand">
            <div className="landingLogo sm">TB</div>
            <span className="landingFooterName">TaskBubble</span>
          </div>
          <div className="landingFooterRight">
            <span className="landingFooterCopy">&copy; {new Date().getFullYear()} TaskBubble. Built with care.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
