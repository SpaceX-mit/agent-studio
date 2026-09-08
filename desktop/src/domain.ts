export type ThreadStatus = 'idle' | 'running' | 'needs_input' | 'completed' | 'failed';
export type AutomationStatus = 'active' | 'paused' | 'failed';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  turnId?: string;
  tool?: ToolActivity;
}

export interface ToolActivity {
  kind: 'commandExecution' | 'fileChange';
  status: string;
  command?: string;
  cwd?: string;
  output?: string;
  exitCode?: number | null;
  durationMs?: number | null;
  turnId?: string;
  changes?: { path: string; kind?: { type: string } | string; diff?: string }[];
}

export interface Thread {
  id: string;
  remoteId?: string;
  title: string;
  projectId?: string;
  status: ThreadStatus;
  pinned: boolean;
  archived: boolean;
  messages: Message[];
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  path?: string;
  git: { isRepository: boolean; branch?: string; dirty?: boolean };
  environment: 'local' | 'worktree';
}

export interface Automation {
  id: string;
  name: string;
  schedule: string;
  status: AutomationStatus;
  notificationPolicy: 'all' | 'failed_runs_only' | 'none';
  lastRunAt?: string;
  nextRunAt?: string;
}

export interface DesktopState {
  activeThreadId?: string;
  activeProjectId?: string;
  theme: 'light' | 'dark';
  model: string;
  threads: Thread[];
  projects: Project[];
  automations: Automation[];
}
