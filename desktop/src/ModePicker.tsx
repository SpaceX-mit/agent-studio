import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { DesktopState } from './domain';

export function ModePicker({ mode, onChange }: { mode: DesktopState['mode']; onChange: (mode: DesktopState['mode']) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  return <div className="mode-picker" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => {
    if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); event.preventDefault(); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') || []);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  }}>
    <button className="brand mode-trigger" ref={trigger} aria-label="切换模式" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(value => !value)}><span>{mode === 'work' ? '工作' : 'Code'}</span><ChevronDown aria-hidden="true" /></button>
    {open && <div id={menuId} className="mode-menu" role="menu" aria-label="模式">
      {([{ id: 'work', label: '工作', description: '创建、学习和探索' }, { id: 'code', label: 'Code', description: '构建、调试和发布' }] as const).map(item => <button key={item.id} role="menuitemradio" aria-label={item.label} aria-describedby={`${menuId}-${item.id}-description`} aria-checked={mode === item.id} tabIndex={-1} onClick={() => { onChange(item.id); setOpen(false); trigger.current?.focus(); }}><span className="mode-option-text"><span>{item.label}</span><small id={`${menuId}-${item.id}-description`}>{item.description}</small></span>{mode === item.id && <Check aria-hidden="true" />}</button>)}
    </div>}
  </div>;
}
