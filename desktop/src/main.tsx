import { Fragment, StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { appendMessage, automaticThreadTitle, createThread, ensureThreadTitle, loadState, saveState } from './store';
import type { DesktopState } from './domain';
import { failureMessage, recordTurnFailure } from './turnFailure';
import { ModelPicker, useModelCatalog } from './ModelPicker';
import { applyToolEvent, finishTools, restoreMessages } from './toolActivity';
import { ToolActivityGroup, groupMessages } from './ToolActivityView';
import { MessageActions } from './ReplyActions';
import { branchSnapshot, isFinalReply, replyText } from './messageActions';
import { archiveThread, connectCodex, deleteThread, forkThread, interruptTurn, listThreadItems, listThreadTurns, listThreads, resumeThread, setThreadName, startThread, startTurn, subscribeCodex } from './codexClient';
import { ExtensionsPage, ExtensionIcon } from './ExtensionsPage';
import { ThreadButton } from './ThreadButton';
import { ModePicker } from './ModePicker';
import { ArrowLeft, ArrowRight, ArrowUp, Badge, Bug, Clock3, FolderOpen, GitBranch, Hammer, Laptop, PanelLeft, Plus, Puzzle, RefreshCcw, Search, ShieldAlert, Square, SquarePen, Terminal, Telescope, X } from 'lucide-react';
import { useNavigationHistory } from './useNavigationHistory';
import type { Page } from './useNavigationHistory';
import './styles.css';
import './sidebar.css';
import './chat.css';
import { ScheduledPage } from './ScheduledPage';
import './scheduled.css';
import { WindowFrame } from './WindowFrame';
import { WindowControls } from './WindowControls';
import { ComposerPlugins } from './ComposerPlugins';
import { extensionName } from './extensions';
import type { Plugin } from './extensions';
import type { WindowFrameBridge } from './WindowFrame';

function projectLabel(pathOrName?: string) {
  return pathOrName?.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || pathOrName;
}

function App() {
  const [state, setState] = useState<DesktopState>(() => { const loaded = loadState(); loaded.model = modelId(loaded.model); return loaded; });
  const [input, setInput] = useState('');
  const [composerPlugins, setComposerPlugins] = useState<Plugin[]>([]);
  const [page, setPage] = useState<Page>('chat');
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const navigation = useNavigationHistory(
    { page, threadId: page === 'chat' ? state.activeThreadId : undefined },
    location => !location.threadId || state.threads.some(thread => thread.id === location.threadId && !thread.archived),
  );
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showModel, setShowModel] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [codexStatus, setCodexStatus] = useState<'connecting' | 'connected' | 'offline' | 'error'>('connecting');
  const [remoteThreadId, setRemoteThreadId] = useState<string>();
  const [runningTurnId, setRunningTurnId] = useState<string>();
  const [approval, setApproval] = useState<any>();
  const [deleteCandidate, setDeleteCandidate] = useState<string>();
  const [activity, setActivity] = useState<string>();
  const [providerStatus, setProviderStatus] = useState<any>();
  const catalog = useModelCatalog();
  const availableModels = catalog.models;
  useEffect(() => {
    if (!catalog.loading && availableModels.length) setState(current => availableModels.includes(current.model) ? current : { ...current, model: availableModels[0] });
  }, [availableModels, catalog.loading]);
  const activeThreadRef = useRef<string | undefined>(undefined);
  const sendingRef = useRef(false);
  const forkingRef = useRef(false);
  const completedTurns = useRef(new Set<string>());
  activeThreadRef.current = state.activeThreadId;
  const active = state.threads.find(thread => thread.id === state.activeThreadId);
  const threads = useMemo(() => state.threads.filter(thread => !thread.archived && thread.title.toLowerCase().includes(search.toLowerCase())).slice().reverse(), [state.threads, search]);
  useEffect(() => { saveState(state); document.documentElement.dataset.theme = state.theme; }, [state]);
  useEffect(() => {
    window.desktop?.providerStatus?.().then((provider: any) => {
      setProviderStatus(provider);
      if (!provider?.keyConfigured) setNotice(failureMessage('MINIMAX_API_KEY'));
    }).catch(() => undefined);
  }, []);
  useEffect(() => {
    const cleanup = subscribeCodex({
      notification: message => {
        const params = message.params || {};
        if (message.method === 'item/agentMessage/delta' && params.delta) {
          setActivity(undefined);
          update(next => { const thread = next.threads.find(item => params.threadId ? item.remoteId === params.threadId : item.id === activeThreadRef.current); if (!thread) return; const last = thread.messages.find(message => message.id === `live-${params.itemId}`); if (last?.role === 'assistant') last.content += params.delta; else thread.messages.push({ id: `live-${params.itemId}`, role: 'assistant', turnId: params.turnId, content: params.delta, createdAt: new Date().toISOString() }); thread.status = 'running'; });
        }
        if (message.method && ['item/started', 'item/completed', 'item/commandExecution/outputDelta', 'item/fileChange/outputDelta', 'item/fileChange/patchUpdated'].includes(message.method)) {
          update(next => {
            const thread = next.threads.find(item => item.remoteId === params.threadId);
            if (thread) applyToolEvent(thread, message.method!, params);
          });
        }
        if (message.method === 'error') {
          if (params.willRetry) setActivity('服务暂时不可用，正在重试…');
          else update(next => {
            const thread = next.threads.find(item => item.remoteId === params.threadId);
            if (thread) recordTurnFailure(thread, params.turnId, params.error);
          });
        }
        if (message.method === 'turn/completed') {
          completedTurns.current.add(params.turn?.id);
          setRunningTurnId(undefined); setActivity(undefined);
          update(next => {
            const thread = next.threads.find(item => params.threadId ? item.remoteId === params.threadId : item.id === activeThreadRef.current);
            if (!thread) return;
            finishTools(thread, params.turn?.id, params.turn?.status === 'failed');
            if (params.turn?.error || params.turn?.status === 'failed') recordTurnFailure(thread, params.turn?.id, params.turn?.error);
            else thread.status = 'completed';
          });
        }
      },
      serverRequest: message => setApproval(message),
      error: error => { setCodexStatus('error'); setNotice(`Codex 通信错误：${error?.message || '未知错误'}`); },
      stderr: text => {
        for (const line of String(text || '').split('\n').filter(Boolean)) {
          try { const log = JSON.parse(line); if (log.level === 'ERROR') setNotice(failureMessage(log.fields?.message)); }
          catch { if (/MINIMAX_API_KEY/.test(line)) setNotice(failureMessage(line)); }
        }
      },
      closed: () => setCodexStatus('offline')
    });
    (async () => {
      let lastError: any;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try { await connectCodex(); setCodexStatus('connected'); try { const listed = await listThreads(); const remote = listed?.data || listed?.threads || []; update(next => { for (const item of remote) { if (next.threads.some(local => local.remoteId === item.id)) continue; next.threads.push({ id: `remote-${item.id}`, remoteId: item.id, title: item.name || item.preview || 'Codex 对话', status: item.status?.type === 'active' ? 'running' : 'completed', pinned: false, archived: false, messages: [], updatedAt: new Date((item.updatedAt || 0) * 1000).toISOString() }); } }); } catch { /* optional history */ } return; } catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1))); }
      }
      setCodexStatus('offline'); setNotice(`app-server 连接失败：${lastError?.message || '未知错误'}${providerStatus?.keyConfigured === false ? '；请在启动该副本的 PowerShell 进程设置 MINIMAX_API_KEY' : ''}`);
    })();
    return cleanup;
  }, []);
  const toast = (text: string) => { setNotice(text); window.setTimeout(() => setNotice(''), 1500); };
  const update = (fn: (next: DesktopState) => void) => setState(previous => { const next = structuredClone(previous); fn(next); return next; });
  const send = async () => {
    const text = input.trim(); if (!text || runningTurnId || sendingRef.current) return;
    if (catalog.loading || !availableModels.includes(state.model)) { setNotice(catalog.error || '请等待模型列表加载并选择模型。'); setShowModel(true); return; }
    if (codexStatus !== 'connected') { setNotice('app-server 尚未连接，请稍后重试。'); return; }
    sendingRef.current = true;
    try {
      const provider = await window.desktop?.providerStatus?.();
      setProviderStatus(provider);
      if (!provider?.keyConfigured) { setNotice(failureMessage('MINIMAX_API_KEY')); sendingRef.current = false; return; }
    } catch { setNotice('无法读取模型配置，请重新启动项目副本。'); sendingRef.current = false; return; }
    let localId = state.activeThreadId;
    const existing = state.threads.find(item => item.id === localId);
    const automaticTitle = automaticThreadTitle(existing, text);
    if (!existing) { const draft = structuredClone(state); const created = createThread(draft); localId = created.id; update(next => { next.threads.push(created); next.activeThreadId = created.id; }); }
    update(next => { const thread = next.threads.find(item => item.id === localId); if (thread) { appendMessage(next, thread.id, 'user', text); thread.status = 'running'; } });
    setInput(''); setComposerPlugins([]); setPage('chat'); setActivity('正在思考…');
    try {
      const model = modelId(state.model); const modelProvider = 'minimax'; const cwd = await window.desktop?.getProjectRoot?.();
      const local = state.threads.find(item => item.id === localId);
      let threadId = remoteThreadId || local?.remoteId;
      const createRemoteThread = async () => {
        const started = await startThread({ effort: effortForModel(state.model), model, modelProvider, cwd, permission: state.permission });
        const id = started.thread?.id;
        if (!id) throw new Error('没有返回 thread id');
        setRemoteThreadId(id);
        update(next => { const thread = next.threads.find(item => item.id === localId); if (thread) thread.remoteId = id; });
        return id;
      };
      if (!threadId) threadId = await createRemoteThread();
      if (!threadId) throw new Error('没有返回 thread id');
      if (automaticTitle) void setThreadName(threadId, automaticTitle).catch(() => toast('标题已保存在本地，远端同步失败。'));
      let turn;
      const plugins = composerPlugins.map(plugin => ({ id: plugin.id, name: plugin.name }));
      try { turn = await startTurn({ threadId, text, plugins, model, modelProvider, effort: effortForModel(state.model), cwd }); }
      catch (error: any) {
        const message = String(error?.message || error);
        if (!/thread\s+not\s+found|unknown\s+thread|no\s+such\s+thread/i.test(message)) throw error;
        threadId = await createRemoteThread();
        if (!threadId) throw new Error('没有返回 thread id');
        turn = await startTurn({ threadId, text, plugins, model, modelProvider, effort: effortForModel(state.model), cwd });
      }
      if (!completedTurns.current.has(turn.turn?.id)) setRunningTurnId(turn.turn?.id);
    } catch (error: any) {
      setActivity(undefined);
      update(next => { const thread = next.threads.find(item => item.id === localId); if (thread) recordTurnFailure(thread, crypto.randomUUID(), error); });
    } finally { sendingRef.current = false; }
  };
  const cancel = () => { const activeRemoteId = state.threads.find(item => item.id === activeThreadRef.current)?.remoteId || remoteThreadId; if (activeRemoteId && runningTurnId) interruptTurn(activeRemoteId, runningTurnId).catch(() => undefined); };
  const newChat = () => { setRemoteThreadId(undefined); update(next => createThread(next)); setInput(''); setComposerPlugins([]); setAttachments([]); setPage('chat'); };
  const selectThread = async (thread: DesktopState['threads'][number]) => { update(next => { next.activeThreadId = thread.id; }); setRemoteThreadId(thread.remoteId); setPage('chat'); if (thread.remoteId && codexStatus === 'connected') { try { let items: any[] = []; try { let cursor: string | undefined; do { const page = await listThreadItems(thread.remoteId, cursor); items.push(...(page?.data || page?.items || [])); cursor = page?.nextCursor || undefined; } while (cursor); } catch { const loaded = await resumeThread(thread.remoteId); items = loaded?.thread?.turns?.flatMap((turn: any) => turn.items || []) || []; } update(next => { const local = next.threads.find(item => item.id === thread.id); if (!local) return; if (local.status !== 'running') { local.messages = restoreMessages(items, local.messages); ensureThreadTitle(local); } }); } catch (error: any) { toast(`恢复线程失败：${error.message}`); } } };
  const respondApproval = async (decision: string) => {
    if (!approval) return;
    let result: any = { decision };
    if (approval.method === 'item/permissions/requestApproval') {
      result = decision === 'accept' ? { scope: 'turn', permissions: approval.params?.permissions || {} } : { scope: 'turn', permissions: {} };
    } else if (approval.method === 'item/tool/requestUserInput') {
      result = { answers: Object.fromEntries((approval.params?.questions || []).map((question: any) => [question.id, []])) };
    } else if (approval.method === 'mcpServer/elicitation/request') {
      result = { action: decision === 'accept' ? 'accept' : decision === 'cancel' ? 'cancel' : 'decline', content: null };
    }
    await window.codex?.respond(approval.id, result);
    setApproval(undefined);
  };
  const renameActive = async () => { const thread = state.threads.find(item => item.id === state.activeThreadId); if (!thread) return; const name = window.prompt('重命名会话', thread.title)?.trim(); if (!name || name === thread.title) return; if (thread.remoteId && codexStatus === 'connected') { try { await setThreadName(thread.remoteId, name); } catch (error: any) { toast(`重命名失败：${error.message}`); return; } } update(next => { const item = next.threads.find(value => value.id === thread.id); if (item) { item.title = name; item.titleSource = 'manual'; } }); };
  const archiveActive = async () => { const thread = state.threads.find(item => item.id === state.activeThreadId); if (!thread) return; if (thread.remoteId && codexStatus === 'connected') { try { await archiveThread(thread.remoteId); } catch (error: any) { toast(`归档失败：${error.message}`); return; } } update(next => { const item = next.threads.find(value => value.id === thread.id); if (item) { item.archived = true; item.status = 'completed'; } }); setRemoteThreadId(undefined); };
  const performDelete = async (threadId: string) => { const thread = state.threads.find(item => item.id === threadId); if (!thread) return; if (thread.remoteId && codexStatus === 'connected') { try { await deleteThread(thread.remoteId); } catch (error: any) { toast(`删除失败：${error.message}`); return; } } update(next => { next.threads = next.threads.filter(value => value.id !== threadId); if (next.activeThreadId === threadId) next.activeThreadId = undefined; }); setRemoteThreadId(value => value === thread.remoteId ? undefined : value); };
  const deleteActive = async () => { const thread = state.threads.find(item => item.id === state.activeThreadId); if (thread) setDeleteCandidate(thread.id); };
  const togglePinned = (threadId: string) => update(next => { const thread = next.threads.find(item => item.id === threadId); if (thread) thread.pinned = !thread.pinned; });
  const archiveThreadFromSidebar = async (threadId: string) => { const thread = state.threads.find(item => item.id === threadId); if (!thread) return; if (thread.remoteId && codexStatus === 'connected') { try { await archiveThread(thread.remoteId); } catch (error: any) { toast(`归档失败：${error.message}`); return; } } update(next => { const item = next.threads.find(value => value.id === threadId); if (item) { item.archived = true; item.status = 'completed'; if (next.activeThreadId === threadId) next.activeThreadId = undefined; } }); setRemoteThreadId(value => value === thread.remoteId ? undefined : value); };
  const deleteThreadFromSidebar = async (threadId: string) => { if (state.threads.some(item => item.id === threadId)) setDeleteCandidate(threadId); };
  const forkActive = async () => { const thread = state.threads.find(item => item.id === state.activeThreadId); if (!thread?.remoteId || codexStatus !== 'connected') { toast('当前会话还没有远端线程'); return; } try { const result = await forkThread(thread.remoteId); const remote = result?.thread; if (!remote?.id) throw new Error('没有返回分叉线程'); const copy = { ...thread, id: `remote-${remote.id}`, remoteId: remote.id, title: `${thread.title} · 分支`, messages: structuredClone(thread.messages), updatedAt: new Date().toISOString() }; update(next => { next.threads.push(copy); next.activeThreadId = copy.id; }); setRemoteThreadId(remote.id); toast('已创建会话分支'); } catch (error: any) { toast(`分叉失败：${error.message}`); } };
  const forkFromMessage = async (messageId: string) => {
    const source = state.threads.find(thread => thread.id === state.activeThreadId);
    if (forkingRef.current) return;
    if (!source?.remoteId || codexStatus !== 'connected') throw new Error('会话尚未连接。');
    if (source.status === 'running' || runningTurnId) throw new Error('请等待本轮回复完成。');
    const message = source.messages.find(item => item.id === messageId);
    if (!message) throw new Error('找不到这条回复。');
    forkingRef.current = true;
    try {
      let turnId = message.turnId;
      if (!turnId) {
        let cursor: string | undefined;
        do {
          const result = await listThreadTurns(source.remoteId, cursor);
          const turn = (result.data || []).find((entry: any) => (entry.items || []).some((item: any) => `live-${item.id}` === messageId || item.id === messageId));
          if (turn) { turnId = turn.id; break; }
          cursor = result.nextCursor || undefined;
        } while (cursor);
      }
      if (!turnId) throw new Error('无法定位回复所在的回合，请重新加载该会话后重试。');
      const result = await forkThread(source.remoteId, turnId);
      if (!result.thread?.id) throw new Error('服务未返回分支会话。');
      const copy = branchSnapshot(source, messageId, result.thread.id);
      update(next => { next.threads.push(copy); next.activeThreadId = copy.id; });
      setRemoteThreadId(copy.remoteId); setInput(''); setPage('chat');
    } finally { forkingRef.current = false; }
  };
  const addAttachment = async () => {
    const picked = await window.desktop?.pickFiles?.();
    if (!picked?.length) return;
    const next = [...new Set([...attachments, ...picked])];
    setAttachments(next);
  };
  const navigateHistory = (direction: -1 | 1) => {
    const location = navigation.move(direction);
    if (!location) return;
    if (location.page === 'chat') {
      const thread = state.threads.find(item => item.id === location.threadId);
      if (thread) { void selectThread(thread); return; }
      update(next => { next.activeThreadId = undefined; });
      setRemoteThreadId(undefined);
    }
    setPage(location.page);
  };
  return <div className={`desktop-app ${state.theme}`}>
    <header className="desktop-titlebar">
      <div className="titlebar-navigation">
        <button className="titlebar-icon" aria-label={sidebarVisible ? '收起侧栏' : '展开侧栏'} title={sidebarVisible ? '收起侧栏' : '展开侧栏'} aria-expanded={sidebarVisible} aria-controls="workspace-sidebar" onClick={() => setSidebarVisible(value => !value)}><PanelLeft aria-hidden="true" /></button>
        <button className="titlebar-icon" aria-label="后退" title="后退" disabled={!navigation.canGoBack} onClick={() => navigateHistory(-1)}><ArrowLeft aria-hidden="true" /></button>
        <button className="titlebar-icon" aria-label="前进" title="前进" disabled={!navigation.canGoForward} onClick={() => navigateHistory(1)}><ArrowRight aria-hidden="true" /></button>
      </div>
      <nav aria-label="应用菜单"><button>文件</button><button>编辑</button><button>视图</button><button>帮助</button></nav><WindowControls />
    </header>
    <div className="desktop-body"><aside id="workspace-sidebar" className="sidebar" aria-label="侧栏" hidden={!sidebarVisible}>
      <div className="brand-row"><ModePicker mode={state.mode} onChange={mode => update(next => { next.mode = mode; })} /><button className="sidebar-search-toggle" aria-label="搜索" title="搜索会话" aria-expanded={showSearch} aria-controls="sidebar-search" onClick={() => { setShowSearch(value => !value); setSearch(''); }}><Search aria-hidden="true" /></button></div>
      {showSearch && <input id="sidebar-search" autoFocus className="side-search" aria-label="搜索最近会话" placeholder="搜索最近会话" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setShowSearch(false); setSearch(''); } }} />}
      <button className="sidebar-nav" onClick={newChat}><SquarePen aria-hidden="true" /><span>新对话</span></button>
      <button className="sidebar-nav" aria-current={page === 'scheduled' ? 'page' : undefined} onClick={() => setPage('scheduled')}><Clock3 aria-hidden="true" /><span>已安排</span></button>
      <button className="sidebar-nav" aria-current={page === 'plugins' ? 'page' : undefined} onClick={() => setPage('plugins')}><Puzzle aria-hidden="true" /><span>插件</span></button>
      <div className="sidebar-scroll">
        <section aria-labelledby="sidebar-projects"><h2 id="sidebar-projects" className="section">项目</h2>
          {state.activeProjectId ? <div className="sidebar-project" title={projectLabel(state.projects.find(project => project.id === state.activeProjectId)?.name ?? state.activeProjectId)}><FolderOpen aria-hidden="true" /><span>{projectLabel(state.projects.find(project => project.id === state.activeProjectId)?.name ?? state.activeProjectId)}</span></div> : <div className="empty">没有项目</div>}
        </section>
        <section aria-labelledby="sidebar-recent"><h2 id="sidebar-recent" className="section">最近</h2>
          {threads.map(thread => <ThreadButton key={thread.id} thread={thread} selected={page === 'chat' && state.activeThreadId === thread.id} onSelect={() => { void selectThread(thread); }} onTogglePin={() => togglePinned(thread.id)} onArchive={() => { void archiveThreadFromSidebar(thread.id); }} onDelete={() => { void deleteThreadFromSidebar(thread.id); }} />)}
          {threads.length === 0 && <div className="empty">{search ? '没有匹配的会话' : '暂无会话'}</div>}
        </section>
      </div>
    </aside>
      <main>{!!active?.messages.length && page === 'chat' && <div className="thread-toolbar global-thread-toolbar"><span>{active.title}</span><div><button onClick={renameActive}>重命名</button><button onClick={forkActive}>分叉</button><button onClick={archiveActive}>归档</button><button onClick={deleteActive}>删除</button></div></div>}{page === 'chat' ? <Chat mode={state.mode} permission={state.permission} onOpenPlugins={() => setPage('plugins')} composerPlugins={composerPlugins} setComposerPlugins={setComposerPlugins} active={active} input={input} setInput={setInput} send={send} cancel={cancel} running={Boolean(runningTurnId)} activity={activity} model={state.model} catalog={catalog} update={update} attachments={attachments} addAttachment={addAttachment} showModel={showModel} setShowModel={setShowModel} showProjects={showProjects} setShowProjects={setShowProjects} toast={toast} projectId={state.activeProjectId} projects={state.projects} status={codexStatus} onForkMessage={forkFromMessage} /> : page === 'scheduled' ? <ScheduledPage models={availableModels} loadingModels={catalog.loading} refreshModels={catalog.refresh} /> : page === 'plugins' ? <ExtensionsPage connected={codexStatus === 'connected'} /> : <Workspace page={page} state={state} models={availableModels} update={update} toast={toast} providerStatus={providerStatus} />}</main>
    </div>{notice && <div className="toast">{notice}</div>}{approval && <ApprovalDialog request={approval} onDecision={respondApproval} />}{deleteCandidate && <DeleteDialog thread={state.threads.find(item => item.id === deleteCandidate)} onCancel={() => setDeleteCandidate(undefined)} onConfirm={() => { const id = deleteCandidate; setDeleteCandidate(undefined); void performDelete(id); }} />}
  </div>;
}

