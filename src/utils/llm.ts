// utils/llm.ts — 直连 LLM（OpenAI 兼容 / Anthropic / Gemini）
import { getActiveProfile, getProviderPreset, isLocalProvider, type Settings } from './settings';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface CallOptions {
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** 要求模型输出 JSON；仅在你需要解析 JSON 的调用里开启，且 prompt 中必须出现 "json" 字样 */
  json?: boolean;
}

export interface TestConnectionResult {
  ok: boolean;
  latency: number;
  provider: string;
  model: string;
  message: string;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function timeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export function isLlmConfigured(settings: Settings): boolean {
  const preset = getProviderPreset(settings.provider);
  const profile = getActiveProfile(settings);
  if (preset.local) return Boolean(profile.baseUrl);
  if (settings.provider === 'custom') return Boolean(profile.baseUrl && profile.model);
  return Boolean(profile.apiKey.trim() && profile.baseUrl && profile.model);
}

/** 从模型返回的文本里抽出 JSON 对象 */
export function extractJson<T>(text: string): T | null {
  if (!text) return null;
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

async function callOpenAI(
  settings: Settings,
  messages: ChatMessage[],
  options: CallOptions
): Promise<string> {
  const profile = getActiveProfile(settings);
  const preset = getProviderPreset(settings.provider);
  const url = joinUrl(profile.baseUrl, '/chat/completions');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (profile.apiKey.trim()) headers.Authorization = `Bearer ${profile.apiKey.trim()}`;

  const body: Record<string, unknown> = {
    model: profile.model,
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 1200,
  };
  // 只在明确需要 JSON 输出时开启；OpenAI 兼容接口要求 prompt 里必须出现 "json"，
  // 连接测试这类短 prompt 若强行带上会被 400 拒绝。本地模型对 response_format 支持不稳定，也不强制。
  if (options.json && !preset.local && settings.provider !== 'custom') {
    body.response_format = { type: 'json_object' };
  }

  const send = async (payload: Record<string, unknown>) => {
    const { signal, clear } = timeoutSignal(options.timeoutMs ?? 60000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal,
      });
      const raw = await res.text();
      return { res, raw };
    } finally {
      clear();
    }
  };

  let { res, raw } = await send(body);
  // 部分兼容接口不支持 response_format：400 时去掉该字段重试一次。
  if (!res.ok && body.response_format && res.status === 400) {
    const retryBody = { ...body };
    delete retryBody.response_format;
    ({ res, raw } = await send(retryBody));
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${raw.slice(0, 200)}`);
  }
  const data = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function callAnthropic(
  settings: Settings,
  messages: ChatMessage[],
  options: CallOptions
): Promise<string> {
  const profile = getActiveProfile(settings);
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const chatMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

  const { signal, clear } = timeoutSignal(options.timeoutMs ?? 60000);
  try {
    const res = await fetch(joinUrl(profile.baseUrl, '/v1/messages'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': profile.apiKey.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: profile.model,
        max_tokens: options.maxTokens ?? 1200,
        temperature: options.temperature ?? 0.3,
        system: system || undefined,
        messages: chatMessages,
      }),
      signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}: ${raw.slice(0, 200)}`);
    }
    const data = JSON.parse(raw) as { content?: Array<{ type: string; text?: string }> };
    return (data.content || [])
      .filter((part) => part.type === 'text')
      .map((part) => part.text || '')
      .join('')
      .trim();
  } finally {
    clear();
  }
}

async function callGemini(
  settings: Settings,
  messages: ChatMessage[],
  options: CallOptions
): Promise<string> {
  const profile = getActiveProfile(settings);
  const model = profile.model.replace(/^models\//, '');
  const url = joinUrl(
    profile.baseUrl,
    `/v1beta/models/${encodeURIComponent(model)}:generateContent`
  ) + (profile.apiKey.trim() ? `?key=${encodeURIComponent(profile.apiKey.trim())}` : '');

  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const { signal, clear } = timeoutSignal(options.timeoutMs ?? 60000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents,
        generationConfig: {
          temperature: options.temperature ?? 0.3,
          maxOutputTokens: options.maxTokens ?? 1200,
          responseMimeType: 'application/json',
        },
      }),
      signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}: ${raw.slice(0, 200)}`);
    }
    const data = JSON.parse(raw) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return (data.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text || '')
      .join('')
      .trim();
  } finally {
    clear();
  }
}

export async function callLLM(
  settings: Settings,
  messages: ChatMessage[],
  options: CallOptions = {}
): Promise<string> {
  const preset = getProviderPreset(settings.provider);
  if (preset.protocol === 'anthropic') return callAnthropic(settings, messages, options);
  if (preset.protocol === 'gemini') return callGemini(settings, messages, options);
  return callOpenAI(settings, messages, options);
}

export async function testConnection(settings: Settings): Promise<TestConnectionResult> {
  const preset = getProviderPreset(settings.provider);
  const profile = getActiveProfile(settings);
  const started = Date.now();

  if (!preset.local && settings.provider !== 'custom' && !profile.apiKey.trim()) {
    return {
      ok: false,
      latency: 0,
      provider: preset.label,
      model: profile.model,
      message: '请先填写 API Key',
    };
  }
  if (!profile.baseUrl || !profile.model) {
    return {
      ok: false,
      latency: 0,
      provider: preset.label,
      model: profile.model,
      message: '请先填写 Base URL 和 Model',
    };
  }

  try {
    const reply = await callLLM(
      settings,
      [
        { role: 'system', content: 'You are a connection test. Reply with the single word: pong.' },
        { role: 'user', content: 'ping' },
      ],
      { maxTokens: 32, temperature: 0, timeoutMs: 30000 }
    );
    return {
      ok: true,
      latency: Date.now() - started,
      provider: preset.label,
      model: profile.model,
      message: reply ? `连接成功：${reply.slice(0, 80)}` : '连接成功（空响应）',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      latency: Date.now() - started,
      provider: preset.label,
      model: profile.model,
      message: `连接失败：${message}`,
    };
  }
}

export function providerHint(settings: Settings): string {
  const preset = getProviderPreset(settings.provider);
  if (isLocalProvider(settings.provider)) return '本地推理，数据完全不出本机';
  if (preset.id === 'custom') return '兼容 OpenAI /chat/completions 协议';
  return preset.note || 'API Key 仅保存在本机浏览器';
}
