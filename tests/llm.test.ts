import { afterEach, describe, expect, it, vi } from 'vitest';
import { callLLM, extractJson, isLlmConfigured, testConnection } from '../src/utils/llm';
import { defaultSettings, type ProviderId, type ProviderProfile, type Settings } from '../src/utils/settings';

function makeSettings(provider: ProviderId, patch: Partial<ProviderProfile> = {}): Settings {
  const settings = defaultSettings();
  settings.provider = provider;
  settings.profiles[provider] = { ...settings.profiles[provider], ...patch };
  return settings;
}

function mockFetchOnce(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init || {}));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('extractJson', () => {
  it('兼容纯 JSON、代码块、夹带说明文字与非法输入', () => {
    expect(extractJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson<{ a: number }>('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson<{ a: number }>('好的，结果如下：{"a":3} 希望有帮助')).toEqual({ a: 3 });
    expect(extractJson('not json')).toBeNull();
    expect(extractJson('')).toBeNull();
  });
});

describe('isLlmConfigured', () => {
  it('云端 Provider 需要 Key，本地 Provider 只需要 Base URL，custom 需要 Base URL + Model', () => {
    expect(isLlmConfigured(makeSettings('openai'))).toBe(false);
    expect(isLlmConfigured(makeSettings('openai', { apiKey: 'sk-test' }))).toBe(true);
    expect(isLlmConfigured(makeSettings('ollama'))).toBe(true);
    expect(isLlmConfigured(makeSettings('custom', { baseUrl: '', model: '' }))).toBe(false);
    expect(isLlmConfigured(makeSettings('custom', { baseUrl: 'http://localhost:8000', model: 'm' }))).toBe(true);
  });
});

describe('OpenAI 兼容协议', () => {
  it('默认不带 response_format，拼接正确的 URL 与 Header', async () => {
    const fetchMock = mockFetchOnce(() =>
      new Response(JSON.stringify({ choices: [{ message: { content: ' pong ' } }] }), { status: 200 })
    );
    const settings = makeSettings('deepseek', { apiKey: 'sk-test' });
    const text = await callLLM(settings, [{ role: 'user', content: 'ping' }], { maxTokens: 10 });

    expect(text).toBe('pong');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe('deepseek-chat');
    expect(body.max_tokens).toBe(10);
    expect(body.response_format).toBeUndefined();
  });

  it('json: true 时才注入 response_format', async () => {
    const fetchMock = mockFetchOnce(() =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 })
    );
    await callLLM(makeSettings('openai', { apiKey: 'sk-test' }), [{ role: 'user', content: 'return json' }], {
      json: true,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('400 且带 response_format 时自动去掉字段重试一次', async () => {
    const fetchMock = mockFetchOnce((_url, init) => {
      const body = JSON.parse(init.body as string);
      if (body.response_format) {
        return new Response(
          JSON.stringify({ error: { message: "Prompt must contain the word 'json'" } }),
          { status: 400, statusText: 'Bad Request' }
        );
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok-without-format' } }] }), {
        status: 200,
      });
    });

    const text = await callLLM(
      makeSettings('openai', { apiKey: 'sk-test' }),
      [{ role: 'user', content: 'Return JSON: {"a":1}' }],
      { json: true }
    );
    expect(text).toBe('ok-without-format');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string).response_format).toBeUndefined();
  });

  it('非 400 错误直接抛出并保留响应片段', async () => {
    mockFetchOnce(
      () => new Response('rate limited', { status: 429, statusText: 'Too Many Requests' })
    );
    await expect(
      callLLM(makeSettings('openai', { apiKey: 'sk-test' }), [{ role: 'user', content: 'hi' }])
    ).rejects.toThrow('429');
  });
});

describe('Anthropic 协议', () => {
  it('拆分 system、使用 x-api-key 并拼接 text block', async () => {
    const fetchMock = mockFetchOnce(() =>
      new Response(
        JSON.stringify({ content: [{ type: 'text', text: 'Hello' }, { type: 'text', text: ' World' }] }),
        { status: 200 }
      )
    );
    const settings = makeSettings('anthropic', { apiKey: 'sk-ant' });
    const text = await callLLM(settings, [
      { role: 'system', content: 'You are Peruse.' },
      { role: 'user', content: 'hi' },
    ]);

    expect(text).toBe('Hello World');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/messages');
    const headers = init!.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init!.body as string);
    expect(body.system).toBe('You are Peruse.');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.response_format).toBeUndefined();
  });
});

describe('Gemini 协议', () => {
  it('URL 携带 key，使用 generateContent 结构并解析 parts', async () => {
    const fetchMock = mockFetchOnce(() =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Gemini OK' }] } }] }), {
        status: 200,
      })
    );
    const settings = makeSettings('gemini', { apiKey: 'gm-key', model: 'models/gemini-2.0-flash' });
    const text = await callLLM(settings, [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }]);

    expect(text).toBe('Gemini OK');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1beta/models/gemini-2.0-flash:generateContent?key=gm-key');
    const body = JSON.parse(init!.body as string);
    expect(body.systemInstruction.parts[0].text).toBe('sys');
    expect(body.contents[0].role).toBe('user');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });
});

describe('testConnection', () => {
  it('缺少 Key 时不发请求并提示', async () => {
    const result = await testConnection(makeSettings('openai'));
    expect(result.ok).toBe(false);
    expect(result.message).toBe('请先填写 API Key');
  });

  it('本地 Provider 可以不带 Key 直接测试', async () => {
    mockFetchOnce(() =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }), { status: 200 })
    );
    const result = await testConnection(makeSettings('ollama'));
    expect(result.ok).toBe(true);
    expect(result.message).toContain('连接成功');
    expect(result.latency).toBeGreaterThanOrEqual(0);
  });

  it('请求失败时返回可读错误', async () => {
    mockFetchOnce(
      () => new Response('{"error":{"message":"invalid key"}}', { status: 401, statusText: 'Unauthorized' })
    );
    const result = await testConnection(makeSettings('deepseek', { apiKey: 'bad-key' }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain('401');
    expect(result.message).toContain('连接失败');
  });
});
