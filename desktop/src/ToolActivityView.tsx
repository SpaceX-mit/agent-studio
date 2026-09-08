import { ChevronRight, FilePenLine, TerminalSquare } from 'lucide-react';
import type { Message, ToolActivity } from './domain';
import { toolLabel } from './toolActivity';

function FileChange({ change, applied }: { change: NonNullable<ToolActivity['changes']>[number]; applied: boolean }) {
  const kind = typeof change.kind === 'string' ? change.kind : change.kind?.type;
  const label = !applied ? '文件变更' : kind === 'add' ? '已创建' : kind === 'delete' ? '已删除' : '已编辑';
  const lines = change.diff?.split('\n') || [];
  const added = lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length;
  const removed = lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length;
  return <details className="tool-file"><summary><FilePenLine size={14} /><span>{label} {change.path}</span>{change.diff && <span className="diff-count"><em>+{added}</em> <b>-{removed}</b></span>}<ChevronRight className="disclosure" size={13} /></summary>
    <pre>{change.diff || '未提供差异内容'}</pre>
  </details>;
}

function ToolRow({ tool }: { tool: ToolActivity }) {
  const failed = tool.status === 'failed' || (tool.exitCode != null && tool.exitCode !== 0);
  const label = toolLabel(tool);
  const title = tool.kind === 'commandExecution' ? tool.command || '命令' : tool.changes?.map(change => change.path).join('，') || '文件';
  return <details className={`tool-row ${failed ? 'tool-failed' : ''}`}>
    <summary title={`${label} ${title}`}>
      {tool.kind === 'commandExecution' ? <TerminalSquare size={14} /> : <FilePenLine size={14} />}
      <span className="tool-summary">{label} {title}</span>
      {tool.status === 'inProgress' && <span className="tool-running" aria-label="执行中" />}
      <ChevronRight className="disclosure" size={13} />
    </summary>
    <div className="tool-detail">
      {tool.kind === 'commandExecution' && <pre className="tool-command">{tool.command}</pre>}
      <div className="tool-meta">{tool.cwd && <span>{tool.cwd}</span>}{tool.exitCode != null && <span>退出码 {tool.exitCode}</span>}{tool.durationMs != null && <span>用时 {(tool.durationMs / 1000).toFixed(1)} 秒</span>}</div>
      {tool.kind === 'fileChange' && tool.changes?.map((change, index) => <FileChange key={`${change.path}-${index}`} change={change} applied={tool.status === 'completed'} />)}
      {tool.output ? <pre className="tool-output">{tool.output}</pre> : tool.kind === 'commandExecution' && <p>{tool.status === 'inProgress' ? '等待输出…' : '无输出'}</p>}
    </div>
  </details>;
}

export function ToolActivityGroup({ messages }: { messages: Message[] }) {
  const commands = messages.filter(message => message.tool?.kind === 'commandExecution').length;
  const files = messages.reduce((sum, message) => sum + (message.tool?.changes?.length || 0), 0);
  const running = messages.some(message => message.tool?.status === 'inProgress');
  return <section className="tool-activity" aria-label="执行记录"><details open>
    <summary className="tool-group-summary"><TerminalSquare size={14} /><span>{running ? '正在执行' : '执行记录'}{commands > 0 && ` · ${commands} 个命令`}{files > 0 && ` · ${files} 个文件`}</span><ChevronRight className="disclosure" size={13} /></summary>
    {messages.map(message => message.tool && <ToolRow key={message.id} tool={message.tool} />)}
  </details></section>;
}

export function groupMessages(messages: Message[]): Message[][] {
  const groups: Message[][] = [];
  for (const message of messages) {
    const last = groups.at(-1);
    if (message.tool && last?.[0].tool) last.push(message);
    else groups.push([message]);
  }
  return groups;
}
