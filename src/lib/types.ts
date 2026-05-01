export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface OrganizerTask {
  id: string;
  title: string;
  description: string | null;
  category: string;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type LiveStatus =
  | 'Scheduled'
  | 'Prepare'
  | 'Next'
  | 'In Progress'
  | 'Finished'
  | 'Absent'
  | 'Delayed';

export interface Category {
  id: string;
  name: string;
  age_range_label: string | null;
  table_count: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Table {
  id: string;
  category_id: string;
  table_number: number;
  display_label: string | null;
  active: boolean;
  created_at: string;
}

export interface Passation {
  id: string;
  team_name: string;
  student_names: string | null;
  coach_name: string | null;
  parent_name: string | null;
  parent_contact: string | null;
  club_name: string | null;
  date_of_birth: string | null;
  category_id: string;
  table_id: string;
  scheduled_time: string | null;
  queue_position: number;
  live_status: LiveStatus;
  final_result_status: string | null;
  score: number | null;
  time_seconds: number | null;
  notes: string | null;
  signature_image: string | null;
  judge_name: string | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
  category?: Category;
  table?: Table;
}

export interface Academy {
  id: string;
  name: string;
  username: string;
  password: string;
  coach_name: string | null;
  whatsapp_number: string | null;
  created_at: string;
}

export type ChangeAction = 'add' | 'update' | 'delete';
export type ChangeStatus = 'pending' | 'approved' | 'rejected';

export interface PendingChange {
  id: string;
  academy_id: string;
  action: ChangeAction;
  passation_id: string | null;
  payload: Record<string, unknown> | null;
  status: ChangeStatus;
  reviewer_notes: string | null;
  reviewed_by: string | null;
  created_at: string;
  reviewed_at: string | null;
  academy?: Academy;
  passation?: Passation;
}
