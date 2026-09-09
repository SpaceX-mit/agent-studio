export type TaskSchedule = { kind: 'once'; at: string } | { kind: 'daily' | 'weekdays' | 'weekly'; time: string; timezone: string; day?: number };
export type TaskDraft = { id?: string; name: string; prompt: string; kind: 'agent' | 'reminder'; model: string; permission: 'read-only' | 'workspace-write'; notify: boolean; schedule: TaskSchedule };
export type TaskRun = { id: string; status: 'running' | 'completed' | 'failed' | 'interrupted'; trigger: 'manual' | 'scheduled'; startedAt: string; finishedAt?: string; error?: string; output?: string };
export type ScheduledTask = TaskDraft & { id: string; status: 'active' | 'paused' | 'completed'; nextRunAt: string | null; runs: TaskRun[] };
export const taskRunLabels = { running: '运行中', completed: '已完成', failed: '失败', interrupted: '已中断' };
export const taskStatusLabels = { active: '已开启', paused: '已暂停', completed: '已完成' };
export const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
export const formatTaskDate = (value?: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '未安排';
export function scheduleLabel(schedule: TaskSchedule) {
  if (schedule.kind === 'once') return `仅一次 · ${formatTaskDate(schedule.at)}`;
  const frequency = schedule.kind === 'daily' ? '每天' : schedule.kind === 'weekdays' ? '工作日' : `星期${'日一二三四五六'[schedule.day ?? 1]}`;
  return `${frequency} ${schedule.time} · ${schedule.timezone}`;
}
export function nextRunLabel(at: string | null) {
  if (!at) return '未安排';
  const minutes = Math.ceil((Date.parse(at) - Date.now()) / 60000);
  if (minutes <= 0) return '等待运行';
  if (minutes < 60) return `下次运行 ${minutes} 分钟后`;
  if (minutes < 1440) return `下次运行 ${Math.ceil(minutes / 60)} 小时后`;
  return `下次运行 ${formatTaskDate(at)}`;
}
export function localDateInput(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
export const taskTemplates = [
  { name: '每日简报', kind: 'agent', prompt: '读取当前工作目录中的日程、待办和近期文档，整理今天的优先事项。只使用实际可访问的数据；缺少日历或邮件来源时明确说明，不编造内容。', schedule: { kind: 'weekdays', time: '08:00', timezone: localZone }, icon: 'briefing', summary: '整理当前工作目录中的日程、待办与优先事项' },
  { name: '每周回顾', kind: 'agent', prompt: '总结当前工作目录本周的文档与代码变更，整理已完成工作、待处理事项和下周计划。只读检查，不修改文件。', schedule: { kind: 'weekly', day: 5, time: '16:00', timezone: localZone }, icon: 'review', summary: '每周五将最近的工作整理成简明的状态更新' },
  { name: '跟进监控', kind: 'agent', prompt: '检查当前工作目录中的待办、问题记录和近期变更，找出需要跟进的事项，并说明具体证据。不修改文件。', schedule: { kind: 'weekdays', time: '09:00', timezone: localZone }, icon: 'monitor', summary: '检查待办和近期变更，标记需要关注的事项' },
] satisfies (Pick<TaskDraft, 'name' | 'kind' | 'prompt' | 'schedule'> & { icon: string; summary: string })[];
export async function taskRequest<T>(operation: 'listTasks' | 'saveTask' | 'setTaskStatus' | 'runTask' | 'cancelTask' | 'deleteTask' | 'taskDetail', ...args: unknown[]): Promise<T> {
  const method = window.desktop?.[operation];
  if (!method) throw new Error('任务服务不可用，请在项目桌面副本中打开。');
  const response = await (method as (...args: unknown[]) => Promise<any>)(...args);
  if (!response?.ok) throw new Error(response?.error || '任务操作失败。');
  return response as T;
}
