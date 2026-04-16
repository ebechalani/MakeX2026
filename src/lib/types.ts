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
