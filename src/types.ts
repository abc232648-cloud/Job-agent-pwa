export type Severity = 'INFO' | 'ACTION_REQUIRED' | 'URGENT';

export interface ChiefPrincipal {
  id: string;
  session_id: string;
  role: string;
  domains: string[];
  reauth_at: string;
}

export interface ChiefSession {
  principal: ChiefPrincipal;
  csrf: string;
  instance_mode: string;
}

export interface JobNotification {
  id: number;
  title: string;
  body: string;
  severity: Severity;
  read: number;
  created_at: string;
  domain?: string;
  related_page?: string;
  presented?: number;
}

export interface JobCommand {
  id: number;
  instruction: string;
  status: string;
  result: string;
  created_at: string;
  processed_at?: string | null;
}

export interface JobState {
  counts: { jobs: number; applications: number; actions: number; notifications: number };
  commands: JobCommand[];
  worker: { status: string; message: string; updated_at: string | null };
}

export interface JobPushStatus {
  configured: boolean;
  public_key: string;
  subscribed: boolean;
  subscription_count: number;
}

export interface NotificationPreferences {
  delivery: 'all' | 'critical' | 'quiet';
  sort: 'newest' | 'oldest';
  job_push?: JobPushStatus;
}

export interface TimelineItem {
  key: string;
  at: string;
  title: string;
  detail: string;
  severity: Severity | 'COMMAND';
  unread: boolean;
}
