import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
import { Bell, CheckCircle2, ChevronDown, Circle, Clock3, FileSearch, LoaderCircle, Pause, Pencil, Play, Plus, RefreshCw, Square, Search, Trash2, X } from 'lucide-react';
import { formatTaskDate, localDateInput, localZone, nextRunLabel, scheduleLabel, taskRequest, taskRunLabels, taskStatusLabels, taskTemplates } from './scheduledTasks';
import type { ScheduledTask, TaskDraft, TaskSchedule } from './scheduledTasks';

function TaskModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  return <dialog className="task-modal" ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}><header><h2>{title}</h2><button type="button" className="task-icon-button" aria-label="关闭对话框" title="关闭" onClick={onClose}><X /></button></header>{children}</dialog>;
}

function TaskEditor({ draft, models, loadingModels, refreshModels, onClose, onSaved }: { draft: TaskDraft; models: string[]; loadingModels: boolean; refreshModels: () => void; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<TaskDraft>(() => structuredClone(draft));
  const [onceAt, setOnceAt] = useState(() => localDateInput(draft.schedule.kind === 'once' ? draft.schedule.at : new Date(Date.now() + 3600000).toISOString()));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [writeConfirmed, setWriteConfirmed] = useState(draft.permission === 'workspace-write');
  useEffect(() => { if (!form.model && models.length) setForm(current => ({ ...current, model: models[0] })); }, [models, form.model]);
  const patch = (fields: Partial<TaskDraft>) => setForm(current => ({ ...current, ...fields }));
  const patchSchedule = (fields: Partial<Exclude<TaskSchedule, { kind: 'once' }>>) => { if (form.schedule.kind !== 'once') patch({ schedule: { ...form.schedule, ...fields } }); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (saving) return;
    setError(''); setSaving(true);
    try {
      if (form.kind === 'agent' && !models.includes(form.model)) throw new Error('请从 API 返回的模型列表中选择可用模型。');
      if (form.kind === 'agent' && form.permission === 'workspace-write' && !writeConfirmed) throw new Error('请确认允许无人值守修改工作区。');
      const schedule = form.schedule.kind === 'once' ? { kind: 'once' as const, at: new Date(onceAt).toISOString() } : form.schedule;
      await taskRequest('saveTask', { ...form, schedule }); onSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : '保存失败。'); }
    finally { setSaving(false); }
  };
  return <TaskModal title={draft.id ? '编辑任务' : '创建任务'} onClose={() => { if (!saving) onClose(); }}><form onSubmit={submit}>
    <fieldset disabled={saving}>
      <label>任务名称<input required maxLength={120} autoFocus value={form.name} onChange={event => patch({ name: event.target.value })} /></label>
      <label>任务内容<textarea required maxLength={20000} rows={4} value={form.prompt} onChange={event => patch({ prompt: event.target.value })} /></label>
      <div className="task-form-grid"><label>类型<select value={form.kind} onChange={event => patch({ kind: event.target.value as TaskDraft['kind'] })}><option value="agent">Agent 任务</option><option value="reminder">提醒</option></select></label>
        <label>频率<select value={form.schedule.kind} onChange={event => {
          const kind = event.target.value as TaskSchedule['kind'];
          patch({ schedule: kind === 'once' ? { kind, at: new Date(Date.now() + 3600000).toISOString() } : { time: '09:00', timezone: localZone, ...(form.schedule.kind !== 'once' ? form.schedule : {}), kind, ...(kind === 'weekly' ? { day: form.schedule.kind === 'weekly' ? form.schedule.day : 1 } : {}) } });
        }}><option value="daily">每天</option><option value="weekdays">工作日</option><option value="weekly">每周</option><option value="once">仅一次</option></select></label></div>
      {form.schedule.kind === 'once' ? <label>运行时间（本地时区）<input required type="datetime-local" value={onceAt} onChange={event => setOnceAt(event.target.value)} /></label> : <>
        <div className="task-form-grid"><label>运行时间<input required type="time" value={form.schedule.time} onChange={event => patchSchedule({ time: event.target.value })} /></label><label>时区<select value={form.schedule.timezone} onChange={event => patchSchedule({ timezone: event.target.value })}>{Array.from(new Set([localZone, form.schedule.timezone, 'Asia/Shanghai', 'Asia/Tokyo', 'UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London'])).map(zone => <option key={zone}>{zone}</option>)}</select></label></div>
        {form.schedule.kind === 'weekly' && <label>星期<select aria-label="星期" value={form.schedule.day ?? 1} onChange={event => patchSchedule({ day: Number(event.target.value) })}>{Array.from('日一二三四五六').map((day, index) => <option key={index} value={index}>星期{day}</option>)}</select></label>}
      </>}
      {form.kind === 'agent' && <><div className="task-model-field"><label>模型<select required value={form.model} onChange={event => patch({ model: event.target.value })}><option value="">{loadingModels ? '正在读取模型…' : '选择模型'}</option>{form.model && !models.includes(form.model) && <option value={form.model} disabled>{form.model}（不可用）</option>}{models.map(model => <option key={model}>{model}</option>)}</select></label><button type="button" className="task-icon-button" title="刷新模型" aria-label="刷新模型" onClick={refreshModels} disabled={loadingModels}><RefreshCw /></button></div>
        <label>执行权限<select value={form.permission} onChange={event => { patch({ permission: event.target.value as TaskDraft['permission'] }); setWriteConfirmed(false); }}><option value="read-only">只读</option><option value="workspace-write">允许修改工作区</option></select></label>
        {form.permission === 'workspace-write' && <label className="task-check"><input type="checkbox" checked={writeConfirmed} onChange={event => setWriteConfirmed(event.target.checked)} />允许此任务无人值守修改当前工作区</label>}
      </>}
      <label className="task-check"><input type="checkbox" checked={form.notify} onChange={event => patch({ notify: event.target.checked })} />完成或失败时通知</label>
    </fieldset>
    {error && <div className="task-error" role="alert">{error}</div>}
    <footer><button type="button" disabled={saving} onClick={onClose}>取消</button><button className="task-primary" disabled={saving || form.kind === 'agent' && (loadingModels || !models.includes(form.model))}>{saving ? '保存中…' : '保存任务'}</button></footer>
  </form></TaskModal>;
}

