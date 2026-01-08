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
  due_date: string; // YYYY-MM-DD
  status: TaskStatus;
  created_at: string;
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
};

export type WorkspaceMember = {
  workspace_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  created_at: string;
};


