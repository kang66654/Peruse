import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

const RSS_XML = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item>
    <title>理解 Raft 共识算法</title>
    <link>https://example.com/raft</link>
    <description>分布式系统共识算法导论</description>
    <pubDate>Mon, 02 Nov 2026 00:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Vue 3 组件状态设计</title>
    <link>https://example.com/vue-state</link>
    <description>组合式 API 与状态管理</description>
  </item>
  <item>
    <title>向量数据库入门</title>
    <link>https://example.com/vector-db</link>
    <description>embedding 检索实践</description>
  </item>
  <item>
    <title>同一天重复推送测试</title>
    <link>https://example.com/already-pushed</link>
    <description>这篇会被历史 digest 过滤</description>
  </item>
</channel></rss>`;

const HN_JSON = {
  hits: [
    {
      objectID: '1',
      title: '分布式共识的另一条路径',
      url: 'https://example.com/hn-consensus',
      points: 50,
      created_at: '2026-11-01T00:00:00Z',
    },
  ],
};

async function loadAll() {
  vi.resetModules();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  const db = await import('../src/utils/db');
  const settings = await import('../src/utils/settings');
  const digest = await import('../src/utils/digest');
  const status = await import('../src/utils/status');
  return { db, settings, digest, status };
}

type Modules = Awaited<ReturnType<typeof loadAll>>;

async function prepare(modules: Modules, options: { llm: boolean }) {
  const { db, settings } = modules;
  const defaults = settings.defaultSettings();
  const base = options.llm
    ? await settings.saveSettings({
        provider: 'deepseek',
        interests: ['共识算法'],
        digestCount: 3,
        profiles: {
          ...defaults.profiles,
          deepseek: { ...defaults.profiles.deepseek, apiKey: 'sk-test' },
        },
      })
    : await settings.saveSettings({ interests: ['共识算法'], digestCount: 3 });
  expect(base.provider).toBe(options.llm ? 'deepseek' : 'openai');

  await db.saveSource({
    type: 'rss',
    name: '示例订阅',
    url: 'https://feed.test/rss',
    enabled: true,
    addedAt: Date.now(),
  });
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 });
}

function mockNetwork(mode: 'llm' | 'rules' | 'offline') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (mode === 'offline') throw new Error('network down');
      const url = String(input);
      if (url.includes('feed.test/rss')) return new Response(RSS_XML, { status: 200 });
      if (url.includes('hn.algolia.com')) return jsonResponse(HN_JSON);
      if (url.includes('export.arxiv.org')) return new Response('<feed></feed>', { status: 200 });
      if (url.includes('/chat/completions')) {
        const body = JSON.parse(String(init?.body || '{}'));
        const messages = JSON.stringify(body.messages);
        if (messages.includes('search queries')) {
          return jsonResponse({
            choices: [{ message: { content: '{"queries":["raft consensus","vector database"]}' } }],
          });
        }
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  picks: [
                    { index: 0, reason: '与你最近阅读的分布式主题强相关。', estimatedMinutes: 6 },
                    { index: 2, reason: '换换口味，看看检索基础设施。', estimatedMinutes: 4 },
                  ],
                }),
              },
            },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('generateDigest', () => {
  it('LLM 路径：生成候选、排序、持久化 digest、写入状态并发通知', async () => {
    const modules = await loadAll();
    await prepare(modules, { llm: true });
    mockNetwork('llm');

    const result = await modules.digest.generateDigest();
    expect(result.ok).toBe(true);
    expect(result.digest?.picks).toHaveLength(2);
    expect(result.digest?.fallback).toBe(false);
    expect(result.digest?.provider).toBe('DeepSeek');
    expect(result.digest?.model).toBe('deepseek-chat');
    expect(typeof result.digest?.id).toBe('number');

    const stored = await modules.db.getDigestByDate(result.digest!.date);
    expect(stored?.picks[0].status).toBe('unread');
    expect(stored?.picks[0].source).toBe('示例订阅');

    const status = await modules.status.getDigestStatus();
    expect(status.state).toBe('done');
    expect(status.pickCount).toBe(2);

    expect(modules.digest.isDigestRunning()).toBe(false);
    expect((chrome.notifications.create as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('未配置模型时走规则推荐，并在状态里标记 fallback', async () => {
    const modules = await loadAll();
    await prepare(modules, { llm: false });
    mockNetwork('rules');

    const result = await modules.digest.generateDigest();
    expect(result.ok).toBe(true);
    expect(result.digest?.fallback).toBe(true);
    expect(result.digest?.provider).toBe('规则推荐');
    expect(result.digest?.model).toBe('keyword-match');
    expect(result.digest!.picks.length).toBeGreaterThan(0);
    expect(result.digest!.picks.every((pick) => pick.status === 'unread')).toBe(true);

    const status = await modules.status.getDigestStatus();
    expect(status.fallback).toBe(true);
    expect(status.message).toContain('规则推荐');
  });

  it('当天已存在 digest 时复用同一个 id，不产生重复记录', async () => {
    const modules = await loadAll();
    await prepare(modules, { llm: true });
    mockNetwork('llm');

    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate()
    ).padStart(2, '0')}`;
    await modules.db.dbPut('digests', {
      date,
      picks: [
        {
          url: 'https://example.com/already-pushed',
          title: '同一天重复推送测试',
          source: '示例订阅',
          reason: '历史推荐',
          estimatedMinutes: 3,
          status: 'read',
        },
      ],
      createdAt: Date.now(),
      provider: '规则推荐',
      model: 'keyword-match',
      sourceCount: 1,
      fallback: true,
    });

    const result = await modules.digest.generateDigest();
    expect(result.ok).toBe(true);

    const all = await modules.db.dbGetAll<{ id: number; date: string }>('digests');
    expect(all.filter((d) => d.date === date)).toHaveLength(1);
    expect((await modules.db.getDigestByDate(date))?.picks.length).toBe(2);
  });

  it('候选池为空时返回失败并写入 error 状态', async () => {
    const modules = await loadAll();
    await prepare(modules, { llm: false });
    mockNetwork('offline');

    const result = await modules.digest.generateDigest();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('候选池为空');
    expect((await modules.status.getDigestStatus()).state).toBe('error');
  });

  it('生成中再次调用会返回 alreadyRunning', async () => {
    const modules = await loadAll();
    await prepare(modules, { llm: true });
    mockNetwork('llm');

    const first = modules.digest.generateDigest();
    const second = await modules.digest.generateDigest();
    expect(second.alreadyRunning).toBe(true);
    expect(second.ok).toBe(false);
    await first;
  });
});

describe('dismissPick', () => {
  it('写入负反馈并把推荐项标记为 dismissed', async () => {
    const modules = await loadAll();
    const digest = {
      date: '2026-11-02',
      picks: [
        {
          url: 'https://example.com/raft?utm_source=feed',
          title: 'Raft',
          source: '示例订阅',
          reason: 'r',
          estimatedMinutes: 5,
          status: 'unread' as const,
        },
      ],
      createdAt: Date.now(),
      provider: 'DeepSeek',
      model: 'deepseek-chat',
      sourceCount: 3,
      fallback: false,
    };
    await modules.db.dbPut('digests', digest);
    const stored = (await modules.db.getDigestByDate('2026-11-02'))!;

    const updated = await modules.digest.dismissPick(stored, stored.picks[0], 'already_read');
    expect(updated.picks[0].status).toBe('dismissed');

    const saved = await modules.db.getDigestByDate('2026-11-02');
    expect(saved?.picks[0].status).toBe('dismissed');

    const negative = await modules.db.dbGetAll<{ url: string; reason: string }>('negative');
    expect(negative).toHaveLength(1);
    expect(negative[0].url).toBe('https://example.com/raft');
    expect(negative[0].reason).toBe('already_read');
  });
});
