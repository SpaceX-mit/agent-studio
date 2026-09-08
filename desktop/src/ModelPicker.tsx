import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, RefreshCw } from 'lucide-react';

export function useModelCatalog() {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    setError('');
    try {
      const result = await window.desktop?.listModels?.();
      if (!result?.ok || !result.models?.length) throw new Error(result?.error || '无法获取模型列表。');
      setModels(result.models);
    } catch (err) {
      setModels([]);
      setError(err instanceof Error ? err.message : '无法获取模型列表。');
    } finally { pending.current = false; setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { models, loading, error, refresh };
}

export function ModelPicker({ catalog, selected, onSelect, open, setOpen }: {
  catalog: ReturnType<typeof useModelCatalog>; selected: string; onSelect: (id: string) => void;
  open: boolean; setOpen: (value: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open, setOpen]);
  return <div className="model-picker" ref={root}>
    <button className="model-button" aria-label="选择模型" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span>{catalog.loading ? '加载模型…' : catalog.models.includes(selected) ? selected : '选择模型'}</span><ChevronDown size={13} />
    </button>
    {open && <div className="floating-menu model-catalog" aria-label="MiniMax 模型">
      <div className="model-catalog-header"><span>MiniMax</span><button type="button" title="刷新模型列表" aria-label="刷新模型列表" disabled={catalog.loading} onClick={() => void catalog.refresh()}><RefreshCw size={14} /></button></div>
      {catalog.loading ? <p role="status">正在获取模型…</p> : catalog.error ? <p role="alert">{catalog.error}</p> :
        <div className="model-options">{catalog.models.map(id => <button key={id} aria-pressed={selected === id} onClick={() => { onSelect(id); setOpen(false); }}><span>{id}</span>{selected === id && <Check size={14} />}</button>)}</div>}
    </div>}
  </div>;
}
