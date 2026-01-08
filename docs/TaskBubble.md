# TaskBubble — Product & Technical Notes

## What is TaskBubble?
TaskBubble is a web app for a small team (target: **~10 people**) to create, visualize, and manage tasks in a playful, highly visual way: **floating bubbles** on a dashboard, where **each bubble represents a task**.

The core differentiator is the **interactive bubble UI** (not a list/table) while still preserving the fundamentals of task tracking (ownership, due dates, descriptions, created timestamps, status, etc.).

## Primary goals
- **Fast capture**: create a task with minimal friction.
- **Shared visibility**: the whole team can quickly scan what exists and what’s due.
- **Visual prioritization**: tasks feel “alive” and easy to explore via bubbles.

## MVP user experience
### Authentication
- A user can **create an account**.
- A user can **sign in**.

### Workspaces
TaskBubble is organized around **workspaces** (teams/boards).
- A user can **create a workspace**.
- A user can **join a workspace** (MVP: via a shareable join code).
- A user can switch between workspaces they belong to.
- On signup (or first login), every user is automatically enrolled in a default workspace named **Home**.

### Core screen (Bubble Board)
After sign-in, the user lands on a screen showing **floating bubbles**.
- **Each bubble = one task**
- Bubbles can be clicked/tapped to reveal full task details.

### Create task
Creating a task requires 3 inputs:
- **Title**
- **Due date**
- **Description**

Each created task also tracks additional properties:
- **created_at** (date it was created)
- **age_hours** (how many hours since created; computed)
- **created_by** (which user created it)

## Task data model (initial)
### Entity: Task
Required fields (user-provided):
- **title**: string
- **due_date**: date (or timestamp; TBD)
- **description**: text

System fields:
- **id**: UUID
- **workspace_id**: UUID (references workspace)
- **created_at**: timestamp
- **created_by**: UUID (references user)
- **updated_at**: timestamp (optional but recommended)

Derived/computed:
- **age_hours**: number = (now - created_at) / 3600
  - Should be computed in the UI or via a database view, not stored as a constantly-updating field.

Recommended MVP fields (to avoid repainting later):
- **status**: enum (`open`, `in_progress`, `done`, `archived`)
- **assigned_to**: UUID nullable (if tasks can be assigned)
- **deleted_at**: timestamp nullable (soft delete)

## Permissions (initial assumptions)
- A user can only see workspaces they are a member of.
- Within a workspace:
  - Members can **read** tasks in that workspace.
  - Members can **create** tasks in that workspace.
  - A user can **edit/delete** tasks they created (MVP), with an option to expand later (admins, assignees, etc.).

## Bubble behavior (MVP suggestions)
- **Size**: based on proximity to due date (closer due → bigger) or status (open bigger, done smaller).
- **Color**: based on status and urgency.
- **Sorting**: not list-based; but can bias the physics layout (urgent bubbles drift toward center).

## Non-goals (for MVP)
- Complex workflows (dependencies, gantt charts)
- Multi-team org management
- Deep reporting/analytics

## Open questions to confirm
- Is “team of 10” hard-coded (invite-only), or open sign-ups but intended for small teams?
- Should due date include time-of-day and timezone?
- Should tasks be assignable, or just “created by” for MVP?
- Should “Home” be a single shared workspace everyone joins, or a personal workspace per user?


