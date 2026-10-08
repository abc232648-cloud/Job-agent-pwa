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

export interface JobActivityEvent {
  id: string;
  occurred_at: string;
  source: 'notification' | 'application' | 'command';
  severity: Severity;
  title: string;
  summary: string;
  status: string;
  related_page: string;
  unread: boolean;
}

export interface JobActivityFeed {
  events: JobActivityEvent[];
  counts: { unread: number; action_required: number; urgent: number };
  job_counts: { jobs: number; applications: number; actions: number };
  limit: number;
  privacy: string;
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
