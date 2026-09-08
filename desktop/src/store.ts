import type { DesktopState, Message, Thread } from './domain';

const KEY = 'codex-desktop-state-v1';

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

export const defaultState = (): DesktopState => ({
  mode: 'code',
  theme: 'light',
  model: '',
  threads: [],
  projects: [],
  automations: []
});

export function loadState(): DesktopState {
  try {
    const state: DesktopState = { ...defaultState(), ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
    state.mode = state.mode === 'work' ? 'work' : 'code';
    state.threads.forEach(ensureThreadTitle);
    return state;
  }
  catch { return defaultState(); }
}

export function saveState(state: DesktopState) { localStorage.setItem(KEY, JSON.stringify(state)); }

export function automaticThreadTitle(thread?: Thread, incoming?: string): string | undefined {
  if (thread?.titleSource || (thread?.title && !['新对话', 'Codex 对话', 'New chat'].includes(thread.title))) return;
  const firstMessage = thread?.messages.find(message => message.role === 'user')?.content || incoming;
  const text = firstMessage?.replace(/\s+/g, ' ').trim();
  if (!text) return;
  const segments = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment);
  return segments.length > 120 ? `${segments.slice(0, 120).join('')}...` : text;
}

export function ensureThreadTitle(thread: Thread) {
  const title = automaticThreadTitle(thread);
  if (title) { thread.title = title; thread.titleSource = 'auto'; }
}

export function createThread(state: DesktopState, title = '新对话'): Thread {
  const thread: Thread = { id: id('thread'), title, status: 'idle', pinned: false, archived: false, messages: [], updatedAt: now() };
  state.threads = [...state.threads, thread]; state.activeThreadId = thread.id; saveState(state); return thread;
}

export function appendMessage(state: DesktopState, threadId: string, role: Message['role'], content: string) {
  const thread = state.threads.find(item => item.id === threadId); if (!thread) return;
  thread.messages.push({ id: id('message'), role, content, createdAt: now() });
  if (role === 'user') ensureThreadTitle(thread);
  thread.updatedAt = now(); saveState(state);
}
