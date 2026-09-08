import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, ChevronRight, Download, LoaderCircle, MoreHorizontal, Puzzle, RefreshCw, Search, Settings2, SlidersHorizontal, Trash2, X } from 'lucide-react';
import type { Plugin, PluginCatalog, PluginDetail, Skill } from './extensions';
import { canInstall, extensionDescription, extensionName, extensionRequest, flattenPlugins, isPublicPlugin, matchesExtension, pluginSelector, readExtensionFile, setPluginEnabled, skillKey } from './extensions';
import './extensions.css';

type Selection = { kind: 'plugin'; item: Plugin } | { kind: 'skill'; item: Skill };
type SkillsResponse = { data: { skills: Skill[]; errors: { path: string; message: string }[] }[] };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function ExtensionIcon({ item }: { item: Plugin | Skill }) {
  const face = item.interface;
  const local = face?.iconLarge || face?.logo || face?.iconSmall || face?.composerIcon;
  const remote = face?.iconLargeUrl || face?.logoUrl || face?.iconSmallUrl || face?.composerIconUrl;
  const [image, setImage] = useState('');
  useEffect(() => {
    let active = true;
    setImage('');
    if (local) readExtensionFile(local, 'image').then(src => { if (active) setImage(src); }).catch(() => {});
    else if (remote?.startsWith('https://')) setImage(remote);
    return () => { active = false; };
  }, [local, remote]);
  return <span className="ext-icon">{image ? <img src={image} alt="" onError={() => setImage('')} /> : 'description' in item ? <BookOpen size={22} /> : <Puzzle size={22} />}</span>;
}

