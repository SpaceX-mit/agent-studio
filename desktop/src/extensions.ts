export type ExtensionInterface = {
  displayName?: string | null; shortDescription?: string | null; longDescription?: string | null;
  iconSmall?: string | null; iconLarge?: string | null; iconSmallUrl?: string | null; iconLargeUrl?: string | null;
  logo?: string | null; logoUrl?: string | null; composerIcon?: string | null; composerIconUrl?: string | null;
  category?: string | null; developerName?: string | null; defaultPrompt?: string | string[] | null;
};
export type Plugin = {
  id: string; name: string; installed: boolean; enabled: boolean; interface?: ExtensionInterface | null;
  version?: string | null; localVersion?: string | null; installPolicy?: string; availability?: string;
  source?: { type: string; path?: string; url?: string }; keywords?: string[];
  marketplaceName: string; marketplacePath?: string | null;
};
export type Skill = {
  name: string; path?: string | null; description: string; shortDescription?: string | null;
  scope?: string; enabled: boolean; interface?: ExtensionInterface | null; pluginId?: string | null;
  parent?: Plugin;
};
export type PluginDetail = {
  summary: Plugin; description?: string; skills: Skill[]; mcpServers: string[];
  apps: { name: string }[]; hooks: { key: string; eventName: string }[];
};
export type PluginCatalog = {
  marketplaces: { name: string; path?: string | null; plugins: Omit<Plugin, 'marketplaceName'>[] }[];
  marketplaceLoadErrors?: { message: string; marketplacePath: string }[]; featuredPluginIds?: string[];
};
export const extensionName = (item: Plugin | Skill) => item.interface?.displayName || item.name;
export const extensionDescription = (item: Plugin | Skill) => item.interface?.shortDescription || ('description' in item ? item.shortDescription || item.description : '') || '';
export const skillKey = (skill: Skill) => skill.path || `${skill.parent?.id || skill.pluginId || ''}:${skill.name}`;
export const isPublicPlugin = (plugin: Plugin) => /^openai-(api-)?curated(?:-remote)?$/.test(plugin.marketplaceName);
export const canInstall = (plugin: Plugin) => plugin.installPolicy !== 'NOT_AVAILABLE' && (!plugin.availability || plugin.availability === 'AVAILABLE');
export function flattenPlugins(catalog: PluginCatalog): Plugin[] {
  return [...new Map(catalog.marketplaces.flatMap(market => market.plugins.map(plugin => [plugin.id, { ...plugin, marketplaceName: market.name, marketplacePath: market.path }] as const))).values()];
}
export function matchesExtension(item: Plugin | Skill, query: string) {
  return `${extensionName(item)} ${item.name} ${extensionDescription(item)} ${'keywords' in item ? item.keywords?.join(' ') : ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}
export function pluginSelector(plugin: Plugin) {
  return plugin.marketplacePath ? { marketplacePath: plugin.marketplacePath, pluginName: plugin.name } : { remoteMarketplaceName: plugin.marketplaceName, pluginName: plugin.name };
}
export async function extensionRequest<T>(method: string, params: unknown): Promise<T> {
  if (!window.codex) throw new Error('Codex app-server unavailable');
  const result = await window.codex.request(method, params);
  if (!result?.ok) throw new Error(result?.error?.message || result?.error || 'Extension request failed');
  return result.result as T;
}
export async function setPluginEnabled(plugin: Plugin, enabled: boolean) {
  // Quote the plugin ID as one TOML key, including any dots in its name.
  await extensionRequest('config/batchWrite', { edits: [{ keyPath: `plugins.${JSON.stringify(plugin.id)}.enabled`, value: enabled, mergeStrategy: 'replace' }], reloadUserConfig: true });
}
export async function readExtensionFile(path: string, kind: 'image' | 'skill'): Promise<string> {
  const response = await window.desktop?.readExtensionFile?.(path, kind);
  if (!response?.ok) throw new Error(response?.error || 'Extension file reader unavailable');
  return response.result;
}