function effortForModel(model: string) { return model.includes('低') ? 'low' : model.includes('中') ? 'medium' : 'high'; }
function modelId(model: string) { return model.split(' · ')[0]; }

function cleanAssistantText(value: string) { return replyText(value); }

function inlineMarkdown(value: string) {
  const parts = value.split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__)/g);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function MarkdownMessage({ content }: { content: string }) {
  const text = cleanAssistantText(content);
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let code: string[] | null = null;
  let language = '';
  const flushParagraph = () => { if (paragraph.length) { blocks.push(<p key={`p-${blocks.length}`}>{inlineMarkdown(paragraph.join(' '))}</p>); paragraph = []; } };
  const flushCode = () => { if (code) { const source = code.join('\n'); blocks.push(<div className="code-block" key={`code-${blocks.length}`}><div className="code-header"><span>{language || '代码'}</span><button title="复制代码" onClick={() => navigator.clipboard?.writeText(source)}>复制</button></div><pre><code>{source}</code></pre></div>); code = null; language = ''; } };
  lines.forEach((line, index) => {
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) { if (code) flushCode(); else { flushParagraph(); code = []; language = fence[1].trim(); } return; }
    if (code) { code.push(line); return; }
    if (!line.trim()) { flushParagraph(); return; }
    const heading = line.match(/^\s*(#{1,3})\s+(.+)$/);
    if (heading) { flushParagraph(); blocks.push(<div className={`md-heading md-h${heading[1].length}`} key={`h-${index}`}>{inlineMarkdown(heading[2])}</div>); return; }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) { flushParagraph(); blocks.push(<div className="md-list-item" key={`b-${index}`}><span>•</span><div>{inlineMarkdown(bullet[1])}</div></div>); return; }
    const numbered = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (numbered) { flushParagraph(); blocks.push(<div className="md-list-item" key={`n-${index}`}><span>{numbered[1]}.</span><div>{inlineMarkdown(numbered[2])}</div></div>); return; }
    paragraph.push(line.trim());
  });
  flushCode(); flushParagraph();
  return <div className="markdown-content">{blocks.length ? blocks : <p>{text}</p>}</div>;
}