export function ExtensionsPage({ connected }: { connected: boolean }) {
  const [tab, setTab] = useState<'plugins' | 'skills'>('plugins');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'public' | 'personal'>('public');
  const [skillScope, setSkillScope] = useState<'system' | 'recommended'>('system');
  const [category, setCategory] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [installedOnly, setInstalledOnly] = useState(false);
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [featured, setFeatured] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [selection, setSelection] = useState<Selection>();
  const [recommended, setRecommended] = useState<Skill[]>([]);
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [recommendError, setRecommendError] = useState('');
  const [notice, setNotice] = useState('');
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    if (!connected) return;
    const generation = ++revision.current;
    setLoading(true);
    try {
      const root = await window.desktop?.getProjectRoot?.();
      const cwds = root ? [root] : [];
      const results = await Promise.allSettled([
        extensionRequest<PluginCatalog>('plugin/list', { cwds, marketplaceKinds: ['local'] }),
        extensionRequest<SkillsResponse>('skills/list', { cwds, forceReload: true })
      ]);
      if (generation !== revision.current) return;
      const failures: string[] = [];
      if (results[0].status === 'fulfilled') {
        const catalog = results[0].value;
        setPlugins(flattenPlugins(catalog));
        setFeatured(catalog.featuredPluginIds || []);
        failures.push(...(catalog.marketplaceLoadErrors || []).map(error => `${error.marketplacePath}: ${error.message}`));
      } else failures.push(`插件: ${errorText(results[0].reason)}`);
      if (results[1].status === 'fulfilled') {
        const data = results[1].value.data;
        setSkills([...new Map(data.flatMap(entry => entry.skills.map(skill => [skillKey(skill), skill] as const))).values()]);
        failures.push(...data.flatMap(entry => entry.errors.map(error => `${error.path}: ${error.message}`)));
      } else failures.push(`技能: ${errorText(results[1].reason)}`);
      setErrors(failures);
    } catch (error) { if (generation === revision.current) setErrors([errorText(error)]); }
    finally { if (generation === revision.current) setLoading(false); }
  }, [connected]);
  useEffect(() => { void refresh(); return () => { revision.current++; }; }, [refresh]);
  useEffect(() => window.codex?.onNotification((event: { method: string }) => {
    if (event.method === 'skills/changed') void refresh();
  }), [refresh]);

  useEffect(() => {
    if (tab !== 'skills' || skillScope !== 'recommended' || loading || !connected) return;
    let cancelled = false;
    const candidates = plugins.filter(plugin => !plugin.installed && plugin.source?.type === 'local' && canInstall(plugin));
    setRecommendLoading(true);
    setRecommendError('');
    const list: Skill[] = [];
    const failures: string[] = [];
    let index = 0;
    const worker = async () => {
      while (!cancelled && index < candidates.length) {
        const plugin = candidates[index++];
        try {
          const { plugin: detail } = await extensionRequest<{ plugin: PluginDetail }>('plugin/read', pluginSelector(plugin));
          list.push(...detail.skills.map(skill => ({ ...skill, parent: plugin, enabled: false })));
        } catch { failures.push(extensionName(plugin)); }
      }
    };
    void Promise.all(Array.from({ length: 4 }, worker)).then(() => {
      if (cancelled) return;
      setRecommended(list.sort((a, b) => extensionName(a).localeCompare(extensionName(b))));
      setRecommendError(failures.length ? `部分插件技能未能读取: ${failures.join('、')}` : '');
      setRecommendLoading(false);
    });
    return () => { cancelled = true; };
  }, [tab, skillScope, plugins, loading, connected]);

  const matchingPlugins = useMemo(() => plugins.filter(plugin => matchesExtension(plugin, query)), [plugins, query]);
  const installedPlugins = matchingPlugins.filter(plugin => plugin.installed);
  const visiblePlugins = matchingPlugins.filter(plugin => (installedOnly ? plugin.installed : isPublicPlugin(plugin) === (scope === 'public')) && (!category || (plugin.interface?.category || '其他') === category));
  const categories = [...new Set(plugins.map(plugin => plugin.interface?.category || '其他'))].sort();
  const groups = [...new Set(visiblePlugins.map(plugin => plugin.interface?.category || '其他'))];
  const matchingSkills = skills.filter(skill => matchesExtension(skill, query));
  const skillList = skillScope === 'system' ? matchingSkills.filter(skill => skill.scope === 'system') : recommended.filter(skill => matchesExtension(skill, query));
  const waiting = !connected || loading;

  const pluginRow = (plugin: Plugin) => <div className="ext-row" key={plugin.id}>
    <button className="ext-row-main" onClick={() => setSelection({ kind: 'plugin', item: plugin })}><ExtensionIcon item={plugin} /><span className="ext-copy"><strong>{extensionName(plugin)}</strong><small>{extensionDescription(plugin)}</small></span></button>
    <button className="ext-tool" aria-label={`管理 ${extensionName(plugin)}`} title={`管理 ${extensionName(plugin)}`} onClick={() => setSelection({ kind: 'plugin', item: plugin })}><MoreHorizontal size={16} /></button>
  </div>;
  const skillRow = (skill: Skill) => <button className="ext-row ext-skill-row" key={skillKey(skill)} onClick={() => setSelection({ kind: 'skill', item: skill })}>
    <ExtensionIcon item={skill} /><span className="ext-copy"><strong>{extensionName(skill)}</strong><small>{extensionDescription(skill)}</small></span>
    <span className="ext-state" aria-label={skill.parent ? '未安装' : skill.enabled ? '已启用' : '已停用'}>{skill.parent ? <Download size={16} /> : skill.enabled ? <Check size={17} /> : <span className="ext-disabled-dot" />}</span>
  </button>;

  return <section className="extensions">
    <nav className="ext-tabs" role="tablist" aria-label="扩展类型">{(['plugins', 'skills'] as const).map(value => <button key={value} id={`ext-tab-${value}`} role="tab" tabIndex={tab === value ? 0 : -1} aria-selected={tab === value} aria-controls="ext-panel" onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'plugins' : event.key === 'End' ? 'skills' : tab === 'plugins' ? 'skills' : 'plugins'; setTab(next); setQuery(''); document.getElementById(`ext-tab-${next}`)?.focus(); } }} onClick={() => { setTab(value); setQuery(''); setNotice(''); }}>{value === 'plugins' ? '插件' : '技能'}</button>)}</nav>
    <div className="ext-scroll" role="tabpanel" id="ext-panel" aria-labelledby={`ext-tab-${tab}`}>
      <div className="ext-content">
        <header className="ext-heading"><h1>{tab === 'plugins' ? '插件' : '技能'}</h1><button className="ext-tool" disabled={waiting} onClick={() => void refresh()} aria-label="刷新扩展" title="刷新扩展"><RefreshCw size={16} className={loading && connected ? 'action-spinner' : ''} /></button></header>
        <label className="ext-search"><Search size={16} /><input aria-label={tab === 'plugins' ? '搜索插件' : '搜索技能'} placeholder={tab === 'plugins' ? '搜索插件' : '搜索技能'} value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="ext-tool" aria-label="清除搜索" onClick={() => setQuery('')}><X size={14} /></button>}</label>
        {!connected && <p className="ext-empty" role="status">正在等待 Codex app-server 连接。</p>}
        {connected && loading && <p className="ext-empty" role="status"><LoaderCircle size={15} className="action-spinner" /> 正在读取扩展…</p>}
        {errors.length > 0 && <div className="ext-error" role="alert"><strong>部分扩展加载失败</strong>{errors.map((error, index) => <p key={index}>{error}</p>)}<button onClick={() => void refresh()} disabled={waiting}>重试</button></div>}
        {notice && <p className="ext-notice" role="status">{notice}</p>}
        <section className="ext-section"><header><h2>已安装</h2>{tab === 'plugins' && <button className="ext-tool" title="管理已安装插件" aria-label="管理已安装插件" aria-pressed={installedOnly} onClick={() => setInstalledOnly(value => !value)}><Settings2 size={16} /></button>}</header>
          {tab === 'plugins' ? <div className="ext-installed">{installedPlugins.map(plugin => <button key={plugin.id} title={`${extensionName(plugin)}${plugin.enabled ? '' : ' · 已停用'}`} aria-label={extensionName(plugin)} className={!plugin.enabled ? 'ext-muted' : ''} onClick={() => setSelection({ kind: 'plugin', item: plugin })}><ExtensionIcon item={plugin} /></button>)}</div> : <div className="ext-grid">{matchingSkills.map(skillRow)}</div>}
          {!waiting && (tab === 'plugins' ? !installedPlugins.length : !matchingSkills.length) && <p className="ext-empty">{query ? '没有匹配的已安装扩展' : tab === 'plugins' ? '暂无已安装插件' : '暂无已安装技能'}</p>}
        </section>
        <div className="ext-filters"><div role="group" aria-label="扩展范围">{tab === 'plugins' ? <>
          <button aria-pressed={!installedOnly && scope === 'public'} onClick={() => { setScope('public'); setInstalledOnly(false); }}>公开</button><button aria-pressed={!installedOnly && scope === 'personal'} onClick={() => { setScope('personal'); setInstalledOnly(false); }}>个人</button>{installedOnly && <button aria-pressed="true" onClick={() => setInstalledOnly(false)}>已安装 <X size={12} /></button>}
        </> : <><button aria-pressed={skillScope === 'system'} onClick={() => setSkillScope('system')}>系统</button><button aria-pressed={skillScope === 'recommended'} onClick={() => setSkillScope('recommended')}>推荐</button></>}</div>
          {tab === 'plugins' && <button className="ext-tool" title="筛选类别" aria-label="筛选类别" aria-expanded={showFilter} onClick={() => setShowFilter(value => !value)}><SlidersHorizontal size={16} /></button>}
        </div>
        {showFilter && tab === 'plugins' && <label className="ext-category">类别<select aria-label="插件类别" value={category} onChange={event => setCategory(event.target.value)}><option value="">全部类别</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label>}
        {tab === 'plugins' ? <>
          {!installedOnly && scope === 'public' && visiblePlugins.some(plugin => featured.includes(plugin.id)) && <section className="ext-section"><header><h2>Featured</h2></header><div className="ext-grid">{visiblePlugins.filter(plugin => featured.includes(plugin.id)).map(pluginRow)}</div></section>}
          {groups.map(group => <section className="ext-section" key={group}><header><h2>{group}</h2></header><div className="ext-grid">{visiblePlugins.filter(plugin => (plugin.interface?.category || '其他') === group).map(pluginRow)}</div></section>)}
          {!waiting && !visiblePlugins.length && <p className="ext-empty">{query || category ? '没有匹配的插件' : installedOnly ? '暂无已安装插件' : scope === 'personal' ? '暂无个人插件' : '暂无可用插件'}</p>}
        </> : <>
          {skillScope === 'recommended' && recommendLoading && <p className="ext-empty" role="status">正在读取推荐技能…</p>}
          {skillScope === 'recommended' && recommendError && <p className="ext-error" role="alert">{recommendError}</p>}
          <div className="ext-grid">{skillList.map(skillRow)}</div>
          {!waiting && !(skillScope === 'recommended' && recommendLoading) && !skillList.length && <p className="ext-empty">{query ? '没有匹配的技能' : skillScope === 'system' ? '暂无系统技能' : '暂无可安装的推荐技能'}</p>}
        </>}
      </div>
    </div>
    {selection && <ExtensionDialog key={selection.kind + ('id' in selection.item ? selection.item.id : skillKey(selection.item))} selection={selection} close={() => setSelection(undefined)} changed={async message => { setNotice(message); await refresh(); }} />}
  </section>;
}

