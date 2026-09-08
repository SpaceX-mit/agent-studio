const http = require('node:http');
const { randomUUID, createHash } = require('node:crypto');

function alias(name, namespace) {
  const full = namespace ? namespace + '__' + name : name;
  if (/^[a-zA-Z0-9_-]{1,64}$/.test(full)) return full;
  return full.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 42) + '_' + createHash('sha256').update(full).digest('hex').slice(0, 16);
}

function convertRequest(input) {
  if (!input.model) throw new Error('A model ID is required');
  const definitions = new Map();
  const tools = [];
  function add(tool, namespace, discovered = false) {
    if (tool.type === 'namespace') { tool.tools.forEach(child => add(child, tool.name, discovered)); return; }
    if (tool.type === 'tool_search') {
      if (tool.execution !== 'client') throw new Error('Only client-side tool search is supported');
      tool = { ...tool, name: 'tool_search' };
    }
    if (!['function', 'custom', 'tool_search'].includes(tool.type)) throw new Error('Unsupported Responses tool type: ' + tool.type);
    const name = alias(tool.name, namespace);
    if (definitions.has(name)) { if (discovered) return; throw new Error('Duplicate tool alias: ' + name); }
    definitions.set(name, { ...tool, namespace });
    const custom = tool.type === 'custom';
    tools.push({ type: 'function', function: {
      name,
      description: [tool.description, custom && 'Pass the complete raw tool input in the input string.', custom && tool.format?.definition].filter(Boolean).join('\n'),
      parameters: custom ? { type: 'object', properties: { input: { type: 'string' } }, required: ['input'], additionalProperties: false } : tool.parameters,
      ...(tool.strict == null || custom ? {} : { strict: tool.strict })
    } });
  }
  (input.tools || []).forEach(tool => add(tool));
  const messages = [];
  if (input.instructions) messages.push({ role: 'system', content: input.instructions });
  const items = typeof input.input === 'string' ? [{ role: 'user', content: input.input }] : input.input || [];
  for (const item of items) {
    if (item.type === 'reasoning') continue;
    if (item.type === 'tool_search_call') {
      messages.push({ role: 'assistant', content: null, tool_calls: [{ id: item.call_id, type: 'function', function: { name: 'tool_search', arguments: JSON.stringify(item.arguments) } }] });
      continue;
    }
    if (item.type === 'tool_search_output') {
      if (!item.call_id) throw new Error('Tool search output is missing call_id');
      (item.tools || []).forEach(tool => add(tool, undefined, true));
      messages.push({ role: 'tool', tool_call_id: item.call_id, content: JSON.stringify(item.tools) });
      continue;
    }
    if (item.type === 'function_call' || item.type === 'custom_tool_call') {
      const call = { id: item.call_id, type: 'function', function: {
        name: alias(item.name, item.namespace),
        arguments: item.type === 'custom_tool_call' ? JSON.stringify({ input: item.input }) : item.arguments
      } };
      const last = messages.at(-1);
      if (last?.role === 'assistant') (last.tool_calls ||= []).push(call);
      else messages.push({ role: 'assistant', content: null, tool_calls: [call] });
    } else if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') {
      if (!item.call_id) throw new Error('Tool output is missing call_id');
      messages.push({ role: 'tool', tool_call_id: item.call_id, content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output) });
    } else if (item.type === 'message' || item.role) {
      const role = item.role === 'developer' ? 'system' : item.role;
      if (!['system', 'user', 'assistant'].includes(role)) throw new Error('Unsupported message role: ' + role);
      const content = typeof item.content === 'string' ? item.content : (item.content || []).map(part => {
        if (!['input_text', 'output_text', 'text'].includes(part.type)) throw new Error('Unsupported message content: ' + part.type);
        return part.text;
      }).join('\n');
      if (content) messages.push({ role, content });
    } else throw new Error('Unsupported Responses input type: ' + item.type);
  }
  let choice = input.tool_choice;
  if (choice && typeof choice === 'object') {
    const name = alias(choice.name, choice.namespace);
    if (!definitions.has(name)) throw new Error('Requested tool_choice is unavailable');
    choice = { type: 'function', function: { name } };
  }
  return { definitions, body: {
    model: input.model, messages, stream: true, reasoning_split: true,
    ...(tools.length ? { tools, tool_choice: choice || 'auto', ...(input.parallel_tool_calls == null ? {} : { parallel_tool_calls: input.parallel_tool_calls }) } : {}),
    ...(input.temperature == null ? {} : { temperature: input.temperature })
  } };
}

