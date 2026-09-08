import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Pin } from 'lucide-react';
import type { Thread } from './domain';

export function ThreadButton({ thread, selected, onSelect }: { thread: Thread; selected: boolean; onSelect: () => void }) {
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
  return <button className="recent" aria-current={selected ? 'page' : undefined} aria-label={thread.title} title={thread.title} onClick={onSelect} style={style} data-overflow={overflow > 1}>
    <span className="thread-title-viewport" ref={viewport}><span className="thread-title-text" ref={text}>{thread.title}</span></span>
    {thread.pinned && <Pin className="thread-pin" aria-hidden="true" />}
  </button>;
}