function ExtensionDialog({ selection, close, changed }: { selection: Selection; close: () => void; changed: (message: string) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<PluginDetail>();
  const [item, setItem] = useState(selection.item);
  const [loading, setLoading] = useState(selection.kind === 'plugin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [contents, setContents] = useState<string>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const plugin = selection.kind === 'plugin' ? item as Plugin : (item as Skill).parent;
  const skill = selection.kind === 'skill' ? item as Skill : undefined;
  const installed = skill ? !skill.parent : plugin?.installed;
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let active = true;
    if (plugin) {
      setLoading(true);
      extensionRequest<{ plugin: PluginDetail }>('plugin/read', pluginSelector(plugin)).then(result => { if (active) setDetail(result.plugin); }).catch(error => { if (active) setError(errorText(error)); }).finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, [plugin?.id]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(''); setStatus('');
    try { await action(); } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  };
  const install = () => run(async () => {
    if (!plugin) return;
    const result = await extensionRequest<{ appsNeedingAuth: { name: string }[] }>('plugin/install', pluginSelector(plugin));
    const message = result.appsNeedingAuth?.length ? `安装完成，仍需授权: ${result.appsNeedingAuth.map(app => app.name).join('、')}` : '插件已安装。';
    if (skill) { await changed(message); close(); }
    else { setItem({ ...plugin, installed: true, enabled: true }); setStatus(message); await changed(message); }
  });
  const toggle = () => run(async () => {
    if (skill) {
      const result = await extensionRequest<{ effectiveEnabled: boolean }>('skills/config/write', { path: skill.path, enabled: !skill.enabled });
      setItem({ ...skill, enabled: result.effectiveEnabled });
    } else if (plugin) { await setPluginEnabled(plugin, !plugin.enabled); setItem({ ...plugin, enabled: !plugin.enabled }); }
    await changed('扩展配置已更新。');
  });
  return <dialog ref={dialog} className="ext-dialog" aria-labelledby="ext-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }} onClick={event => { if (event.target === event.currentTarget && !busy) close(); }}>
    <div className="ext-dialog-body"><header className="ext-dialog-heading"><ExtensionIcon item={item} /><div><h2 id="ext-dialog-title">{extensionName(item)}</h2><small>{skill ? skill.parent ? `来自 ${extensionName(skill.parent)}` : skill.scope === 'system' ? '系统技能' : '已安装技能' : plugin?.interface?.developerName || plugin?.marketplaceName}</small></div><button className="ext-tool" title="关闭详情" aria-label="关闭详情" onClick={close} disabled={busy}><X size={18} /></button></header>
      <p className="ext-description">{skill?.description || detail?.description || item.interface?.longDescription || extensionDescription(item)}</p>
      {loading && <p className="ext-empty" role="status">正在读取详情…</p>}
      {error && <p className="ext-error" role="alert">{error}</p>}
      {status && <p className="ext-notice" role="status">{status}</p>}
      {detail && <>
        <dl className="ext-metadata"><dt>来源</dt><dd>{plugin?.marketplaceName}</dd><dt>版本</dt><dd>{plugin?.localVersion || plugin?.version || '未提供'}</dd><dt>状态</dt><dd>{installed ? item.enabled ? '已安装 · 已启用' : '已安装 · 已停用' : '未安装'}</dd></dl>
        {detail.skills.length > 0 && <section className="ext-detail-section"><h3>包含的技能</h3>{detail.skills.map(value => <div className="ext-detail-skill" key={value.name}><BookOpen size={15} /><span>{extensionName(value)}</span></div>)}</section>}
        {(detail.mcpServers.length > 0 || detail.apps.length > 0 || detail.hooks.length > 0) && <section className="ext-detail-section"><h3>连接与权限</h3>{detail.mcpServers.map(name => <p key={name}>MCP: {name}</p>)}{detail.apps.map(app => <p key={app.name}>{app.name} · 需要账号连接</p>)}{detail.hooks.map(hook => <p key={hook.key}>{hook.eventName}: {hook.key}</p>)}<p className="ext-dependency-note">第三方服务可能需要额外授权、密钥或运行环境。</p></section>}
      </>}
      {skill?.path && <><p className="ext-file-path">{skill.path}</p><button className="ext-text-button" disabled={busy} onClick={() => contents === undefined ? void run(async () => { setContents(await readExtensionFile(skill.path!, 'skill')); }) : setContents(undefined)}><ChevronRight size={15} />{contents === undefined ? '查看 SKILL.md' : '收起 SKILL.md'}</button>{contents !== undefined && <pre className="ext-source">{contents}</pre>}</>}
      {skill?.parent && <p className="ext-dependency-note">此技能随 {extensionName(skill.parent)} 插件安装，包含该插件的其他技能和连接。</p>}
      {plugin && !canInstall(plugin) && !installed && <p className="ext-error">此插件当前不可安装。</p>}
      {confirmRemove && <p className="ext-error" role="alert">卸载后将移除该插件提供的技能和连接。确认卸载？</p>}
      <footer className="ext-dialog-actions">
        {installed ? <><label className="ext-toggle"><input type="checkbox" role="switch" aria-label={skill ? '启用技能' : '启用插件'} checked={item.enabled} onChange={toggle} disabled={busy || loading} /><span>启用</span></label>{plugin && !skill && <button className="ext-danger" disabled={busy || loading} onClick={() => confirmRemove ? void run(async () => { await extensionRequest('plugin/uninstall', { pluginId: plugin.id }); await changed('插件已卸载，仍可重新安装。'); close(); }) : setConfirmRemove(true)}><Trash2 size={15} />{confirmRemove ? '确认卸载' : '卸载'}</button>}{confirmRemove && <button disabled={busy} onClick={() => setConfirmRemove(false)}>取消</button>}</> : <button className="ext-primary" disabled={busy || loading || !detail || !plugin || !canInstall(plugin)} onClick={install}>{busy ? <LoaderCircle size={15} className="action-spinner" /> : <Download size={15} />}{busy ? '正在安装…' : skill ? '安装所属插件' : '安装'}</button>}
        {busy && installed && <LoaderCircle size={16} className="action-spinner" aria-label="正在更新" />}
      </footer>
    </div>
  </dialog>;
}
