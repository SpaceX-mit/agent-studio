import { useEffect, useState } from 'react';
import type { ReactNode, PointerEvent } from 'react';
import './windowFrame.css';

export type WindowFrameBridge = {
  customFrame?: boolean;
  windowState?: () => Promise<{ maximized?: boolean }>;
  onWindowState?: (listener: (state: { maximized?: boolean }) => void) => () => void;
  resizeFrame?: (input: { phase: string; edge?: string; x?: number; y?: number }) => void;
  toggleMaximize?: () => Promise<{ maximized?: boolean }>;
};

export function WindowFrame({ children }: { children: ReactNode }) {
  const enabled = Boolean(window.desktop?.customFrame);
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    document.documentElement.classList.add('soft-window');
    let alive = true;
    const update = (state: { maximized?: boolean }) => { if (alive) setMaximized(Boolean(state.maximized)); };
    void window.desktop?.windowState?.().then(update);
    const cleanup = window.desktop?.onWindowState?.(update);
    return () => { alive = false; cleanup?.(); document.documentElement.classList.remove('soft-window'); };
  }, [enabled]);
  if (!enabled) return children;
  const resize = (event: PointerEvent<HTMLDivElement>, phase: string, edge: string) => {
    if (phase === 'start') {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    } else if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    window.desktop?.resizeFrame?.({ phase, edge, x: event.screenX, y: event.screenY });
    if (phase === 'end') event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div className={`window-surface${maximized ? ' maximized' : ''}`}>
    {children}
    {!maximized && ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].map(edge => <div key={edge} className={`window-resize window-resize-${edge}`} aria-hidden="true"
      onPointerDown={event => resize(event, 'start', edge)} onPointerMove={event => resize(event, 'move', edge)}
      onPointerUp={event => resize(event, 'end', edge)} onPointerCancel={event => resize(event, 'end', edge)}
      onLostPointerCapture={() => window.desktop?.resizeFrame?.({ phase: 'end' })} />)}
  </div>;
}
