import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { Article, ArticleInput, Digest, NegativeItem } from '../src/utils/db';
import type { ReadingSignals } from '../src/utils/reading';

async function loadDb() {
  vi.resetModules();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  return import('../src/utils/db');
}

function makeArticle(overrides: Partial<Article> & { url: string }): Article {
  const now = Date.now();
  return {
    title: 'Article',
    host: 'example.com',
    visibleTime: 120,
    lastSessionSec: 120,
    scrollDepth: 0.6,
    readingScore: 0.7,
    wordCount: 1200,
    excerpt: 'some excerpt',
    readAt: now,
    starred: false,
    archived: false,
    falsePositive: false,
    layer: 'hot',
    visitCount: 1,
    ...overrides,
  };
}

function makeInput(overrides: Partial<ArticleInput> = {}): ArticleInput {
  return {
    url: 'https://example.com/post?utm_source=test#section',
    title: 'Example Post',
    host: 'example.com',
    visibleTime: 30,
    scrollDepth: 0.4,
    readingScore: 0.6,
    wordCount: 900,
    readAt: Date.now(),
    sessionId: 'session-1',
    ...overrides,
  };
}

describe('db 基础 CRUD', () => {
  it('put / get / getAll / count / delete / clear 正常工作', async () => {
    const db = await loadDb();
    await db.dbPut('settings', { key: 'a', value: 1 });
    expect(await db.dbGet('settings', 'a')).toEqual({ key: 'a', value: 1 });
    expect(await db.dbCount('settings')).toBe(1);

    await db.dbPut('settings', { key: 'b', value: 2 });
    expect((await db.dbGetAll<{ key: string }>('settings')).map((s) => s.key).sort()).toEqual(['a', 'b']);

    await db.dbDelete('settings', 'a');
    expect(await db.dbCount('settings')).toBe(1);

    await db.dbClear('settings');
    expect(await db.dbCount('settings')).toBe(0);
  });
});

describe('URL 归一化', () => {
  it('去掉 hash 与跟踪参数，保留有效参数', async () => {
    const db = await loadDb();
    expect(db.normalizeUrl('https://Example.com/a?utm_source=x&b=2&ref=hn#top')).toBe(
      'https://example.com/a?b=2'
    );
    expect(db.normalizeUrl('not a url')).toBe('not a url');
    expect(db.sameOriginPath('https://example.com/a/b?x=1')).toBe('https://example.com/a/b');
  });
});

describe('阅读记录合并', () => {
  it('新文章写入默认字段', async () => {
    const db = await loadDb();
    const article = await db.mergeArticleRecord(makeInput());
    expect(article.url).toBe('https://example.com/post');
    expect(article.layer).toBe('hot');
    expect(article.visitCount).toBe(1);
    expect(article.lastSessionSec).toBe(30);
    expect(article.falsePositive).toBe(false);
    expect(article.starred).toBe(false);
  });

  it('同一 session 重复上报不重复累加', async () => {
    const db = await loadDb();
    await db.mergeArticleRecord(makeInput({ visibleTime: 30 }));
    const merged = await db.mergeArticleRecord(makeInput({ visibleTime: 45, scrollDepth: 0.8 }));
    expect(merged.visibleTime).toBe(45);
    expect(merged.visitCount).toBe(1);
    expect(merged.scrollDepth).toBe(0.8);
  });

  it('新 session 累加时长并增加访问次数', async () => {
    const db = await loadDb();
    await db.mergeArticleRecord(makeInput({ visibleTime: 45 }));
    const merged = await db.mergeArticleRecord(
      makeInput({ visibleTime: 20, sessionId: 'session-2', scrollDepth: 0.2, readingScore: 0.9 })
    );
    expect(merged.visibleTime).toBe(65);
    expect(merged.visitCount).toBe(2);
    expect(merged.lastSessionSec).toBe(20);
    expect(merged.scrollDepth).toBe(0.4);
    expect(merged.readingScore).toBe(0.9);
  });

  it('已标记的收藏与误读不会被覆盖', async () => {
    const db = await loadDb();
    await db.mergeArticleRecord(makeInput({ starred: true }));
    const merged = await db.mergeArticleRecord(makeInput({ sessionId: 'session-2' }));
    expect(merged.starred).toBe(true);
  });

  it('按时间过滤与删除单条记录', async () => {
    const db = await loadDb();
    const now = Date.now();
    await db.dbPut('articles', makeArticle({ url: 'https://a.test/1', readAt: now }));
    await db.dbPut('articles', makeArticle({ url: 'https://a.test/2', readAt: now - 10 * 86400000 }));

    expect(await db.getArticlesSince(now - 86400000)).toHaveLength(1);
    expect((await db.getAllArticles())[0].readAt).toBeGreaterThanOrEqual(
      (await db.getAllArticles())[1].readAt
    );

    await db.deleteArticle('https://a.test/1?utm_source=x');
    expect(await db.dbCount('articles')).toBe(1);
  });
});

