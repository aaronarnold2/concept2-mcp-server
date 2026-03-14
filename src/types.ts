// User types
export interface UserProfile {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email?: string;
  gender?: string;
  dob?: string;
  age?: number;
  weight?: number;
  location?: string;
  country?: string;
  profile_image?: string;
  affiliations?: string[];
  max_heart_rate?: number;
  weight_class?: string;
  roles?: string[];
}

// Workout/Result types
export interface HeartRate {
  average?: number;
  min?: number;
  max?: number;
}

export interface StrokeData {
  ts?: number;
  d?: number;
  p?: number;
  spm?: number;
  hr?: number;
}

export interface WorkoutResult {
  id?: number;
  user_id?: number;
  date: string;
  timezone?: string;
  date_utc?: string;
  distance: number;
  type: string;
  time: number;
  time_formatted?: string;
  workout_type?: string;
  source?: string;
  weight_class: string;
  verified?: boolean;
  ranked?: boolean;
  comments?: string;
  privacy?: string;
  stroke_rate?: number;
  stroke_count?: number;
  stroke_length?: number;
  drag_factor?: number;
  avg_pace?: number;
  avg_500m_pace?: number;
  avg_pace_formatted?: string;
  heart_rate?: HeartRate;
  calories?: number;
  calories_total?: number;
  watts?: number;
  split_data?: SplitData[];
  stroke_data?: boolean;
}

export interface SplitData {
  type?: string;
  distance?: number;
  time?: number;
  calories?: number;
  stroke_rate?: number;
  heart_rate_average?: number;
}

// Pagination
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    count: number;
    per_page: number;
    current_page: number;
    total_pages: number;
  };
}

// Challenge types
export interface Challenge {
  id: number;
  name: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  distance?: number;
  time?: number;
  type?: string;
  status?: string;
}

// Response format enum
export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}
