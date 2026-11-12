import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchArxivCandidates,
  fetchHNCandidates,
  fetchRssCandidates,
  fetchSourceCandidates,
  fetchTopicCandidates,
  makeAutoSource,
} from '../src/utils/sources';

const HN_JSON = {
  hits: [
    {
      objectID: '1',
      title: 'Rust 所有权模型详解',
      url: 'https://example.com/rust',
      points: 120,
      created_at: '2026-10-30T08:00:00Z',
      story_text: '<p>深入理解 <b>borrow checker</b></p>',
    },
    {
      objectID: '2',
      title: 'Ask HN: 如何学习分布式系统？',
      points: 30,
      created_at: '2026-10-31T08:00:00Z',
    },
    { objectID: '3', title: '', url: 'https://example.com/empty' },
  ],
};

const ARXIV_XML = `<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Scaling Laws for &lt;b&gt;Agents&lt;/b&gt;</title>
    <summary>A study of agent scaling.</summary>
    <id>http://arxiv.org/abs/2611.00001v1</id>
    <published>2026-10-29T00:00:00Z</published>
  </entry>
  <entry>
    <title>Untitled entry</title>
    <summary>Second</summary>
    <id>https://arxiv.org/abs/2611.00002v1</id>
  </entry>
</feed>`;

const RSS2_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[理解 Raft 共识算法]]></title>
    <link>https://example.com/raft</link>
    <description><![CDATA[<p>共识算法导论 &amp; 实践</p>]]></description>
    <pubDate>Mon, 02 Nov 2026 00:00:00 GMT</pubDate>
  </item>
  <item>
    <title>第二篇文章</title>
    <link>https://example.com/second</link>
    <description>摘要</description>
  </item>
</channel></rss>`;

const ATOM_XML = `<feed><entry>
  <title>Vue 组件设计</title>
  <link rel="alternate" href="https://example.com/vue" />
  <summary>组件状态与组合式 API</summary>
  <updated>2026-11-01T00:00:00Z</updated>
</entry></feed>`;

function mockFetch(routes: Record<string, string | Error | { status: number }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      for (const [key, value] of Object.entries(routes)) {
        if (url.includes(key)) {
          if (value instanceof Error) throw value;
          if (typeof value === 'string') return new Response(value, { status: 200 });
          return new Response('server error', { status: value.status });
        }
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Hacker News 候选', () => {
  it('首页候选包含 URL 兜底的 Ask HN，并过滤空标题', async () => {
    mockFetch({ 'hn.algolia.com': JSON.stringify(HN_JSON) });
    const list = await fetchHNCandidates();
    expect(list).toHaveLength(2);
    expect(list[0].url).toBe('https://example.com/rust');
    expect(list[1].url).toBe('https://news.ycombinator.com/item?id=2');
    expect(list[1].source).toBe('Hacker News');
    expect(list[0].excerpt).toContain('borrow checker');
    expect(list[0].score).toBe(120);
  });

  it('带 query 时标记来源为 HN · query', async () => {
    mockFetch({ 'hn.algolia.com': JSON.stringify(HN_JSON) });
    const list = await fetchHNCandidates('distributed systems');
    expect(list[0].source).toBe('HN · distributed systems');
  });

  it('上游返回 500 时报错，便于上层降级', async () => {
    mockFetch({ 'hn.algolia.com': { status: 500 } });
    await expect(fetchHNCandidates()).rejects.toThrow('500');
  });
});

describe('arXiv 候选', () => {
  it('解析 Atom entry、去除 HTML 并把 http 转为 https', async () => {
    mockFetch({ 'export.arxiv.org': ARXIV_XML });
    const list = await fetchArxivCandidates('cat:cs.AI');
    expect(list).toHaveLength(2);
    expect(list[0].title).toBe('Scaling Laws for Agents');
    expect(list[0].url).toBe('https://arxiv.org/abs/2611.00001v1');
    expect(list[0].source).toBe('arXiv');
    expect(list[0].publishedAt).toBe(Date.parse('2026-10-29T00:00:00Z'));
  });
});

describe('RSS / Atom 候选', () => {
  it('解析 RSS 2.0 的 CDATA、实体与发布时间', async () => {
    mockFetch({ 'feed.test/rss': RSS2_XML });
    const list = await fetchRssCandidates('https://feed.test/rss', '示例源');
    expect(list).toHaveLength(2);
    expect(list[0].title).toBe('理解 Raft 共识算法');
    expect(list[0].url).toBe('https://example.com/raft');
    expect(list[0].excerpt).toContain('共识算法导论 & 实践');
    expect(list[0].source).toBe('示例源');
    expect(list[0].publishedAt).toBe(Date.parse('Mon, 02 Nov 2026 00:00:00 GMT'));
    expect(list[1].publishedAt).toBeUndefined();
  });

  it('解析 Atom 的 link href', async () => {
    mockFetch({ 'feed.test/atom': ATOM_XML });
    const list = await fetchRssCandidates('https://feed.test/atom', 'Atom 源');
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe('https://example.com/vue');
    expect(list[0].excerpt).toContain('组合式 API');
  });
});

describe('组合与分发', () => {
  it('主题搜索合并 HN 与 arXiv，单源失败不影响整体', async () => {
    mockFetch({
      'hn.algolia.com': JSON.stringify(HN_JSON),
      'export.arxiv.org': new Error('network down'),
    });
    const list = await fetchTopicCandidates('rust');
    expect(list.length).toBe(2);
  });

  it('fetchSourceCandidates 按类型分发，缺字段时返回空数组', async () => {
    mockFetch({
      'hn.algolia.com': JSON.stringify(HN_JSON),
      'feed.test/rss': RSS2_XML,
      'export.arxiv.org': ARXIV_XML,
    });
    expect(await fetchSourceCandidates({ type: 'hn', name: 'HN', enabled: true, addedAt: 0 })).toHaveLength(2);
    expect(
      await fetchSourceCandidates({
        type: 'rss',
        name: 'RSS',
        url: 'https://feed.test/rss',
        enabled: true,
        addedAt: 0,
      })
    ).toHaveLength(2);
    expect(
      await fetchSourceCandidates({
        type: 'rss',
        name: 'RSS',
        enabled: true,
        addedAt: 0,
      })
    ).toEqual([]);
    expect(
      await fetchSourceCandidates({ type: 'arxiv', name: 'arXiv', query: 'cat:cs.AI', enabled: true, addedAt: 0 })
    ).toHaveLength(2);
    expect(await fetchSourceCandidates({ type: 'topic', name: 'T', enabled: true, addedAt: 0 })).toEqual([]);
    expect(await fetchSourceCandidates({ type: 'llm_search', name: 'L', query: 'rust', enabled: true, addedAt: 0 }).then((r) => r.length)).toBe(4);
  });

  it('自动发现来源的字段正确', () => {
    const source = makeAutoSource('https://blog.test/feed.xml', 'blog.test');
    expect(source.type).toBe('auto_discovered');
    expect(source.name).toBe('blog.test RSS');
    expect(source.url).toBe('https://blog.test/feed.xml');
    expect(source.enabled).toBe(true);
    expect(source.autoDetected).toBe(true);
    expect(source.host).toBe('blog.test');
  });
});