describe('4 层存储降级', () => {
  it('按时间迁移层级并裁剪正文，收藏永不处理', async () => {
    const db = await loadDb();
    const day = 86400000;
    const now = Date.now();
    await db.dbPut('articles', makeArticle({ url: 'https://a.test/hot', readAt: now - day }));
    await db.dbPut(
      'articles',
      makeArticle({ url: 'https://a.test/warm-short', readAt: now - 40 * day, visibleTime: 60 })
    );
    await db.dbPut(
      'articles',
      makeArticle({ url: 'https://a.test/warm-long', readAt: now - 40 * day, visibleTime: 300 })
    );
    await db.dbPut('articles', makeArticle({ url: 'https://a.test/cold', readAt: now - 100 * day }));
    await db.dbPut(
      'articles',
      makeArticle({ url: 'https://a.test/starred', readAt: now - 200 * day, starred: true })
    );

    const { migrated } = await db.pruneOldArticles();
    expect(migrated).toBe(3);

    const all = await db.getAllArticles();
    const byUrl = new Map(all.map((a) => [a.url, a]));
    expect(byUrl.get('https://a.test/hot')?.layer).toBe('hot');
    expect(byUrl.get('https://a.test/hot')?.excerpt).toBe('some excerpt');
    expect(byUrl.get('https://a.test/warm-short')?.layer).toBe('warm');
    expect(byUrl.get('https://a.test/warm-short')?.excerpt).toBe('');
    expect(byUrl.get('https://a.test/warm-long')?.excerpt).toBe('some excerpt');
    expect(byUrl.get('https://a.test/cold')?.layer).toBe('cold');
    expect(byUrl.get('https://a.test/cold')?.excerpt).toBe('');
    expect(byUrl.get('https://a.test/starred')?.layer).toBe('hot');
    expect(byUrl.get('https://a.test/starred')?.excerpt).toBe('some excerpt');
  });
});

describe('每日推荐', () => {
  it('不含 id 的 digest 可以写入并自动获得 key（回归：keyPath undefined 报错）', async () => {
    const db = await loadDb();
    const digest = {
      date: '2026-11-02',
      picks: [],
      createdAt: Date.now(),
      provider: 'DeepSeek',
      model: 'deepseek-chat',
      sourceCount: 3,
      fallback: false,
    } satisfies Omit<Digest, 'id'>;

    await expect(db.dbPut('digests', digest)).resolves.toBe(1);

    const stored = (await db.dbGetAll<Digest>('digests'))[0];
    expect(stored.id).toBe(1);
  });

  it('按日期取最新、取最近 digest、按 id 覆盖更新', async () => {
    const db = await loadDb();
    const now = Date.now();
    const first: Omit<Digest, 'id'> = {
      date: '2026-11-01',
      picks: [],
      createdAt: now - 86400000,
      provider: '规则推荐',
      model: 'keyword-match',
      sourceCount: 1,
      fallback: true,
    };
    const second: Omit<Digest, 'id'> = {
      date: '2026-11-02',
      picks: [],
      createdAt: now,
      provider: 'DeepSeek',
      model: 'deepseek-chat',
      sourceCount: 2,
      fallback: false,
    };
    const old: Omit<Digest, 'id'> = { ...first, date: '2026-08-01', createdAt: now - 100 * 86400000 };
    await db.dbPut('digests', first);
    await db.dbPut('digests', second);
    await db.dbPut('digests', old);

    expect((await db.getLatestDigest())?.date).toBe('2026-11-02');
    expect((await db.getDigestByDate('2026-11-01'))?.date).toBe('2026-11-01');
    expect(await db.getDigestByDate('2026-10-01')).toBeUndefined();
    expect(await db.getRecentDigests(30)).toHaveLength(2);

    const current = await db.getDigestByDate('2026-11-02');
    current!.picks = [
      { url: 'https://a.test/1', title: 'A', source: 'RSS', reason: 'r', estimatedMinutes: 5, status: 'read' },
    ];
    await db.updateDigest(current!);
    expect((await db.getDigestByDate('2026-11-02'))?.picks[0].status).toBe('read');
  });
});

