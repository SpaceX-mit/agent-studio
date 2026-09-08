import { useEffect, useRef, useState } from 'react';
import { Check, Copy, GitFork, LoaderCircle } from 'lucide-react';
import { replyText } from './messageActions';

export function MessageActions({ content, onFork, disabled, onError }: {
  content: string; onFork: () => Promise<void>; disabled: boolean; onError: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [branching, setBranching] = useState(false);
  const busy = useRef(false);
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(replyText(content));
      setCopied(true); clearTimeout(reset.current);
      reset.current = setTimeout(() => setCopied(false), 1600);
    } catch { onError('复制失败，请检查剪贴板权限后重试。'); }
  };
  const fork = async () => {
    if (busy.current || disabled) return;
    busy.current = true; setBranching(true);
    try { await onFork(); }
    catch (error) { onError(`创建分支失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { busy.current = false; setBranching(false); }
  };
  return <div className="message-actions">
    <button className="reply-action" aria-label={copied ? '已复制' : '复制回复'} data-tooltip={copied ? '已复制' : '复制回复'} onClick={() => void copy()} disabled={!replyText(content)}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
    <button className="reply-action" aria-label="分支到新聊天" data-tooltip={disabled ? '请等待会话连接且本轮回复完成' : branching ? '正在创建分支…' : '分支到新聊天'} onClick={() => void fork()} disabled={disabled || branching}>{branching ? <LoaderCircle size={14} className="action-spinner" /> : <GitFork size={14} />}</button>
    <span className="sr-only" role="status">{copied ? '回复已复制' : branching ? '正在创建分支' : ''}</span>
  </div>;
}
