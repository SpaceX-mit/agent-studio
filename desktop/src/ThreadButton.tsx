import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Archive, Pin, Trash2 } from 'lucide-react';
import type { Thread } from './domain';

export function ThreadButton({ thread, selected, onSelect, onTogglePin, onArchive, onDelete }: { thread: Thread; selected: boolean; onSelect: () => void; onTogglePin: () => void; onArchive: () => void; onDelete: () => void }) {
  const viewport = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  useEffect(() => {
    const frame = viewport.current;
    const label = text.current;
    if (!frame || !label) return;
    const measure = () => setOverflow(Math.max(0, label.scrollWidth - frame.clientWidth));
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(label);
    measure();
    return () => observer.disconnect();
  }, [thread.title]);
  const style = {
    '--title-travel': `${-overflow}px`,
    '--title-duration': `${Math.max(3, overflow / 30 + 1.2)}s`,
  } as CSSProperties;
  const action = (event: React.MouseEvent, callback: () => void) => { event.stopPropagation(); callback(); };
  return <button className="recent" aria-current={selected ? 'page' : undefined} aria-label={thread.title} title={thread.title} onClick={onSelect} style={style} data-overflow={overflow > 1}>
    <span className="thread-title-viewport" ref={viewport}><span className="thread-title-text" ref={text}>{thread.title}</span></span>
    <span className="thread-actions" aria-label={`${thread.title} 操作`}>
      <span role="button" tabIndex={0} className={`thread-action${thread.pinned ? ' active' : ''}`} aria-label={thread.pinned ? '取消置顶' : '置顶'} title={thread.pinned ? '取消置顶' : '置顶'} onClick={event => action(event, onTogglePin)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(event as unknown as React.MouseEvent, onTogglePin); } }}><Pin aria-hidden="true" /></span>
      <span role="button" tabIndex={0} className="thread-action" aria-label="归档" title="归档" onClick={event => action(event, onArchive)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(event as unknown as React.MouseEvent, onArchive); } }}><Archive aria-hidden="true" /></span>
      <span role="button" tabIndex={0} className="thread-action danger" aria-label="删除" title="删除" onClick={event => action(event, onDelete)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(event as unknown as React.MouseEvent, onDelete); } }}><Trash2 aria-hidden="true" /></span>
    </span>
    {thread.pinned && <Pin className="thread-pin" aria-hidden="true" />}
  </button>;
}