describe('负反馈与文章来源', () => {
  it('负反馈写入时会归一化 URL', async () => {
    const db = await loadDb();
    const item: NegativeItem = {
      url: 'https://a.test/x?utm_source=feed#top',
      title: 'X',
      reason: 'not_interested',
      createdAt: Date.now(),
    };
    await db.addNegative(item);
    expect((await db.dbGetAll<NegativeItem>('negative'))[0].url).toBe('https://a.test/x');
  });

  it('默认来源只播种一次，保存/删除来源正常', async () => {
    const db = await loadDb();
    await db.seedDefaultSources();
    const seeded = await db.getSources();
    expect(seeded.length).toBe(3);
    expect(seeded.map((s) => s.type)).toEqual(['hn', 'arxiv', 'rss']);

    await db.seedDefaultSources();
    expect(await db.dbCount('sources')).toBe(3);

    const id = await db.saveSource({
      type: 'rss',
      name: 'My Feed',
      url: 'https://my.test/rss',
      enabled: true,
      addedAt: Date.now(),
    });
    expect(id).toBeGreaterThan(3);
    expect((await db.getSources()).find((s) => s.id === id)?.name).toBe('My Feed');

    await db.deleteSource(id);
    expect((await db.getSources()).some((s) => s.id === id)).toBe(false);
  });
});