function DeleteDialog({ thread, onCancel, onConfirm }: { thread?: DesktopState['threads'][number]; onCancel: () => void; onConfirm: () => void }) {
  if (!thread) return null;
  return <div className="confirm-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description">
      <div className="confirm-icon" aria-hidden="true">!</div>
      <div className="confirm-copy"><h2 id="delete-dialog-title">删除会话？</h2><p id="delete-dialog-description">“{thread.title}”将被永久删除，此操作无法撤销。</p></div>
      <div className="confirm-actions"><button onClick={onCancel}>取消</button><button className="danger" onClick={onConfirm}>删除</button></div>
    </section>
  </div>;
}

function ApprovalDialog({ request, onDecision }: { request: any; onDecision: (decision: string) => void }) {
  const params = request.params || {};
  const isFile = request.method === 'item/fileChange/requestApproval';
  const isInput = request.method === 'item/tool/requestUserInput';
  const isPermission = request.method === 'item/permissions/requestApproval';
  const isMcp = request.method === 'mcpServer/elicitation/request';
  const title = isFile ? '确认文件变更' : isInput ? '需要补充信息' : isPermission ? '请求额外权限' : isMcp ? 'MCP 请求输入' : '需要你的确认';
  const reason = params.reason || params.message || (isFile ? 'Codex 请求应用文件修改。' : isInput ? '当前工具请求用户输入。' : isPermission ? 'Codex 请求额外的工作区权限。' : isMcp ? `服务器 ${params.serverName || ''} 请求输入。` : 'Codex 请求执行一项命令。');
  return <div className="approval-backdrop"><section className="approval-dialog"><h2>{title}</h2><p>{reason}</p>{params.command && <pre>{params.command}</pre>}{params.cwd && <small>{params.cwd}</small>}<div className="approval-actions"><button onClick={() => onDecision(isInput ? 'cancel' : 'decline')}>{isInput ? '取消' : '拒绝'}</button><button className="primary" onClick={() => onDecision('accept')}>{isInput ? '提交' : '允许'}</button></div></section></div>;
}

