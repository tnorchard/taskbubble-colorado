export type Workspace = {
  id: string;
  name: string;
  join_code: string;
  created_at: string;
};

export type TaskStatus = "open" | "in_progress" | "done" | "archived";

export type Task = {
  id: string;
  title: string;
  description: string;
  due_date: string | null; // YYYY-MM-DD (nullable when ASAP)
  is_asap?: boolean;
  status: TaskStatus;
  created_at: string;
  updated_at?: string;
  completed_at?: string | null;
  completed_by?: string | null;
  responsible_id?: string | null;
  company?: string | null;
  created_by: string;
  workspace_id: string;
};

export type TaskWithAge = Task & {
  age_hours: number;
};

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  user_color?: string | null;
  shopify_access?: boolean;
};

export type WorkspaceMember = {
  workspace_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  created_at: string;
};

export type WorkspaceWithMeta = Workspace & {
  member_count?: number;
  task_count?: number;
};

export type Notification = {
  id: string;
  user_id: string;
  kind: "task_assigned" | "task_completed" | "mention" | "member_joined" | "task_created";
  title: string;
  body: string | null;
  workspace_id: string | null;
  task_id: string | null;
  actor_id: string | null;
  read: boolean;
  created_at: string;
};

export type TaskComment = {
  id: string;
  task_id: string;
  user_id: string;
  body: string;
  created_at: string;
};

export type AuditLogEntry = {
  id: string;
  workspace_id: string | null;
  task_id: string | null;
  actor_id: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
};export type CalendarNote = {
  id: string;
  user_id: string;
  note_date: string;
  title: string;
  body: string;
  color: "blue" | "green" | "orange" | "red" | "purple" | "pink";
  is_public: boolean;
  created_at: string;
};
