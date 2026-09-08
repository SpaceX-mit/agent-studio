import type { Message, Thread, ToolActivity } from './domain';

export function upsertTool(thread: Thread, item: any, turnId?: string, completed = false) {
  if (!item?.id || !['commandExecution', 'fileChange'].includes(item.type)) return;
  const id = `tool-${item.id}`;
  let message = thread.messages.find(message => message.id === id);
  if (!message) {
    message = { id, role: 'system', content: '', createdAt: new Date().toISOString() };
    thread.messages.push(message);
  }
  const previous = message.tool;
  // Lifecycle completion supplies authoritative output; deltas are only provisional.
  message.tool = {
    ...previous,
    kind: item.type,
    status: item.status || (completed ? 'completed' : previous?.status || 'inProgress'),
    turnId: turnId ?? previous?.turnId,
    command: item.command ?? previous?.command,
    cwd: item.cwd ?? previous?.cwd,
    output: item.aggregatedOutput ?? previous?.output ?? '',
    exitCode: item.exitCode ?? previous?.exitCode,
    durationMs: item.durationMs ?? previous?.durationMs,
    changes: item.changes ?? previous?.changes
  };
}

export function applyToolEvent(thread: Thread, method: string, params: any) {
  if (method === 'item/started' || method === 'item/completed') {
    upsertTool(thread, params.item, params.turnId, method === 'item/completed');
  } else if (method === 'item/commandExecution/outputDelta' || method === 'item/fileChange/outputDelta') {
    let message = thread.messages.find(message => message.id === `tool-${params.itemId}`);
    if (!message) {
      upsertTool(thread, { id: params.itemId, type: method.includes('commandExecution') ? 'commandExecution' : 'fileChange' }, params.turnId);
      message = thread.messages.at(-1);
    }
    if (message?.tool && typeof params.delta === 'string') message.tool.output = (message.tool.output || '') + params.delta;
  } else if (method === 'item/fileChange/patchUpdated') {
    upsertTool(thread, { id: params.itemId, type: 'fileChange', changes: params.changes }, params.turnId);
  }
}

export function finishTools(thread: Thread, turnId: string, failed = false) {
  for (const message of thread.messages) {
    if (message.tool?.turnId === turnId && message.tool.status === 'inProgress') {
      message.tool.status = failed ? 'failed' : 'interrupted';
    }
  }
}

export function restoreMessages(items: any[], previous: Message[]): Message[] {
  const thread = { messages: [] as Message[] } as Thread;
  for (const entry of items) {
    const item = entry.item || entry;
    if (['commandExecution', 'fileChange'].includes(item.type)) {
      const saved = previous.find(message => message.id === `tool-${item.id}`);
      if (saved) thread.messages.push(structuredClone(saved));
      upsertTool(thread, item, entry.turnId, true);
    } else if (item.type === 'userMessage' || item.type === 'agentMessage') {
      thread.messages.push({ id: item.type === 'agentMessage' ? `live-${item.id}` : item.id,
        turnId: entry.turnId || previous.find(message => message.id === `live-${item.id}`)?.turnId,
        role: item.type === 'agentMessage' ? 'assistant' : 'user',
        content: item.text || item.content?.map((part: any) => part.text || part.input_text || '').join('') || '',
        createdAt: new Date().toISOString() });
    }
  }
  // Keep local-only tool/error records when an older server omits those items.
  for (let i = 0; i < previous.length; i++) {
    const message = previous[i];
    if (!(message.tool || message.id.startsWith('error-')) || thread.messages.some(value => value.id === message.id)) continue;
    const next = previous.slice(i + 1).find(value => thread.messages.some(item => item.id === value.id));
    const index = next ? thread.messages.findIndex(value => value.id === next.id) : thread.messages.length;
    thread.messages.splice(index, 0, message);
  }
  return thread.messages;
}

export function toolLabel(tool: ToolActivity) {
  if (tool.status === 'inProgress') return tool.kind === 'fileChange' ? '正在修改' : '正在运行';
  if (tool.status === 'declined') return '已拒绝';
  if (tool.status === 'interrupted') return '已中断';
  if (tool.status === 'failed' || (tool.exitCode != null && tool.exitCode !== 0)) return '执行失败';
  return tool.kind === 'fileChange' ? '已修改' : '已运行';
}