function Chat({ mode, permission, onOpenPlugins, composerPlugins, setComposerPlugins, onForkMessage, catalog, active, input, setInput, send, cancel, running, activity, model, update, attachments, addAttachment, showModel, setShowModel, showProjects, setShowProjects, toast, projectId, projects, status }: { mode: DesktopState['mode']; permission: DesktopState['permission']; onOpenPlugins: () => void; composerPlugins: Plugin[]; setComposerPlugins: (plugins: Plugin[]) => void; onForkMessage: (messageId: string) => Promise<void>; catalog: ReturnType<typeof useModelCatalog>; active: DesktopState['threads'][number] | undefined; input: string; setInput: (value: string) => void; send: () => void; cancel: () => void; running: boolean; activity?: string; model: string; update: (fn: (next: DesktopState) => void) => void; attachments: string[]; addAttachment: () => void; showModel: boolean; setShowModel: (value: boolean) => void; showProjects: boolean; setShowProjects: (value: boolean) => void; toast: (text: string) => void; projectId?: string; projects: DesktopState['projects']; status: string }) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const threadView = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const composing = useRef(false);
  const canSend = Boolean(input.trim()) && !running && status === 'connected' && !catalog.loading && catalog.models.includes(model);
  const [workingDirectory, setWorkingDirectory] = useState<string>();
  const [permissionOpen, setPermissionOpen] = useState(false);
  const permissionOptions = [
    ['on-request', '按需审批', '编辑外部文件和使用互联网时始终询问'],
    ['workspace-write', '帮我审批', '仅对检测到的风险操作请求批准'],
    ['danger-full-access', '完全访问权限', '可不受限制地访问互联网和工作区文件']
  ] as const;
  useEffect(() => {
    let disposed = false;
    window.desktop?.getProjectRoot?.().then(root => {
      if (!disposed) setWorkingDirectory(root);
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, []);
  const project = projects.find(item => item.id === projectId);
  const projectPath = workingDirectory || project?.path;
  const projectName = projectLabel(projectPath || project?.name || projectId);
  const workMode = mode === 'work';
  const empty = !active?.messages.length;
  const messageRevision = active?.messages.map(message => `${message.id}:${message.content.length}:${message.role}`).join('|') || '';
  useEffect(() => {
    const element = threadView.current;
    if (!element) return;
    followLatest.current = true;
    element.scrollTop = element.scrollHeight;
    const updateFollowState = () => {
      followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
    };
    element.addEventListener('scroll', updateFollowState, { passive: true });
    updateFollowState();
    return () => element.removeEventListener('scroll', updateFollowState);
  }, [active?.id]);
  useEffect(() => {
    const element = threadView.current;
    if (!element || !messageRevision && !activity) return;
    if (followLatest.current) element.scrollTo({ top: element.scrollHeight, behavior: 'auto' });
  }, [messageRevision, activity]);
  const suggestions = [
    { text: '探索并理解代码', icon: Telescope, color: 'explore' },
    { text: '构建新功能、应用或工具', icon: Hammer, color: 'build' },
    { text: '审查代码并提出修改建议', icon: RefreshCcw, color: 'review' },
    { text: '修复问题和失败', icon: Bug, color: 'fix' },
  ];
  return <div className={`chat-layout${workMode ? ' work-mode' : ''}${workMode && empty ? ' work-new-chat' : ''}`}>{active?.messages.length ? <div className="thread-view" ref={threadView}>{groupMessages(active.messages).map(group => {
    const message = group[0];
    return message.tool ? <ToolActivityGroup key={message.id} messages={group} /> : <div className={`message ${message.role}`} key={message.id}>{message.role === 'assistant' ? <><MarkdownMessage content={message.content} />{isFinalReply(active.messages, active.messages.indexOf(message)) && <MessageActions content={message.content} disabled={running || active.status === 'running' || status !== 'connected' || !active.remoteId} onFork={() => onForkMessage(message.id)} onError={toast} />}</> : <div className="user-text">{message.content}</div>}</div>;
  })}{activity && <div className={`activity${activity === '正在思考…' ? ' thinking' : ''}`}>{activity}</div>}</div> : !workMode && <div className="welcome">
    <div className="welcome-content">
      <div className="welcome-mark" role="img" aria-label="Felix" title="Felix" tabIndex={0}><Badge className="welcome-badge" aria-hidden="true" /><Terminal className="welcome-terminal" aria-hidden="true" /></div>
      <h1>{projectName ? <>你想让我们在 <span title={projectPath}>{projectName}</span> 中构建什么？</> : '你想让我们构建什么？'}</h1>
      <div className="cards">{suggestions.map(({ text, icon: Icon, color }) => <button key={text} onClick={() => { setInput(text); textarea.current?.focus(); }}><Icon className={`suggestion-icon ${color}`} aria-hidden="true" /><span>{text}</span></button>)}</div>
    </div>
  </div>}
  <div className="composer-dock">
    {workMode && empty && <h1 className="work-welcome-heading">我们要做什么？</h1>}
    <div className="project-strip">
      <button className="project" aria-expanded={showProjects} title={projectPath || projectName || '选择项目'} onClick={() => setShowProjects(!showProjects)}><FolderOpen aria-hidden="true" /><span>{projectName || '选择项目'}</span></button>
      {workMode ? <><ComposerPlugins connected={status === 'connected'} onBrowse={onOpenPlugins} onSelect={plugin => {
        if (!composerPlugins.some(item => item.id === plugin.id)) setComposerPlugins([...composerPlugins, plugin]);
        textarea.current?.focus();
      }} /><span className="work-environment" title={project?.environment === 'worktree' ? '工作树' : '本地'} aria-label={project?.environment === 'worktree' ? '工作树' : '本地'}><Laptop aria-hidden="true" /></span></> : <><span className="project-context"><Laptop aria-hidden="true" />{project?.environment === 'worktree' ? '工作树' : '本地'}</span>
      {project?.git?.branch && <span className="project-context project-branch" title={project.git.branch}><GitBranch aria-hidden="true" /><span>{project.git.branch}</span></span>}</>}
      {showProjects && <div className="floating-menu project-menu">{(projects.length ? projects : [{ id: workingDirectory || 'my-agent-plantform', name: projectName || 'my-agent-plantform' }]).map(item => <button key={item.id} onClick={() => { update(next => { next.activeProjectId = item.id; }); setShowProjects(false); }}>{projectLabel(item.name)}</button>)}</div>}
    </div>
    <div className="composer">
      {composerPlugins.length > 0 && <div className="composer-plugin-chips" aria-label="本次使用的插件">{composerPlugins.map(plugin => <span key={plugin.id}><ExtensionIcon item={plugin} /><span>{extensionName(plugin)}</span><button aria-label={`移除 ${extensionName(plugin)}`} onClick={() => setComposerPlugins(composerPlugins.filter(item => item.id !== plugin.id))}><X /></button></span>)}</div>}
      {attachments.length > 0 && <div className="attachment-list">{attachments.map(name => <span key={name} title={name}>{name.replace(/^.*[\\/]/, '')}</span>)}</div>}
      <textarea ref={textarea} aria-label="消息" value={input} onChange={event => setInput(event.target.value)}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.shiftKey || event.altKey || composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          event.preventDefault();
          if (!event.repeat && canSend) send();
        }} placeholder={status === 'connected' ? '随心输入' : '等待 Codex app-server…'} />
      <div className="composer-footer">
        <div className="composer-left"><button className="icon-button" onClick={addAttachment} title="添加附件" aria-label="添加附件"><Plus aria-hidden="true" /></button><div className="permission-picker"><button className="permission-status" aria-expanded={permissionOpen} onClick={() => setPermissionOpen(value => !value)}><ShieldAlert aria-hidden="true" />{permissionOptions.find(item => item[0] === permission)?.[1]}<span className="status-dot connected" /></button>{permissionOpen && <div className="permission-menu"><h3>如何批准 Felix 操作？</h3>{permissionOptions.map(([value, label, description]) => <button key={value} className={permission === value ? 'selected' : ''} onClick={() => { update(next => { next.permission = value; }); setPermissionOpen(false); }}><ShieldAlert aria-hidden="true" /><span><b>{label}</b><small>{description}</small></span></button>)}</div>}</div><span className="connection-status" role="status" title={status === 'connected' ? '已连接' : status} aria-label={status === 'connected' ? '已连接' : status}><i className={`status-dot ${status}`} /></span></div>
        <div className="composer-right"><ModelPicker catalog={catalog} selected={model} open={showModel} setOpen={setShowModel} onSelect={id => update(next => { next.model = id; })} /><button className="send" title={running ? '停止生成' : '发送（Enter），Shift+Enter 换行'} aria-label={running ? '停止生成' : '发送'} disabled={!running && !canSend} onClick={running ? cancel : send}>{running ? <Square aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}</button></div>
      </div>
    </div>
  </div></div>;
}