export function ScheduledPage({ models, loadingModels, refreshModels }: { models: string[]; loadingModels: boolean; refreshModels: () => void }) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState('all');
  const [draft, setDraft] = useState<TaskDraft>(); const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<ScheduledTask>(); const [deleting, setDeleting] = useState<ScheduledTask>();
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(''); const [detailError, setDetailError] = useState('');
  const [createMenu, setCreateMenu] = useState(false); const createRoot = useRef<HTMLDivElement>(null);
  const alive = useRef(true); const refreshId = useRef(0);
  const reload = useCallback(async () => {
    const requestId = ++refreshId.current;
    try { const result = await taskRequest<{ tasks: ScheduledTask[] }>('listTasks'); if (alive.current && requestId === refreshId.current) { setTasks(result.tasks); setLoadError(''); } }
    catch (caught) { if (alive.current && requestId === refreshId.current) setLoadError(caught instanceof Error ? caught.message : '任务加载失败。'); }
    finally { if (alive.current && requestId === refreshId.current) setLoading(false); }
  }, []);
  useEffect(() => {
    alive.current = true; void reload(); const timer = window.setInterval(() => void reload(), 5000);
    const unsubscribe = window.desktop?.onTasksChanged?.(message => { if (message?.error) setError(message.error); void reload(); });
    return () => { alive.current = false; ++refreshId.current; clearInterval(timer); unsubscribe?.(); };
  }, [reload]);
  useEffect(() => {
    let active = true;
    if (!selectedId) { setDetail(undefined); return; }
    if (!tasks.some(task => task.id === selectedId)) { setSelectedId(undefined); return; }
    taskRequest<{ task: ScheduledTask }>('taskDetail', selectedId).then(result => { if (active) { setDetail(result.task); setDetailError(''); } }).catch(caught => { if (active) setDetailError(caught.message); });
    return () => { active = false; };
  }, [tasks, selectedId]);
  useEffect(() => {
    if (!createMenu) return;
    createRoot.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => { if (!createRoot.current?.contains(event.target as Node)) setCreateMenu(false); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [createMenu]);
  const create = (kind: TaskDraft['kind'], template?: typeof taskTemplates[number]) => {
    setCreateMenu(false); setDraft({ name: '', prompt: '', kind, model: models[0] || '', permission: 'read-only', notify: true, schedule: { kind: 'daily', time: '09:00', timezone: localZone }, ...template });
  };
  const mutate = async (operation: 'runTask' | 'cancelTask' | 'deleteTask' | 'setTaskStatus', ...args: unknown[]) => {
    if (busy) return; setBusy(true); setError('');
    try { await taskRequest(operation, ...args); if (operation === 'deleteTask') { setSelectedId(undefined); setDeleting(undefined); } await reload(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '操作失败。'); }
    finally { setBusy(false); }
  };
  const visible = tasks.filter(task => `${task.name} ${task.prompt}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || task.status === filter));
  const anyRunning = tasks.some(task => task.runs[0]?.status === 'running');
  return <div className="scheduled-page">
    <div className="scheduled-topbar"><div className="task-create-menu" ref={createRoot} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setCreateMenu(false); }} onKeyDown={event => {
      if (event.key === 'Escape') { setCreateMenu(false); createRoot.current?.querySelector<HTMLButtonElement>('.create-task')?.focus(); }
      if (createMenu && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); const items = Array.from(createRoot.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || []); const index = items.indexOf(document.activeElement as HTMLButtonElement); items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
    }}><button className="create-task" aria-expanded={createMenu} aria-haspopup="menu" onClick={() => setCreateMenu(value => !value)}>创建<ChevronDown aria-hidden="true" /></button>{createMenu && <div className="task-create-options" role="menu" aria-label="创建类型"><button role="menuitem" onClick={() => create('agent')}><Clock3 />Agent 任务</button><button role="menuitem" onClick={() => create('reminder')}><Bell />提醒</button></div>}</div></div>
    <div className="scheduled-content"><header className="scheduled-header"><h1>已安排的任务</h1></header>
      <label className="scheduled-search"><Search aria-hidden="true" /><input aria-label="搜索已安排任务" placeholder="搜索已安排任务" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="task-tabs" role="tablist" aria-label="任务状态" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')); const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
        const target = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; target?.focus(); target?.click();
      }}>{[['all', '全部'], ['active', '已开启'], ['paused', '已暂停'], ['completed', '已完成']].map(([id, label]) => <button role="tab" id={`task-tab-${id}`} aria-controls="task-list" tabIndex={filter === id ? 0 : -1} aria-selected={filter === id} key={id} onClick={() => setFilter(id)}>{label}</button>)}</div>
      {loadError && <div className="task-error" role="alert"><span>{loadError}</span><button onClick={() => void reload()}>重试</button></div>}
      {error && !selectedId && <div className="task-error" role="alert"><span>{error}</span><button aria-label="关闭错误" onClick={() => setError('')}><X size={16} /></button></div>}
      {loading ? <div className="task-empty" role="status">正在读取任务…</div> : <div id="task-list" className="task-list" role="tabpanel" aria-labelledby={`task-tab-${filter}`}>{visible.map(task => {
        const running = task.runs[0]?.status === 'running';
        return <div className="task-row" key={task.id}><button className="task-open" onClick={() => { setDetail(undefined); setDetailError(''); setError(''); setSelectedId(task.id); }} aria-label={`查看任务 ${task.name}`}>
          {running ? <LoaderCircle className="task-spin" /> : task.status === 'completed' ? <CheckCircle2 /> : <Circle />}<span className="task-main"><strong>{task.name}</strong><small>{scheduleLabel(task.schedule)} · {running ? '运行中' : task.status === 'active' ? nextRunLabel(task.nextRunAt) : taskStatusLabels[task.status]}</small>{task.runs[0]?.status === 'failed' && <small className="task-failed">上次运行失败</small>}</span></button>
          <div className="task-actions"><button className="task-icon-button" title={running ? '停止运行' : '立即运行'} aria-label={running ? `停止 ${task.name}` : `运行 ${task.name}`} disabled={busy || !running && anyRunning} onClick={() => void mutate(running ? 'cancelTask' : 'runTask', task.id)}>{running ? <Square /> : <Play />}</button>{task.status !== 'completed' && <button className="task-icon-button" title={task.status === 'active' ? '暂停任务' : '恢复任务'} aria-label={task.status === 'active' ? `暂停 ${task.name}` : `恢复 ${task.name}`} disabled={busy} onClick={() => void mutate('setTaskStatus', task.id, task.status === 'active' ? 'paused' : 'active')}>{task.status === 'active' ? <Pause /> : <Play />}</button>}</div></div>;
      })}{visible.length === 0 && !loadError && <div className="task-empty">{tasks.length ? '没有匹配的任务' : '暂无已安排的任务'}</div>}</div>}
      {!query && filter === 'all' && <section className="task-suggestions" aria-labelledby="task-suggestions-title"><h2 id="task-suggestions-title">建议</h2>{taskTemplates.map(template => <button className={`task-suggestion ${template.icon}`} key={template.name} onClick={() => create('agent', template)}>{template.icon === 'briefing' ? <Bell /> : template.icon === 'monitor' ? <FileSearch /> : <Plus />}<span><strong>{template.name}</strong><em>{scheduleLabel(template.schedule).split(' · ')[0]}</em><small>{template.summary}</small></span></button>)}</section>}
    </div>
    {selectedId && <TaskModal title={detail?.name || '任务详情'} onClose={() => { setSelectedId(undefined); setDetail(undefined); }}>{detailError && <div className="task-error" role="alert"><span>{detailError}</span><button onClick={() => void reload()}>重试</button></div>}{!detail ? !detailError && <p role="status">正在读取记录…</p> : <>
      <dl className="task-metadata"><dt>状态</dt><dd>{taskStatusLabels[detail.status]}</dd><dt>安排</dt><dd>{scheduleLabel(detail.schedule)}</dd><dt>下次运行</dt><dd>{formatTaskDate(detail.nextRunAt)}</dd><dt>权限</dt><dd>{detail.kind === 'reminder' ? '提醒' : detail.permission === 'read-only' ? '只读' : '允许修改工作区'}</dd>{detail.kind === 'agent' && <><dt>模型</dt><dd>{detail.model}</dd></>}</dl><p className="task-prompt">{detail.prompt}</p>
      <h3>运行记录</h3><div className="task-runs">{detail.runs.length ? detail.runs.map(run => <details key={run.id} className="task-run"><summary><span>{formatTaskDate(run.startedAt)}</span><span className={run.status === 'failed' ? 'task-failed' : ''}>{taskRunLabels[run.status]}</span></summary><small>{run.trigger === 'scheduled' ? '定时执行' : '手动执行'}{run.finishedAt ? ` · 结束于 ${formatTaskDate(run.finishedAt)}` : ''}</small>{run.error && <p className="task-failed">{run.error}</p>}<pre>{run.output || (run.status === 'running' ? '正在执行，结束后保存结果。' : '无输出')}</pre></details>) : <p className="task-muted">尚无运行记录</p>}</div>
      {error && <p className="task-error" role="alert">{error}</p>}<footer><button className="task-danger" disabled={busy || detail.runs[0]?.status === 'running'} onClick={() => setDeleting(detail)}><Trash2 />删除</button><button disabled={busy || detail.runs[0]?.status === 'running'} onClick={() => setDraft(detail)}><Pencil />编辑</button><button disabled={busy || anyRunning && detail.runs[0]?.status !== 'running'} onClick={() => void mutate(detail.runs[0]?.status === 'running' ? 'cancelTask' : 'runTask', detail.id)}>{detail.runs[0]?.status === 'running' ? <Square /> : <Play />}{detail.runs[0]?.status === 'running' ? '停止运行' : '立即运行'}</button></footer>
    </>}</TaskModal>}
    {draft && <TaskEditor draft={draft} models={models} loadingModels={loadingModels} refreshModels={refreshModels} onClose={() => setDraft(undefined)} onSaved={() => { setDraft(undefined); void reload(); }} />}
    {deleting && <TaskModal title="删除任务" onClose={() => { if (!busy) setDeleting(undefined); }}><p>删除“{deleting.name}”及其运行记录？</p>{error && <p role="alert" className="task-error">{error}</p>}<footer><button disabled={busy} onClick={() => setDeleting(undefined)}>取消</button><button disabled={busy} className="task-danger" onClick={() => void mutate('deleteTask', deleting.id)}>确认删除</button></footer></TaskModal>}
  </div>;
}
