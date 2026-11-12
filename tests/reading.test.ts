import { describe, expect, it } from 'vitest';
import {
  classifyPage,
  computeEngagement,
  estimateReadSec,
  verdictLabel,
  type PageProfile,
  type SessionMetrics,
} from '../src/utils/reading';

function profile(overrides: Partial<PageProfile> & { url?: string } = {}): PageProfile {
  return {
    host: 'example.com',
    url: 'https://example.com/posts/hello',
    wordCount: 1200,
    paragraphCount: 8,
    avgParagraphChars: 140,
    linkDensity: 0.1,
    hasArticleTag: true,
    ogType: 'article',
    schemaType: 'Article',
    textChars: 6000,
    hasAuthorMeta: true,
    isMainContent: true,
    ...overrides,
  };
}

function metrics(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    visibleSec: 180,
    hiddenSec: 10,
    idleSec: 5,
    editingSec: 0,
    maxDepth: 0.9,
    scrollEvents: 14,
    scrollDistancePx: 3200,
    avgScrollSpeed: 300,
    maxScrollSpeed: 1000,
    directionChanges: 2,
    pauseCount: 4,
    avgPauseSec: 8,
    mouseMoves: 20,
    clicks: 2,
    keyPresses: 5,
    selectionCount: 1,
    selectedChars: 80,
    copyCount: 1,
    visibilityChanges: 0,
    focusLossCount: 0,
    wordCount: 1200,
    timeline: [],
    ...overrides,
  };
}

describe('页面类型判定', () => {
  it('Reddit 帖子/评论页判定为讨论区，不算文章', () => {
    const decision = classifyPage(
      profile({
        host: 'www.reddit.com',
        url: 'https://www.reddit.com/r/webdev/comments/xyz/title/',
        hasArticleTag: false,
        ogType: 'website',
        schemaType: '',
      })
    );
    expect(decision.kind).toBe('discussion');
    expect(decision.isArticle).toBe(false);
    expect(decision.reasons.join('')).toContain('Reddit');
  });

  it('设置/账户/搜索/列表页判定为功能页', () => {
    for (const url of [
      'https://example.com/settings/account',
      'https://example.com/account',
      'https://example.com/preferences',
      'https://example.com/search?q=test',
      'https://example.com/tag/42',
      'https://example.com/page/2',
    ]) {
      const decision = classifyPage(profile({ url, hasArticleTag: false, ogType: 'website', schemaType: '' }));
      expect(decision.kind).toBe('utility');
      expect(decision.isArticle).toBe(false);
    }
  });

  it('信息流首页判定为功能页', () => {
    const decision = classifyPage(
      profile({
        url: 'https://example.com/feed-home',
        hasArticleTag: false,
        ogType: 'website',
        schemaType: '',
        wordCount: 500,
      })
    );
    expect(decision.kind).toBe('utility');
    expect(decision.isArticle).toBe(false);
  });

  it('视频站点判定为视频', () => {
    const decision = classifyPage(
      profile({ host: 'www.youtube.com', url: 'https://www.youtube.com/watch?v=abc' })
    );
    expect(decision.kind).toBe('video');
    expect(decision.isArticle).toBe(false);
  });

  it('有 Article 语义与正文结构的页面判定为文章', () => {
    const decision = classifyPage(profile());
    expect(decision.kind).toBe('article');
    expect(decision.isArticle).toBe(true);
    expect(decision.confidence).toBeGreaterThanOrEqual(0.55);
    expect(decision.reasons.join('')).toContain('Article');
  });

  it('链接密度过高的列表页不算文章', () => {
    const decision = classifyPage(
      profile({
        hasArticleTag: false,
        ogType: 'website',
        schemaType: '',
        isMainContent: false,
        linkDensity: 0.7,
        wordCount: 600,
      })
    );
    expect(decision.isArticle).toBe(false);
    expect(decision.kind).toBe('index');
  });

  it('正文过短的页面不算文章', () => {
    const decision = classifyPage(profile({ wordCount: 80, paragraphCount: 1, textChars: 200 }));
    expect(decision.isArticle).toBe(false);
  });
});

describe('阅读行为评分', () => {
  it('深度阅读：高分、深读、且合格', () => {
    const decision = classifyPage(profile());
    const result = computeEngagement(metrics(), decision);
    expect(result.verdict).toBe('deep');
    expect(result.score).toBeGreaterThanOrEqual(0.7);
    expect(result.qualified).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('快速掠读：扫读、不合格', () => {
    const decision = classifyPage(profile());
    const result = computeEngagement(
      metrics({
        visibleSec: 20,
        maxDepth: 0.2,
        scrollEvents: 5,
        pauseCount: 0,
        avgPauseSec: 0,
        copyCount: 0,
        selectionCount: 0,
        selectedChars: 0,
        keyPresses: 0,
        clicks: 0,
        mouseMoves: 3,
        hiddenSec: 0,
        idleSec: 0,
      }),
      decision
    );
    expect(result.verdict).toBe('glance');
    expect(result.qualified).toBe(false);
  });

  it('打开即走：跳过、不合格', () => {
    const decision = classifyPage(profile());
    const result = computeEngagement(
      metrics({
        visibleSec: 5,
        hiddenSec: 2,
        idleSec: 0,
        maxDepth: 0,
        scrollEvents: 0,
        scrollDistancePx: 0,
        pauseCount: 0,
        copyCount: 0,
        selectionCount: 0,
        selectedChars: 0,
        keyPresses: 0,
        clicks: 0,
        mouseMoves: 2,
      }),
      decision
    );
    expect(result.verdict).toBe('bounce');
    expect(result.qualified).toBe(false);
  });

  it('论坛页面即使停留很久也不合格', () => {
    const decision = classifyPage(
      profile({
        host: 'www.reddit.com',
        url: 'https://www.reddit.com/r/webdev/comments/xyz/title/',
        hasArticleTag: false,
        ogType: 'website',
        schemaType: '',
      })
    );
    const result = computeEngagement(metrics({ visibleSec: 300 }), decision);
    expect(result.qualified).toBe(false);
  });

  it('中途长时间切走会降低评分并给出原因', () => {
    const decision = classifyPage(profile());
    const baseline = computeEngagement(
      metrics({ visibleSec: 120, hiddenSec: 0, idleSec: 0 }),
      decision
    );
    const result = computeEngagement(
      metrics({ visibleSec: 120, hiddenSec: 200, idleSec: 0 }),
      decision
    );
    expect(result.score).toBeLessThan(baseline.score);
    expect(result.reasons.join('')).toContain('切走');
  });

  it('预计阅读时长有上下限', () => {
    expect(estimateReadSec(0)).toBe(30);
    expect(estimateReadSec(100000)).toBe(900);
    expect(estimateReadSec(600)).toBe(120);
  });

  it('判定文案完整', () => {
    expect(verdictLabel('deep')).toBe('深读');
    expect(verdictLabel('skim')).toBe('略读');
    expect(verdictLabel('glance')).toBe('扫读');
    expect(verdictLabel('bounce')).toBe('跳过');
  });
});
