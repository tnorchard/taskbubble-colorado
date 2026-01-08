# TaskBubble — AI Context / Build Spec (Source of Truth)

Use this document as a complete, accurate description of the TaskBubble project for an AI model to design and build from.

## 1) What TaskBubble is
TaskBubble is a small-team task management web app (target: ~10 people) where tasks are visualized as **floating bubbles** on a board instead of a traditional list.

The intent is to make task tracking feel lightweight and “alive” while still supporting normal task operations (create, view, manage tasks, ownership, due dates).

## 2) What it should do (MVP)

### Authentication
- Users can **sign up** and **sign in** using Supabase Auth (email/password).
- Email confirmation is **not required** for using the app.
- The UI shows whether the user’s email is **confirmed** or **not confirmed**.

### Workspaces (teams/boards)
- The app is organized into **workspaces**.
- A user can:
  - **see workspaces** they belong to
  - **create a workspace**
  - **join a workspace** via a shareable **join code**
  - **switch** between their workspaces
- Every user is automatically enrolled into a default shared workspace named **Home**.

### Tasks (as bubbles)
- A task is created with 3 user inputs:
  - **title**
  - **due date**
  - **description**
- Each task also has system properties:
  - **created_at**
  - **created_by**
  - **workspace_id**
  - **status** (`open`, `in_progress`, `done`, `archived`)
- The bubble board:
  - renders each task as an interactive bubble
  - clicking a bubble shows details
  - bubble sizing is currently biased by how close the due date is (simple heuristic)

## 3) Current implementation status (important)
This repo currently implements:
- Supabase database schema + RLS for **workspaces**, **workspace_members**, **tasks**
- A React (Vite + TypeScript) app under `web/` with:
  - email/password auth screen
  - workspace list + create/join
  - bubble board + create task form

Not implemented yet (do NOT assume these exist):
- chat/messaging
- invitations by email (beyond join code)
- Tailwind CSS / shadcn/ui / React Query (not used currently)
- physics-based bubble simulation (current bubble placement is deterministic, not physics)

## 4) Tech stack (current)
- Frontend: **React + TypeScript** (Vite)
- Backend: **Supabase** (Postgres + Auth + PostgREST + RLS)
- Styling: plain CSS (glassmorphism-inspired) in `web/src/app.css`

## 5) Data model (Supabase / Postgres)

### 5.1 `public.workspaces`
- **id**: uuid (PK)
- **name**: text
- **join_code**: text (unique)
- **created_by**: uuid nullable → `auth.users(id)`
- **created_at**: timestamptz

### 5.2 `public.workspace_members`
(many-to-many membership)
- **workspace_id**: uuid (FK → `workspaces.id`)
- **user_id**: uuid (FK → `auth.users.id`)
- **role**: text enum-like (`owner`, `admin`, `member`)
- **created_at**: timestamptz
- PK: (**workspace_id**, **user_id**)

### 5.3 `public.tasks`
- **id**: uuid (PK)
- **title**: text
- **description**: text
- **due_date**: date
- **status**: text (`open`, `in_progress`, `done`, `archived`)
- **workspace_id**: uuid (FK → `workspaces.id`)
- **created_by**: uuid (FK → `auth.users.id`)
- **created_at**: timestamptz
- **updated_at**: timestamptz (auto-updated)
- **deleted_at**: timestamptz nullable (soft delete ready; not used by UI yet)

### 5.4 View: `public.tasks_with_age`
Computed view for convenience:
- returns all columns from `tasks`
- adds **age_hours** computed as hours since `created_at`

## 6) RLS / permissions (MVP)

### Workspace visibility
- Users can **select workspaces** only if they are a member.

### Membership
- Users can **select their own membership rows**.
- Users can **insert membership rows for themselves** (join a workspace).

### Tasks (workspace-scoped)
- A user can **select tasks** in workspaces they belong to.
- A user can **insert** tasks only if:
  - they belong to the workspace AND
  - `created_by = auth.uid()`
- A user can **update/delete** only tasks they created (MVP), and still must be a workspace member.

## 7) Database automation (functions, triggers, RPC)

### Auto-enroll into Home workspace
- A trigger runs on `auth.users` insert.
- It ensures a shared workspace named **Home** exists (created once).
- It inserts a row into `workspace_members` for the new user.
- There is also a backfill block that enrolls existing users into Home for older accounts.

### RPC helpers
These are used by the frontend:
- `public.create_workspace(p_name text)` → creates workspace + adds current user as `owner`
- `public.join_workspace_by_code(p_join_code text)` → adds current user as `member`

## 8) Frontend app: screens & user flow (current)

### 8.1 Configure Supabase (local dev guard)
If env vars are missing, the app shows instructions to create `web/.env` and restart Vite.

### 8.2 Auth screen
- A single card centered on the page.
- Toggle between **Sign in** and **Sign up**.
- Email + password fields.

### 8.3 Main app layout
- Top bar:
  - “TaskBubble” branding
  - user email + confirmation status (“confirmed” / “not confirmed”)
  - Sign out button
- Left sidebar (Workspaces):
  - list of workspaces (name + join code)
  - create workspace input
  - join workspace by code input
- Main content:
  - bubble board for the selected workspace
  - click bubble → task details panel
  - create task form

## 9) Visual / aesthetic direction (current)
The app currently uses a dark, modern **glassmorphism** aesthetic:
- Dark background with multiple **radial gradients** (subtle color blooms)
- Translucent cards/panels with borders and light blur feel
- Rounded corners throughout
- Bubbles are circular with a soft inner glow-like gradient
- Overall vibe: modern, clean, “floating UI”, not cartoonish

## 10) How to run locally

### 10.1 Frontend
From repo root:

- `cd web`
- `npm install`
- Create `web/.env`:
  - `VITE_SUPABASE_URL=...`
  - `VITE_SUPABASE_ANON_KEY=...`
- `npm run dev`
- Open `http://127.0.0.1:5173/`

### 10.2 Database migrations (Supabase)
The canonical SQL lives in:
- `supabase/migrations/0001_create_tasks.sql`
- `supabase/migrations/0002_workspaces_and_membership.sql`

These migrations are applied to the Supabase project already, via Supabase MCP.

## 11) Product direction (near-term next steps)
Suggested improvements for the next iteration:
- Better bubble layout (physics simulation, collision avoidance, gentle drift)
- Task editing (status updates, due date changes, delete/soft delete)
- Workspace roles (enforce admin/owner permissions for destructive actions)
- Invite links / joining UX polish (copy join code, optional QR, etc.)
- Better “Home” semantics decision:
  - shared team default vs personal workspace per user (currently shared)


