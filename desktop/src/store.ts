import type { DesktopState, Message, Thread } from './domain';

const KEY = 'codex-desktop-state-v1';

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

export const defaultState = (): DesktopState => ({
  theme: 'light',
  model: '',
  threads: [],
  projects: [],
  automations: []
});

export function loadState(): DesktopState {
  try { return { ...defaultState(), ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; }
  catch { return defaultState(); }
}

export function saveState(state: DesktopState) { localStorage.setItem(KEY, JSON.stringify(state)); }

export function createThread(state: DesktopState, title = '新对话'): Thread {
  const thread: Thread = { id: id('thread'), title, status: 'idle', pinned: false, archived: false, messages: [], updatedAt: now() };
  state.threads = [...state.threads, thread]; state.activeThreadId = thread.id; saveState(state); return thread;
}

export function appendMessage(state: DesktopState, threadId: string, role: Message['role'], content: string) {
  const thread = state.threads.find(item => item.id === threadId); if (!thread) return;
  thread.messages.push({ id: id('message'), role, content, createdAt: now() }); thread.updatedAt = now(); saveState(state);
}
