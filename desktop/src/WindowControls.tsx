import { useEffect, useRef, useState } from 'react';
import './windowControls.css';

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    let alive = true;
    let receivedUpdate = false;
    const unsubscribe = window.desktop?.onWindowState?.(state => {
      receivedUpdate = true;
      if (alive) setMaximized(Boolean(state.maximized));
    });
    void window.desktop?.windowState?.().then(state => {
      if (alive && !receivedUpdate) setMaximized(Boolean(state.maximized));
    }).catch(() => {});
    const poll = window.setInterval(() => {
      void window.desktop?.windowState?.().then(state => { if (alive) setMaximized(Boolean(state.maximized)); }).catch(() => {});
    }, 350);
    return () => { alive = false; aliveRef.current = false; window.clearInterval(poll); unsubscribe?.(); };
  }, []);

  return <div className="window-controls" role="group" aria-label="窗口控制">
    <button type="button" aria-label="最小化" title="最小化" onClick={() => window.desktop?.minimize?.()}>
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6.5h10" /></svg>
    </button>
    <button type="button" data-window-action="maximize-restore" aria-label={maximized ? '向下还原' : '最大化'} title={maximized ? '向下还原' : '最大化'} onClick={async () => {
      try {
        const result = await window.desktop?.toggleMaximize?.();
        if (aliveRef.current && result) setMaximized(Boolean(result.maximized));
        // A second read handles DWM state changes that complete after the IPC response.
        const settled = await window.desktop?.windowState?.();
        if (aliveRef.current && settled) setMaximized(Boolean(settled.maximized));
      }
      catch { /* keep the current state if the native window is unavailable */ }
    }}>
      <svg viewBox="0 0 12 12" aria-hidden="true">{maximized
        ? <><path d="M3.5 3.5v-2h7v7h-2" /><rect x="1.5" y="3.5" width="7" height="7" /></>
        : <rect x="1.5" y="1.5" width="9" height="9" />}</svg>
    </button>
    <button type="button" className="window-close" aria-label="关闭" title="关闭" onClick={() => window.desktop?.close?.()}>
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m1 1 10 10M11 1 1 11" /></svg>
    </button>
  </div>;
}
