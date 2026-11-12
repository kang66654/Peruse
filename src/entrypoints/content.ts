// entrypoints/content.ts — 阅读行为采集
//
// 采集目标：把「打开过」与「真的读了」分开，并保留完整行为轨迹供后续重新分析判定逻辑。
// 记录项：可见/隐藏/空闲/编辑时长、滚动深度/距离/速度/方向、阅读停顿、鼠标/点击/按键/拖选/复制、时间线。
// 隐私：只统计行为数量与正文长度，不上传正文，仅本地 IndexedDB。

import { normalizeUrl } from '../utils/db';
import {
  classifyPage,
  computeEngagement,
  estimateReadSec,
  type PageKind,
  type PageProfile,
  type ReadingSignals,
  type SessionMetrics,
  type TimelinePoint,
} from '../utils/reading';
import { getSettings } from '../utils/settings';

const EDITOR_HOSTS = [
  'docs.google.com',
  'notion.so',
  'www.notion.so',
  'codepen.io',
  'figma.com',
  'www.figma.com',
  'app.diagrams.net',
];

const NON_ARTICLE_HOSTS = [
  'youtube.com',
  'www.youtube.com',
  'bilibili.com',
  'www.bilibili.com',
  'douyin.com',
  'www.douyin.com',
  'x.com',
  'twitter.com',
  'www.twitter.com',
  'weibo.com',
];

/** 没有交互超过该时长才算空闲（正常阅读不算） */
const IDLE_GRACE_MS = 45_000;
/** 两次滚动间隔超过该时长记一次阅读停顿 */
const PAUSE_GAP_MS = 3_000;
/** 周期落盘间隔 */
const FLUSH_INTERVAL_MS = 10_000;
/** 会话最短可见时长 */
const MIN_SESSION_SEC = 5;
/** 正文最短字数 */
const MIN_WORD_COUNT = 30;

interface SessionState {
  sessionId: string;
  startedAt: number;
  visibleMs: number;
  hiddenMs: number;
  idleMs: number;
  editingMs: number;
  activeStart: number | null;
  hiddenStart: number | null;
  hasBeenVisible: boolean;
  editingStart: number | null;
  lastActivityAt: number;
  maxDepth: number;
  scrollEvents: number;
  scrollDistancePx: number;
  scrollSpeedSum: number;
  scrollSpeedSamples: number;
  maxScrollSpeed: number;
  directionChanges: number;
  lastDirection: number;
  pauseCount: number;
  pauseSumMs: number;
  lastScrollAt: number;
  lastScrollY: number;
  lastTimelineAt: number;
  lastTimelineDepth: number;
  mouseMoves: number;
  clicks: number;
  keyPresses: number;
  selectionCount: number;
  selectedChars: number;
  copyCount: number;
  visibilityChanges: number;
  focusLossCount: number;
  timeline: TimelinePoint[];
  lastFlushAt: number;
  rssNotified: boolean;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    void init();
  },
});

