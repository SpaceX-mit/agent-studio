async function listMiniMaxModels({ apiKey, fetchImpl = fetch } = {}) {
  if (!apiKey?.trim()) return { ok: false, models: [], error: '未配置 MINIMAX_API_KEY，请带密钥重新启动。' };
  try {
    const response = await fetchImpl('https://api.minimaxi.com/v1/models', {
      headers: { authorization: `Bearer ${apiKey.trim()}` },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      const reason = response.status === 401 || response.status === 403 ? '请检查 API Key 和账户权限。'
        : response.status === 404 ? '服务未提供该模型列表接口。' : '请稍后刷新重试。';
      return { ok: false, models: [], error: `模型列表获取失败（HTTP ${response.status}）。${reason}` };
    }
    const body = await response.json();
    if (body?.error || (body?.base_resp?.status_code != null && body.base_resp.status_code !== 0)) {
      return { ok: false, models: [], error: '模型列表接口返回错误，请检查账户权限后重试。' };
    }
    const items = Array.isArray(body) ? body : body?.data ?? body?.models;
    if (!Array.isArray(items)) return { ok: false, models: [], error: '模型列表格式异常，请稍后重试。' };
    const models = [...new Set(items.map(item => typeof item === 'string' ? item : item?.id)
      .filter(id => typeof id === 'string' && id.trim()).map(id => id.trim()))];
    if (!models.length) return { ok: false, models: [], error: '接口未返回可用模型。' };
    return { ok: true, models };
  } catch (error) {
    return { ok: false, models: [], error: error?.name === 'TimeoutError' ? '模型列表请求超时，请刷新重试。' : '无法读取模型列表，请检查网络后重试。' };
  }
}

module.exports = { listMiniMaxModels };
