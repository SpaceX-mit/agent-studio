import type { Message, Thread } from './domain';

export function replyText(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/gi, '')
    .replace(/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/gi, '').trim();
}

export function isFinalReply(messages: Message[], index: number): boolean {
  if (messages[index]?.role !== 'assistant' || messages[index].tool) return false;
  for (let i = index + 1; i < messages.length; i++) {
    if (messages[i].role === 'user') break;
    if (messages[i].role === 'assistant' || messages[i].tool) return false;
  }
  return true;
}

export function branchSnapshot(source: Thread, messageId: string, remoteId: string): Thread {
  const index = source.messages.findIndex(message => message.id === messageId);
  if (index < 0 || !isFinalReply(source.messages, index)) throw new Error('只能从回合的最后一条回复创建分支。');
  return { ...source, id: `remote-${remoteId}`, remoteId, title: `${source.title} · 分支`,
    pinned: false, archived: false, status: 'idle', messages: structuredClone(source.messages.slice(0, index + 1)), updatedAt: new Date().toISOString() };
}
