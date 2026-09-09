import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowUpRight, Cable, ChevronRight, LoaderCircle, Plus, Puzzle, Search } from 'lucide-react';
import { ExtensionDialog, ExtensionIcon } from './ExtensionsPage';
import { canInstall, extensionName, extensionRequest, flattenPlugins, matchesExtension } from './extensions';
import type { Plugin, PluginCatalog } from './extensions';
import './composerPlugins.css';

export function ComposerPlugins({ connected, onBrowse, onSelect }: { connected: boolean; onBrowse: () => void; onSelect: (plugin: Plugin) => void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const submenu = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const connect = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [query, setQuery] = useState('');
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<Plugin>();
  const [position, setPosition] = useState({ left: 0, top: 0, width: 280, subLeft: 0, subTop: 0, subWidth: 280, compact: false });
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const revision = ++generation.current;
    if (!connected) { setPlugins([]); setError('正在等待 Codex app-server 连接。'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const cwd = await window.desktop?.getProjectRoot?.();
      const catalog = await extensionRequest<PluginCatalog>('plugin/list', { cwds: cwd ? [cwd] : [], marketplaceKinds: ['local'] });
      if (revision !== generation.current) return;
      setPlugins(flattenPlugins(catalog));
      setError((catalog.marketplaceLoadErrors || []).map(item => item.message).join('；'));
    } catch (caught) { if (revision === generation.current) { setPlugins([]); setError(caught instanceof Error ? caught.message : '插件读取失败。'); } }
    finally { if (revision === generation.current) setLoading(false); }
  }, [connected]);
  useEffect(() => { void refresh(); return () => { ++generation.current; }; }, [refresh]);
  const close = () => { setOpen(false); setConnecting(false); trigger.current?.focus(); };
  const place = useCallback(() => {
    if (!trigger.current || !panel.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const width = Math.min(280, innerWidth - 24), subWidth = Math.min(280, innerWidth - 24);
    const height = panel.current.offsetHeight;
    const left = Math.max(12, Math.min(anchor.left, innerWidth - width - 12));
    const below = anchor.bottom + 6;
    const top = below + height <= innerHeight - 12 ? below : anchor.top - height - 6 >= 12 ? anchor.top - height - 6 : Math.max(12, innerHeight - height - 12);
    const compact = innerWidth < 620;
    const subHeight = submenu.current?.offsetHeight || 100;
    const connectOffset = connect.current ? connect.current.getBoundingClientRect().top - panel.current.getBoundingClientRect().top : 0;
    const subLeft = compact ? left : left + width + subWidth + 18 <= innerWidth ? left + width + 6 : Math.max(12, left - subWidth - 6);
    const compactTop = below + subHeight <= innerHeight - 12 ? below : Math.max(12, Math.min(top, innerHeight - subHeight - 12));
    setPosition({ left, top, width, subWidth, subLeft, subTop: compact ? compactTop : Math.max(12, Math.min(top + connectOffset, innerHeight - subHeight - 12)), compact });
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    if (submenu.current) observer.observe(submenu.current);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, connecting, place]);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target) && !submenu.current?.contains(target)) { setOpen(false); setConnecting(false); }
    };
    const focusOutside = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target) && !submenu.current?.contains(target)) { setOpen(false); setConnecting(false); }
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', focusOutside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', focusOutside); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      if (connecting) { setConnecting(false); connect.current?.focus(); }
      else close();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open, connecting]);
  const keyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); if (connecting) { setConnecting(false); connect.current?.focus(); } else close(); }
    if (event.key === 'ArrowLeft' && connecting) { event.preventDefault(); setConnecting(false); connect.current?.focus(); }
    if (event.key === 'ArrowRight' && document.activeElement === connect.current) { event.preventDefault(); setConnecting(true); requestAnimationFrame(() => submenu.current?.querySelector<HTMLButtonElement>('button')?.focus()); }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const root = submenu.current?.contains(document.activeElement) ? submenu.current : panel.current;
      const items = Array.from(root?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') || []);
      const index = items.indexOf(document.activeElement as HTMLElement);
      items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  };
  const installed = plugins.filter(plugin => plugin.installed && plugin.enabled);
  const visible = installed.filter(plugin => matchesExtension(plugin, query));
  const available = plugins.filter(plugin => (!plugin.installed || !plugin.enabled) && canInstall(plugin) && matchesExtension(plugin, query));
  const dark = Boolean(trigger.current?.closest('.dark'));
  const browse = () => { close(); onBrowse(); };
  return <>
    <button ref={trigger} className="work-plugins" aria-label="插件" aria-expanded={open} aria-haspopup="dialog" onClick={() => { if (open) close(); else { setQuery(''); setOpen(true); void refresh(); } }}>
      <span className="composer-plugin-preview" aria-hidden="true">{installed.length ? installed.slice(0, 3).map(plugin => <ExtensionIcon key={plugin.id} item={plugin} />) : <Puzzle />}</span><span>插件</span>
    </button>
    {open && createPortal(<div className={`composer-plugin-layer${dark ? ' dark' : ''}`} onKeyDown={keyboard}>
      <div ref={panel} className="composer-plugin-menu" role="dialog" aria-label="选择插件" style={{ left: position.left, top: position.top, width: position.width, visibility: connecting && position.compact ? 'hidden' : undefined }}>
        <label className="composer-plugin-search"><Search /><input ref={search} aria-label="搜索对话插件" placeholder="搜索插件…" value={query} onChange={event => setQuery(event.target.value)} /></label>
        {loading && <p className="composer-plugin-status" role="status"><LoaderCircle className="action-spinner" />正在读取插件…</p>}
        {error && <div className="composer-plugin-error" role="alert">{error}<button disabled={loading || !connected} onClick={() => void refresh()}>重试</button></div>}
        <div className="composer-plugin-list">{visible.map(plugin => <button key={plugin.id} onClick={() => { close(); onSelect(plugin); }}><ExtensionIcon item={plugin} /><span>{extensionName(plugin)}</span></button>)}
          {!loading && !error && !visible.length && <p className="composer-plugin-status">{query ? '没有匹配的插件' : '暂无已启用插件'}</p>}
        </div>
        <div className="composer-plugin-connect"><button ref={connect} aria-expanded={connecting} aria-haspopup="menu" onMouseEnter={() => { if (innerWidth >= 620) setConnecting(true); }} onClick={() => { setConnecting(true); requestAnimationFrame(() => submenu.current?.querySelector<HTMLButtonElement>('button')?.focus()); }}><Cable /><span>连接插件</span><ChevronRight /></button></div>
      </div>
      {connecting && <div ref={submenu} className="composer-plugin-menu composer-plugin-submenu" role="menu" aria-label="连接插件" style={{ left: position.subLeft, top: position.subTop, width: position.subWidth }}>
        {position.compact && <button onClick={() => { setConnecting(false); requestAnimationFrame(() => connect.current?.focus()); }}><ArrowLeft /><span>返回插件</span></button>}
        <div className="composer-plugin-list">{available.map(plugin => <button key={plugin.id} role="menuitem" onClick={() => { close(); setSelection(plugin); }}><ExtensionIcon item={plugin} /><span>{extensionName(plugin)}</span><Plus /></button>)}</div>
        <button className="composer-plugin-browse" role="menuitem" onClick={browse}><span>浏览所有插件</span><ArrowUpRight /></button>
      </div>}
    </div>, document.body)}
    {selection && <ExtensionDialog selection={{ kind: 'plugin', item: selection }} close={() => setSelection(undefined)} changed={async () => { await refresh(); }} />}
  </>;
}