// Decode UTF-8 across network chunks and dispatch complete SSE data records.
async function* readSse(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  let data = [];
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (!line) { if (data.length) { yield data.join('\n'); data = []; } }
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  buffer += decoder.decode();
  if (buffer.startsWith('data:')) data.push(buffer.slice(5).trimStart());
  if (data.length) yield data.join('\n');
}

async function translateStream(body, definitions, model, emit) {
  const responseId = 'resp_' + randomUUID();
  const output = [];
  const calls = new Map();
  let message;
  let text = '';
  let finish;
  let usage;
  emit({ type: 'response.created', response: { id: responseId, object: 'response', status: 'in_progress', model, output: [] } });
  try {
    for await (const data of readSse(body)) {
      if (data === '[DONE]') break;
      const chunk = JSON.parse(data);
      if (chunk.error) throw Object.assign(new Error(chunk.error.message || 'MiniMax stream error'), { code: chunk.error.code });
      if (chunk.base_resp?.status_code) throw new Error('MiniMax error ' + chunk.base_resp.status_code);
      if (chunk.usage) usage = { input_tokens: chunk.usage.prompt_tokens || 0, output_tokens: chunk.usage.completion_tokens || 0, total_tokens: chunk.usage.total_tokens || 0 };
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (finish) throw new Error('Received output after finish_reason');
      const delta = choice.delta || {};
      if (typeof delta.content === 'string' && delta.content) {
        if (!message) {
          message = { type: 'message', id: 'msg_' + randomUUID(), role: 'assistant', status: 'in_progress', content: [] };
          output.push(message);
          emit({ type: 'response.output_item.added', output_index: 0, item: { ...message } });
          emit({ type: 'response.content_part.added', item_id: message.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
        }
        text += delta.content;
        emit({ type: 'response.output_text.delta', item_id: message.id, output_index: 0, content_index: 0, delta: delta.content });
      }
      for (const fragment of delta.tool_calls || []) {
        if (!Number.isInteger(fragment.index) || fragment.index < 0) throw new Error('Invalid tool call index');
        let call = calls.get(fragment.index);
        if (!call) { call = { id: '', name: '', arguments: '' }; calls.set(fragment.index, call); }
        if (fragment.id) {
          if (call.id && call.id !== fragment.id) throw new Error('Tool call ID changed during streaming');
          call.id = fragment.id;
        }
        if (fragment.function?.name) call.name += fragment.function.name;
        if (fragment.function?.arguments) call.arguments += fragment.function.arguments;
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
    if (!['stop', 'tool_calls'].includes(finish)) throw new Error('Incomplete model response: ' + (finish || 'stream ended without finish_reason'));
    if (finish === 'tool_calls' && !calls.size) throw new Error('Model ended with tool_calls but supplied no calls');
    if (!text.trim() && !calls.size) throw new Error('Model returned no answer or tool call');
    const ids = new Set();
    // Validate all calls before emitting executable items. Truncated JSON must never execute.
    const completedCalls = [...calls.values()].map(call => {
      if (!call.id || ids.has(call.id)) throw new Error('Missing or duplicate tool call ID');
      ids.add(call.id);
      const tool = definitions.get(call.name);
      if (!tool) throw new Error('Model requested an unknown tool: ' + call.name);
      const args = JSON.parse(call.arguments);
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be a JSON object');
      const common = { id: 'call_' + randomUUID(), call_id: call.id, name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}) };
      if (tool.type === 'tool_search') return { id: common.id, call_id: call.id, type: 'tool_search_call', execution: 'client', status: 'completed', arguments: args };
      if (tool.type === 'custom') {
        if (typeof args.input !== 'string') throw new Error('Custom tool requires an input string');
        return { ...common, type: 'custom_tool_call', input: args.input };
      }
      return { ...common, type: 'function_call', arguments: call.arguments };
    });
    if (message) {
      const part = { type: 'output_text', text, annotations: [] };
      message.status = 'completed'; message.content = [part];
      emit({ type: 'response.output_text.done', item_id: message.id, output_index: 0, content_index: 0, text });
      emit({ type: 'response.content_part.done', item_id: message.id, output_index: 0, content_index: 0, part });
      emit({ type: 'response.output_item.done', output_index: 0, item: message });
    }
    for (const item of completedCalls) {
      const index = output.length;
      if (item.type === 'tool_search_call') {
        emit({ type: 'response.output_item.added', output_index: index, item });
        emit({ type: 'response.output_item.done', output_index: index, item });
        output.push(item);
        continue;
      }
      const field = item.type === 'function_call' ? 'arguments' : 'input';
      const event = item.type === 'function_call' ? 'function_call_arguments' : 'custom_tool_call_input';
      emit({ type: 'response.output_item.added', output_index: index, item: { ...item, [field]: '' } });
      emit({ type: 'response.' + event + '.delta', item_id: item.id, output_index: index, delta: item[field] });
      emit({ type: 'response.' + event + '.done', item_id: item.id, output_index: index, [field]: item[field] });
      emit({ type: 'response.output_item.done', output_index: index, item });
      output.push(item);
    }
    emit({ type: 'response.completed', response: { id: responseId, object: 'response', status: 'completed', model, output, ...(usage ? { usage } : {}) } });
  } catch (error) {
    emit({ type: 'response.failed', response: { id: responseId, object: 'response', status: 'failed', error: { code: error.code || 'adapter_stream_error', message: error.message } } });
  }
}

function startMiniMaxAdapter({ port = 15821, apiKey, upstream = 'https://api.minimaxi.com/v1', onError, timeoutMs = 180000 } = {}) {
  const server = http.createServer(async (req, res) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    res.on('close', () => controller.abort());
    const fail = (status, message) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message } })); };
    try {
      if (req.method !== 'POST' || req.url !== '/v1/responses') { fail(404, 'Not found'); return; }
      if (!apiKey) { fail(401, 'MINIMAX_API_KEY is not set'); return; }
      const buffers = [];
      let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 16 * 1024 * 1024) { fail(413, 'Request too large'); return; } buffers.push(chunk); }
      let converted;
      try { converted = convertRequest(JSON.parse(Buffer.concat(buffers).toString('utf8'))); } catch (error) { fail(400, error.message); return; }
      const upstreamResponse = await fetch(upstream + '/chat/completions', {
        method: 'POST', headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(converted.body), signal: controller.signal
      });
      if (!upstreamResponse.ok) {
        res.writeHead(upstreamResponse.status, { 'content-type': 'application/json' }); res.end(await upstreamResponse.text()); return;
      }
      if (!upstreamResponse.body || !upstreamResponse.headers.get('content-type')?.includes('text/event-stream')) { fail(502, 'MiniMax did not return an SSE stream'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      let sequence = 0;
      await translateStream(upstreamResponse.body, converted.definitions, converted.body.model, value => {
        if (!res.destroyed) res.write('event: ' + value.type + '\ndata: ' + JSON.stringify({ ...value, sequence_number: sequence++ }) + '\n\n');
      });
      res.end();
    } catch {
      if (!res.destroyed && !res.headersSent) fail(502, controller.signal.aborted ? 'MiniMax request timed out or was cancelled' : 'Unable to connect to MiniMax');
      else if (!res.destroyed) res.end();
    } finally { clearTimeout(timer); controller.abort(); }
  });
  server.on('error', error => { if (typeof onError === 'function') onError(error); });
  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = { startMiniMaxAdapter, convertRequest, translateStream };