function Workspace({ page, state, models, update, toast, providerStatus }: { page: Page; state: DesktopState; models: string[]; update: (fn: (next: DesktopState) => void) => void; toast: (text: string) => void; providerStatus?: any }) {
  const title = page === 'scheduled' ? '已安排' : page === 'plugins' ? '插件' : '设置';
  const providerCard = page === 'settings' ? <div className="page-card provider-card"><b>LLM Provider</b><small>MiniMax 中国服务 · {providerStatus?.endpoint || 'https://api.minimaxi.com/v1'}</small><span className={providerStatus?.keyConfigured ? 'provider-ok' : 'provider-missing'}>{providerStatus?.keyConfigured ? 'API Key 已注入当前进程' : '未检测到 API Key（仅当前副本进程生效）'}</span></div> : null;
return <section className="page"><h1>{title}</h1><p>{page === 'settings' ? '管理 Codex Desktop 的显示与工作区偏好' : '本地工作区演示页面，已准备好接入对应 connector。'}</p>{page === 'settings' && <><label className="setting-row">主题<select value={state.theme} onChange={event => update(next => { next.theme = event.target.value as DesktopState['theme']; })}><option value="light">浅色</option><option value="dark">深色</option></select></label><label className="setting-row">默认模型<select value={state.model} onChange={event => update(next => { next.model = event.target.value; })}>{models.map(model => <option key={model} value={model}>{model}</option>)}</select></label><label className="setting-row">默认项目<select value={state.activeProjectId ?? ''} onChange={event => update(next => { next.activeProjectId = event.target.value || undefined; })}><option value="">未选择项目</option><option value="my-agent-plantform">my-agent-plantform</option></select></label></>}</section>;
}

  declare global { interface Window { desktop?: WindowFrameBridge & { toggleMaximize: () => Promise<{ maximized?: boolean }>; minimize?: () => Promise<void>; close?: () => Promise<void>; providerStatus?: () => Promise<any>; listModels?: () => Promise<any>; getProjectRoot?: () => Promise<string>; pickFiles?: () => Promise<string[]>; readExtensionFile?: (path: string, kind: 'image' | 'skill') => Promise<any>; listTasks?: () => Promise<any>; saveTask?: (input: any) => Promise<any>; setTaskStatus?: (id: string, status: string) => Promise<any>; runTask?: (id: string) => Promise<any>; cancelTask?: (id: string) => Promise<any>; deleteTask?: (id: string) => Promise<any>; taskDetail?: (id: string) => Promise<any>; onTasksChanged?: (listener: (message?: { error?: string }) => void) => () => void }; codex?: any } }
createRoot(document.getElementById('root')!).render(<StrictMode><WindowFrame><App /></WindowFrame></StrictMode>);