describe('阅读行为会话', () => {
  function makeSession(
    overrides: Partial<ReadingSignals> & { sessionId: string; url: string }
  ): ReadingSignals {
    const startedAt = overrides.startedAt ?? Date.now();
    return {
      visibleSec: 60,
      hiddenSec: 5,
      idleSec: 0,
      editingSec: 0,
      maxDepth: 0.8,
      scrollEvents: 12,
      scrollDistancePx: 2400,
      avgScrollSpeed: 300,
      maxScrollSpeed: 900,
      directionChanges: 2,
      pauseCount: 4,
      avgPauseSec: 8,
      mouseMoves: 40,
      clicks: 2,
      keyPresses: 5,
      selectionCount: 1,
      selectedChars: 90,
      copyCount: 1,
      visibilityChanges: 1,
      focusLossCount: 1,
      wordCount: 1200,
      timeline: [{ t: 0, depth: 0 }, { t: 30, depth: 0.8 }],
      title: 'Example',
      host: 'example.com',
      startedAt,
      endedAt: startedAt + 65_000,
      estimatedReadSec: 240,
      engagementScore: 0.74,
      verdict: 'deep',
      reasons: ['滚动到 80%'],
      pageKind: 'article',
      pageConfidence: 0.9,
      qualified: true,
      ...overrides,
    };
  }

  it('写入会话按 sessionId 覆盖，并按 URL 查询、按时间排序', async () => {
    const db = await loadDb();
    const now = Date.now();
    await db.saveReadingSession(
      makeSession({ sessionId: 's1', url: 'https://a.test/x?utm_source=feed#top', startedAt: now - 50_000 })
    );
    await db.saveReadingSession(
      makeSession({ sessionId: 's2', url: 'https://a.test/x', startedAt: now, visibleSec: 30 })
    );

    expect(await db.dbCount('sessions')).toBe(2);
    const sessions = await db.getSessionsByUrl('https://a.test/x');
    expect(sessions.map((s) => s.sessionId)).toEqual(['s2', 's1']);
    expect(sessions[1].url).toBe('https://a.test/x');
    expect(sessions[0].visibleSec).toBe(30);

    // 同一会话重复上报只保留一条
    await db.saveReadingSession(
      makeSession({ sessionId: 's2', url: 'https://a.test/x', startedAt: now, visibleSec: 45 })
    );
    expect(await db.getSessionsByUrl('https://a.test/x')).toHaveLength(2);
    expect((await db.getSessionsByUrl('https://a.test/x'))[0].visibleSec).toBe(45);

    expect((await db.getRecentSessions(7)).length).toBe(2);
    expect((await db.getRecentSessions(1)).length).toBe(2);
  });

  it('pruneOldSessions 只清理过期会话', async () => {
    const db = await loadDb();
    const day = 86_400_000;
    await db.saveReadingSession(
      makeSession({ sessionId: 'old', url: 'https://a.test/old', startedAt: Date.now() - 100 * day })
    );
    await db.saveReadingSession(
      makeSession({ sessionId: 'new', url: 'https://a.test/new', startedAt: Date.now() })
    );

    expect(await db.pruneOldSessions(90)).toBe(1);
    expect(await db.dbCount('sessions')).toBe(1);
    expect((await db.getAllSessions())[0].sessionId).toBe('new');
  });

  it('pruneOldArticles 同时清理过期会话并返回数量', async () => {
    const db = await loadDb();
    await db.saveReadingSession(
      makeSession({
        sessionId: 'old',
        url: 'https://a.test/old',
        startedAt: Date.now() - 100 * 86_400_000,
      })
    );
    const result = await db.pruneOldArticles();
    expect(result.sessionsPruned).toBe(1);
    expect(result.migrated).toBe(0);
  });

  it('文章上的行为摘要与判定字段随记录合并保存，且不会被后续空值覆盖', async () => {
    const db = await loadDb();
    const signals = makeSession({ sessionId: 's1', url: 'https://a.test/post' });
    const { sessionId: _sid, url: _url, title: _title, host: _host, startedAt: _start, endedAt: _end, timeline: _tl, ...summary } = signals;

    const first = await db.mergeArticleRecord({
      ...makeInput(),
      verdict: 'deep',
      pageKind: 'article',
      pageConfidence: 0.9,
      signals: summary,
    });
    expect(first.verdict).toBe('deep');
    expect(first.pageKind).toBe('article');
    expect(first.signals?.scrollEvents).toBe(12);

    const second = await db.mergeArticleRecord({
      ...makeInput({ sessionId: 'session-2' }),
      verdict: 'skim',
      pageKind: 'article',
      pageConfidence: 0.75,
    });
    expect(second.verdict).toBe('skim');
    expect(second.signals?.scrollEvents).toBe(12);
  });
});

describe('数据导出与清空', () => {
  it('导出包含全部 store，清空只移除阅读数据', async () => {
    const db = await loadDb();
    await db.dbPut('articles', makeArticle({ url: 'https://a.test/1' }));
    await db.dbPut('digests', {
      date: '2026-11-02',
      picks: [],
      createdAt: Date.now(),
      provider: '规则推荐',
      model: 'keyword-match',
      sourceCount: 0,
      fallback: true,
    });
    await db.dbPut('negative', {
      url: 'https://a.test/neg',
      title: 'N',
      reason: 'not_interested',
      createdAt: Date.now(),
    });
    await db.saveSource({
      type: 'rss',
      name: 'Feed',
      url: 'https://my.test/rss',
      enabled: true,
      addedAt: Date.now(),
    });

    const bundle = await db.exportAllData();
    expect(bundle.version).toBe(3);
    expect(bundle.articles).toHaveLength(1);
    expect(bundle.digests).toHaveLength(1);
    expect(bundle.negative).toHaveLength(1);
    expect(bundle.sources).toHaveLength(1);
    expect(bundle.sessions).toHaveLength(0);

    await db.clearReadingData();
    expect(await db.dbCount('articles')).toBe(0);
    expect(await db.dbCount('digests')).toBe(0);
    expect(await db.dbCount('negative')).toBe(0);
    expect(await db.dbCount('sessions')).toBe(0);
    expect(await db.dbCount('sources')).toBe(1);
  });

  it('存储占用在无 StorageManager 时安全返回 0', async () => {
    const db = await loadDb();
    expect(await db.getStorageUsage()).toEqual({ usage: 0, quota: 0 });
  });
});