async function init() {
  const host = location.hostname;
  if (EDITOR_HOSTS.includes(host)) return;

  let blacklist: string[] = [];
  try {
    const settings = await getSettings();
    blacklist = settings.blacklist || [];
  } catch {
    blacklist = [];
  }

  if (isBlocked(host, blacklist) || NON_ARTICLE_HOSTS.includes(host)) return;

  const now0 = Date.now();
  const state: SessionState = {
    sessionId:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${now0}-${Math.random().toString(36).slice(2)}`,
    startedAt: now0,
    visibleMs: 0,
    hiddenMs: 0,
    idleMs: 0,
    editingMs: 0,
    activeStart: document.hidden ? null : now0,
    // 打开时就在后台的标签页不计隐藏时长（那段时间用户并未在看它）
    hiddenStart: null,
    hasBeenVisible: !document.hidden,
    editingStart: null,
    lastActivityAt: now0,
    maxDepth: 0,
    scrollEvents: 0,
    scrollDistancePx: 0,
    scrollSpeedSum: 0,
    scrollSpeedSamples: 0,
    maxScrollSpeed: 0,
    directionChanges: 0,
    lastDirection: 0,
    pauseCount: 0,
    pauseSumMs: 0,
    lastScrollAt: now0,
    lastScrollY: window.scrollY,
    lastTimelineAt: now0,
    lastTimelineDepth: 0,
    mouseMoves: 0,
    clicks: 0,
    keyPresses: 0,
    selectionCount: 0,
    selectedChars: 0,
    copyCount: 0,
    visibilityChanges: 0,
    focusLossCount: 0,
    timeline: [],
    lastFlushAt: 0,
    rssNotified: false,
  };

  // —— 计时 ——

  function addVisible(now = Date.now()) {
    if (state.activeStart !== null) {
      state.visibleMs += Math.max(0, now - state.activeStart);
      state.activeStart = null;
    }
  }

  function resumeVisible(now = Date.now()) {
    if (state.activeStart === null && !document.hidden && state.editingStart === null) {
      state.activeStart = now;
    }
  }

  /** 在每次真实交互时结算一段可能被忽略的空闲时间 */
  function settleIdle(now = Date.now()) {
    if (!document.hidden) {
      const gap = now - state.lastActivityAt;
      if (gap > IDLE_GRACE_MS) state.idleMs += gap - IDLE_GRACE_MS;
    }
    state.lastActivityAt = now;
  }

  function markActivity(now = Date.now()) {
    settleIdle(now);
  }

  // —— 编辑态（输入框内不算阅读） ——

  function isEditingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      target.isContentEditable ||
      target.getAttribute('role') === 'textbox'
    );
  }

  document.addEventListener('focusin', (event) => {
    if (!isEditingTarget(event.target)) return;
    if (state.editingStart === null) {
      addVisible();
      state.editingStart = Date.now();
    }
  });

  document.addEventListener('focusout', (event) => {
    if (!isEditingTarget(event.target)) return;
    if (state.editingStart !== null) {
      state.editingMs += Date.now() - state.editingStart;
      state.editingStart = null;
      resumeVisible();
    }
  });

  // —— 可见性 / 焦点 ——

  document.addEventListener('visibilitychange', () => {
    const now = Date.now();
    state.visibilityChanges++;
    if (document.hidden) {
      addVisible(now);
      settleIdle(now);
      if (state.hasBeenVisible && state.hiddenStart === null) state.hiddenStart = now;
      flush(false);
    } else {
      if (state.hiddenStart !== null) {
        state.hiddenMs += now - state.hiddenStart;
        state.hiddenStart = null;
      }
      state.hasBeenVisible = true;
      state.lastActivityAt = now;
      resumeVisible(now);
    }
  });

  window.addEventListener('blur', () => {
    state.focusLossCount++;
  });

  window.addEventListener('focus', () => {
    state.lastActivityAt = Date.now();
  });

  // —— 滚动 ——

  window.addEventListener(
    'scroll',
    () => {
      const now = Date.now();
      markActivity(now);

      const y = window.scrollY;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const depth = scrollable > 0 ? Math.min(1, Math.max(0, y / scrollable)) : 0;
      state.maxDepth = Math.max(state.maxDepth, depth);
      state.scrollEvents++;

      const delta = y - state.lastScrollY;
      const distance = Math.abs(delta);
      const dt = now - state.lastScrollAt;
      state.scrollDistancePx += distance;

      if (distance > 0 && dt > 0) {
        const speed = (distance / dt) * 1000; // px/s
        state.scrollSpeedSum += speed;
        state.scrollSpeedSamples++;
        state.maxScrollSpeed = Math.max(state.maxScrollSpeed, Math.round(speed));
      }

      const direction = delta === 0 ? 0 : delta > 0 ? 1 : -1;
      if (direction !== 0) {
        if (state.lastDirection !== 0 && direction !== state.lastDirection) {
          state.directionChanges++;
        }
        state.lastDirection = direction;
      }

      if (state.scrollEvents > 1 && dt >= PAUSE_GAP_MS) {
        state.pauseCount++;
        state.pauseSumMs += dt;
      }

      // 时间线：≥0.5s 或深度跳变 ≥15% 才打点，最多 200 点
      if (
        now - state.lastTimelineAt >= 500 ||
        Math.abs(depth - state.lastTimelineDepth) >= 0.15
      ) {
        if (state.timeline.length < 200) {
          state.timeline.push({ t: Math.round((now - state.startedAt) / 100) / 10, depth: Math.round(depth * 100) / 100 });
        }
        state.lastTimelineAt = now;
        state.lastTimelineDepth = depth;
      }

      state.lastScrollAt = now;
      state.lastScrollY = y;
    },
    { passive: true }
  );

  // —— 鼠标 / 点击 / 按键 / 选择 / 复制 ——

  let lastMouseMoveAt = 0;
  document.addEventListener(
    'mousemove',
    () => {
      const now = Date.now();
      if (now - lastMouseMoveAt < 200) return;
      lastMouseMoveAt = now;
      state.mouseMoves++;
      markActivity(now);
    },
    { passive: true }
  );

  document.addEventListener('mousedown', () => markActivity(), { passive: true });

  document.addEventListener(
    'click',
    () => {
      state.clicks++;
      markActivity();
    },
    { passive: true }
  );

  document.addEventListener('keydown', (event) => {
    markActivity();
    if (!isEditingTarget(event.target)) state.keyPresses++;
  });

  document.addEventListener('copy', () => {
    state.copyCount++;
    markActivity();
  });

  document.addEventListener('mouseup', () => {
    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : '';
    if (text.length >= 2) {
      state.selectionCount++;
      state.selectedChars += text.length;
    }
  });

  // —— 生命周期 ——

  window.addEventListener('pagehide', () => flush(true));
  window.addEventListener('beforeunload', () => flush(true));
  const timer = setInterval(() => flush(false), FLUSH_INTERVAL_MS);
  window.addEventListener('pagehide', () => clearInterval(timer));

  discoverRss(host, state);

  // —— 快照与上报 ——

  function snapshotMetrics(now: number): SessionMetrics {
    const visibleMs =
      state.visibleMs + (state.activeStart !== null ? Math.max(0, now - state.activeStart) : 0);
    const hiddenMs =
      state.hiddenMs + (state.hiddenStart !== null ? Math.max(0, now - state.hiddenStart) : 0);
    const editingMs =
      state.editingMs + (state.editingStart !== null ? Math.max(0, now - state.editingStart) : 0);

    const trailingIdle =
      !document.hidden && state.editingStart === null
        ? Math.max(0, now - state.lastActivityAt - IDLE_GRACE_MS)
        : 0;

    const trailingPause =
      state.scrollEvents > 0 && now - state.lastScrollAt >= PAUSE_GAP_MS && !document.hidden
        ? now - state.lastScrollAt
        : 0;

    const pauseCount = state.pauseCount + (trailingPause > 0 ? 1 : 0);
    const pauseSumMs = state.pauseSumMs + trailingPause;

    return {
      visibleSec: Math.round(visibleMs / 1000),
      hiddenSec: Math.round(hiddenMs / 1000),
      idleSec: Math.round((state.idleMs + trailingIdle) / 1000),
      editingSec: Math.round(editingMs / 1000),
      maxDepth: Math.round(state.maxDepth * 100) / 100,
      scrollEvents: state.scrollEvents,
      scrollDistancePx: Math.round(state.scrollDistancePx),
      avgScrollSpeed:
        state.scrollSpeedSamples > 0
          ? Math.round(state.scrollSpeedSum / state.scrollSpeedSamples)
          : 0,
      maxScrollSpeed: state.maxScrollSpeed,
      directionChanges: state.directionChanges,
      pauseCount,
      avgPauseSec: pauseCount > 0 ? Math.round((pauseSumMs / pauseCount / 1000) * 10) / 10 : 0,
      mouseMoves: state.mouseMoves,
      clicks: state.clicks,
      keyPresses: state.keyPresses,
      selectionCount: state.selectionCount,
      selectedChars: state.selectedChars,
      copyCount: state.copyCount,
      visibilityChanges: state.visibilityChanges,
      focusLossCount: state.focusLossCount,
      wordCount: 0,
      timeline: [...state.timeline],
    };
  }

  function flush(final: boolean) {
    const now = Date.now();
    if (!final && now - state.lastFlushAt < FLUSH_INTERVAL_MS - 2_000) return;

    const content = extractReadableContent();
    if (!content) return;

    const metrics = snapshotMetrics(now);
    metrics.wordCount = content.wordCount;

    const visibleSec = metrics.visibleSec;
    if (visibleSec < MIN_SESSION_SEC) return;
    if (content.wordCount < MIN_WORD_COUNT) return;

    const profile = buildProfile(host, content);
    const decision = classifyPage(profile);
    const engagement = computeEngagement(metrics, decision);

    const session: ReadingSignals = {
      ...metrics,
      sessionId: state.sessionId,
      url: normalizeUrl(location.href),
      title: document.title || host,
      host,
      startedAt: state.startedAt,
      endedAt: now,
      estimatedReadSec: estimateReadSec(content.wordCount),
      engagementScore: engagement.score,
      verdict: engagement.verdict,
      reasons: engagement.reasons,
      pageKind: decision.kind,
      pageConfidence: decision.confidence,
      qualified: engagement.qualified,
    };

    state.lastFlushAt = now;

    send({ type: 'save-session', session });

    if (engagement.qualified) {
      send({
        type: 'save-article',
        article: {
          url: session.url,
          title: session.title,
          host,
          visibleTime: visibleSec,
          scrollDepth: metrics.maxDepth,
          readingScore: engagement.score,
          wordCount: content.wordCount,
          excerpt: content.excerpt,
          readAt: now,
          sessionId: state.sessionId,
          verdict: engagement.verdict,
          pageKind: decision.kind as PageKind,
          pageConfidence: decision.confidence,
          signals: {
            visibleSec: metrics.visibleSec,
            hiddenSec: metrics.hiddenSec,
            idleSec: metrics.idleSec,
            editingSec: metrics.editingSec,
            maxDepth: metrics.maxDepth,
            scrollEvents: metrics.scrollEvents,
            scrollDistancePx: metrics.scrollDistancePx,
            avgScrollSpeed: metrics.avgScrollSpeed,
            maxScrollSpeed: metrics.maxScrollSpeed,
            directionChanges: metrics.directionChanges,
            pauseCount: metrics.pauseCount,
            avgPauseSec: metrics.avgPauseSec,
            mouseMoves: metrics.mouseMoves,
            clicks: metrics.clicks,
            keyPresses: metrics.keyPresses,
            selectionCount: metrics.selectionCount,
            selectedChars: metrics.selectedChars,
            copyCount: metrics.copyCount,
            visibilityChanges: metrics.visibilityChanges,
            focusLossCount: metrics.focusLossCount,
            wordCount: metrics.wordCount,
            reasons: engagement.reasons,
            qualified: engagement.qualified,
          },
        },
      });
    }

    if (final) {
      addVisible(now);
      state.activeStart = null;
    }
  }
}

function send(message: Record<string, unknown>) {
  try {
    void chrome.runtime.sendMessage(message).catch(() => undefined);
  } catch {
    // 扩展被更新/卸载后 context 失效，忽略
  }
}

function isBlocked(host: string, blacklist: string[]): boolean {
  return blacklist.some((entry) => {
    const rule = entry.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return rule && (host === rule || host.endsWith(`.${rule}`));
  });
}

interface ReadableContent {
  text: string;
  excerpt: string;
  wordCount: number;
  paragraphCount: number;
  avgParagraphChars: number;
  linkDensity: number;
  textChars: number;
  hasArticleTag: boolean;
  isMainContent: boolean;
  container: HTMLElement;
}

const CONTAINER_SELECTORS = [
  'article',
  '[role="article"]',
  'main',
  '.post',
  '.entry-content',
  '.article-content',
  '.post-content',
  '#article',
  '#content',
];

function pickContainer(): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestChars = 0;

  for (const selector of CONTAINER_SELECTORS) {
    for (const node of document.querySelectorAll<HTMLElement>(selector)) {
      const chars = (node.innerText || '').trim().length;
      if (chars > bestChars) {
        best = node;
        bestChars = chars;
      }
    }
    // 找到足够长的正文块就不再向下找更模糊的选择器
    if (best && bestChars >= 600) break;
  }

  return best;
}

function extractReadableContent(): ReadableContent | null {
  const container = pickContainer() || document.body;
  if (!container) return null;

  const raw = container.innerText || '';
  const text = raw.replace(/\s+/g, ' ').trim().slice(0, 50_000);
  if (!text) return null;

  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const latin = (text.match(/[A-Za-z0-9]+/g) || []).length;
  const wordCount = cjk + latin;

  const paragraphs = Array.from(
    container.querySelectorAll<HTMLElement>('p, li, blockquote, h2, h3')
  ).filter((node) => (node.innerText || '').trim().length >= 20);
  const paragraphChars = paragraphs.reduce(
    (sum, node) => sum + (node.innerText || '').trim().length,
    0
  );
  const paragraphCount = paragraphs.length;

  const links = Array.from(container.querySelectorAll('a'));
  const linkChars = links.reduce((sum, link) => sum + (link.innerText || '').trim().length, 0);

  const hasArticleTag = Boolean(document.querySelector('article'));
  const isMainContent = container !== document.body;

  return {
    text,
    excerpt: text.slice(0, 2000),
    wordCount,
    paragraphCount,
    avgParagraphChars: paragraphCount > 0 ? Math.round(paragraphChars / paragraphCount) : 0,
    linkDensity: text.length > 0 ? Math.min(1, linkChars / text.length) : 1,
    textChars: text.length,
    hasArticleTag,
    isMainContent,
    container,
  };
}

function readSchemaType(): string {
  const types: string[] = [];
  const scripts = document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]');

  for (const script of scripts) {
    try {
      const data: unknown = JSON.parse(script.textContent || '');
      visitSchema(data, types);
    } catch {
      // 非 JSON 的脚本忽略
    }
  }

  return types.join(',');
}

function visitSchema(node: unknown, types: string[]) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) visitSchema(child, types);
    return;
  }
  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  if (typeof type === 'string') types.push(type);
  else if (Array.isArray(type)) {
    for (const value of type) if (typeof value === 'string') types.push(value);
  }
  if (obj['@graph']) visitSchema(obj['@graph'], types);
}

function buildProfile(host: string, content: ReadableContent): PageProfile {
  const ogType =
    document.querySelector('meta[property="og:type"]')?.getAttribute('content') || undefined;
  const schemaType = readSchemaType();
  const hasAuthorMeta =
    Boolean(
      document.querySelector('meta[name="author"]')?.getAttribute('content')?.trim()
    ) ||
    Boolean(document.querySelector('link[rel="author"]')) ||
    /author/i.test(schemaType);

  return {
    host,
    url: location.href,
    wordCount: content.wordCount,
    paragraphCount: content.paragraphCount,
    avgParagraphChars: content.avgParagraphChars,
    linkDensity: content.linkDensity,
    hasArticleTag: content.hasArticleTag,
    ogType,
    schemaType,
    textChars: content.textChars,
    hasAuthorMeta,
    isMainContent: content.isMainContent,
  };
}

function discoverRss(host: string, state: SessionState) {
  if (state.rssNotified) return;
  const link = document.querySelector<HTMLLinkElement>(
    'link[rel="alternate"][type="application/rss+xml"], link[rel="alternate"][type="application/atom+xml"]'
  );
  if (!link?.href) return;
  if (!/^https?:/.test(link.href)) return;
  state.rssNotified = true;

  send({ type: 'discover-rss', feedUrl: link.href, host, pageUrl: location.href });
}
