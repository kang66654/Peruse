// utils/db.ts — IndexedDB 封装
import type { PageKind, ReadingSignals, ReadingVerdict } from './reading';

const DB_NAME = 'peruse-db';
const DB_VERSION = 3;

export type StoreName = 'articles' | 'digests' | 'negative' | 'sources' | 'settings' | 'sessions';

export type ArticleLayer = 'hot' | 'warm' | 'cold' | 'archive';

/** 挂在 article 上的行为摘要（不含原始时间线，完整轨迹在 sessions 表） */
export type ArticleSignalsSummary = Omit<
  ReadingSignals,
  | 'sessionId'
  | 'url'
  | 'title'
  | 'host'
  | 'startedAt'
  | 'endedAt'
  | 'timeline'
  | 'estimatedReadSec'
  | 'engagementScore'
  | 'verdict'
  | 'pageKind'
  | 'pageConfidence'
>;

export interface Article {
  url: string;
  title: string;
  host: string;
  visibleTime: number; // 累计停留秒（跨多次访问累加）
  lastSessionSec: number; // 最后一次会话停留秒（用于今日统计）
  scrollDepth: number; // 0-1
  readingScore: number; // 0-1（多维行为评分）
  wordCount: number;
  excerpt?: string;
  readAt: number;
  starred: boolean;
  archived: boolean;
  falsePositive?: boolean; // 用户反馈「这篇我没读」
  layer: ArticleLayer;
  visitCount: number;
  lastSessionId?: string;
  /** 最近一次会话的行为摘要，用于历史页解释判定 */
  signals?: ArticleSignalsSummary;
  verdict?: ReadingVerdict;
  pageKind?: PageKind;
  pageConfidence?: number;
}

export type ArticleInput = Omit<
  Article,
  'starred' | 'archived' | 'layer' | 'visitCount' | 'lastSessionSec' | 'lastSessionId'
> & {
  sessionId?: string;
  starred?: boolean;
  archived?: boolean;
};

export type DigestPickStatus = 'unread' | 'read' | 'dismissed';

export interface DigestPick {
  url: string;
  title: string;
  source: string;
  reason: string;
  estimatedMinutes: number;
  status: DigestPickStatus;
}

export interface Digest {
  id?: number;
  date: string; // YYYY-MM-DD
  picks: DigestPick[];
  createdAt: number;
  provider: string;
  model: string;
  sourceCount: number;
  fallback: boolean;
}

export type NegativeReason =
  | 'not_interested'
  | 'already_read'
  | 'too_technical'
  | 'off_topic'
  | 'blocked_site';

export interface NegativeItem {
  url: string;
  title?: string;
  reason: NegativeReason;
  createdAt: number;
}

export type SourceType = 'hn' | 'arxiv' | 'rss' | 'topic' | 'auto_discovered' | 'llm_search';

export interface Source {
  id?: number;
  type: SourceType;
  name: string;
  url?: string;
  query?: string; // topic 类型使用
  enabled: boolean;
  autoDetected?: boolean;
  host?: string;
  addedAt: number;
}

export interface Setting {
  key: string;
  value: unknown;
}

export interface ExportBundle {
  exportedAt: number;
  version: number;
  articles: Article[];
  digests: Digest[];
  negative: NegativeItem[];
  sources: Source[];
  settings: Setting[];
  sessions: ReadingSignals[];
}

let dbInstance: IDBDatabase | null = null;

function ensureIndex(store: IDBObjectStore, name: string, keyPath: string | string[]) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath);
  }
}

export function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      const tx = req.transaction;
      if (!tx) return;

      // articles: 阅读记录
      if (!db.objectStoreNames.contains('articles')) {
        const store = db.createObjectStore('articles', { keyPath: 'url' });
        ensureIndex(store, 'readAt', 'readAt');
        ensureIndex(store, 'host', 'host');
        ensureIndex(store, 'layer', 'layer');
        ensureIndex(store, 'starred', 'starred');
      } else {
        const store = tx.objectStore('articles');
        ensureIndex(store, 'readAt', 'readAt');
        ensureIndex(store, 'host', 'host');
        ensureIndex(store, 'layer', 'layer');
        ensureIndex(store, 'starred', 'starred');
      }

      // digests: 每日推荐
      if (!db.objectStoreNames.contains('digests')) {
        const store = db.createObjectStore('digests', { keyPath: 'id', autoIncrement: true });
        ensureIndex(store, 'date', 'date');
        ensureIndex(store, 'createdAt', 'createdAt');
      } else {
        const store = tx.objectStore('digests');
        ensureIndex(store, 'date', 'date');
        ensureIndex(store, 'createdAt', 'createdAt');
      }

      // negative: 不感兴趣
      if (!db.objectStoreNames.contains('negative')) {
        const store = db.createObjectStore('negative', { keyPath: 'url' });
        ensureIndex(store, 'createdAt', 'createdAt');
      }

      // sources: 文章来源
      if (!db.objectStoreNames.contains('sources')) {
        const store = db.createObjectStore('sources', { keyPath: 'id', autoIncrement: true });
        ensureIndex(store, 'type', 'type');
        ensureIndex(store, 'enabled', 'enabled');
      } else {
        const store = tx.objectStore('sources');
        ensureIndex(store, 'type', 'type');
        ensureIndex(store, 'enabled', 'enabled');
      }

      // settings: 配置
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      // sessions: 每次阅读会话的完整行为轨迹（用于重新分析判定逻辑）
      if (!db.objectStoreNames.contains('sessions')) {
        const store = db.createObjectStore('sessions', { keyPath: 'sessionId' });
        ensureIndex(store, 'url', 'url');
        ensureIndex(store, 'startedAt', 'startedAt');
        ensureIndex(store, 'verdict', 'verdict');
      } else {
        const store = tx.objectStore('sessions');
        ensureIndex(store, 'url', 'url');
        ensureIndex(store, 'startedAt', 'startedAt');
        ensureIndex(store, 'verdict', 'verdict');
      }
    };

    req.onsuccess = () => {
      dbInstance = req.result;
      resolve(dbInstance);
    };
    req.onerror = () => reject(req.error);
  });
}

// 通用 CRUD
export async function dbPut<T>(storeName: StoreName, value: T): Promise<IDBValidKey | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(value);
    let key: IDBValidKey | undefined;
    req.onsuccess = () => {
      key = req.result;
    };
    tx.oncomplete = () => resolve(key);
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbGet<T>(storeName: StoreName, key: string | number): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGetAll<T>(storeName: StoreName): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function dbDelete(storeName: StoreName, key: string | number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbClear(storeName: StoreName): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbCount(storeName: StoreName): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// —— 阅读记录 ——

export function sameOriginPath(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    const drop = new Set([
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid',
      'mc_cid',
      'mc_eid',
      'ref',
      'source',
    ]);
    for (const key of Array.from(u.searchParams.keys())) {
      if (drop.has(key) || key.startsWith('utm_')) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return raw;
  }
}

export async function getArticlesSince(since: number): Promise<Article[]> {
  const all = await dbGetAll<Article>('articles');
  return all.filter((a) => a.readAt >= since);
}

export async function getArticleByUrl(url: string): Promise<Article | undefined> {
  return dbGet<Article>('articles', normalizeUrl(url));
}

export async function getAllArticles(): Promise<Article[]> {
  const all = await dbGetAll<Article>('articles');
  return all.sort((a, b) => b.readAt - a.readAt);
}

/**
 * 合并一条阅读上报。
 * 同一 sessionId 重复上报只更新（用累计值），不重复累加；
 * 新 session 则累加停留时长并 +1 访问次数。
 */
export async function mergeArticleRecord(input: ArticleInput): Promise<Article> {
  const url = normalizeUrl(input.url);
  const now = Date.now();
  const existing = await dbGet<Article>('articles', url);
  const sessionId = input.sessionId;

  if (existing) {
    const sameSession = Boolean(sessionId && existing.lastSessionId === sessionId);
    const visibleTime = sameSession
      ? Math.max(existing.visibleTime, input.visibleTime)
      : existing.visibleTime + input.visibleTime;

    const merged: Article = {
      ...existing,
      ...input,
      url,
      visibleTime,
      scrollDepth: Math.max(existing.scrollDepth || 0, input.scrollDepth || 0),
      readingScore: Math.max(existing.readingScore || 0, input.readingScore || 0),
      wordCount: Math.max(existing.wordCount || 0, input.wordCount || 0),
      excerpt: input.excerpt || existing.excerpt,
      readAt: now,
      lastSessionSec: input.visibleTime,
      lastSessionId: sessionId,
      visitCount: sameSession ? existing.visitCount || 1 : (existing.visitCount || 1) + 1,
      starred: existing.starred || Boolean(input.starred),
      archived: existing.archived || Boolean(input.archived),
      falsePositive: existing.falsePositive || false,
      layer: existing.layer || 'hot',
      signals: input.signals || existing.signals,
      verdict: input.verdict || existing.verdict,
      pageKind: input.pageKind || existing.pageKind,
      pageConfidence: input.pageConfidence ?? existing.pageConfidence,
    };
    await dbPut('articles', merged);
    return merged;
  }

  const article: Article = {
    url,
    title: input.title || url,
    host: input.host,
    visibleTime: input.visibleTime,
    lastSessionSec: input.visibleTime,
    scrollDepth: input.scrollDepth,
    readingScore: input.readingScore,
    wordCount: input.wordCount,
    excerpt: input.excerpt,
    readAt: now,
    starred: Boolean(input.starred),
    archived: Boolean(input.archived),
    falsePositive: false,
    layer: 'hot',
    visitCount: 1,
    lastSessionId: sessionId,
    signals: input.signals,
    verdict: input.verdict,
    pageKind: input.pageKind,
    pageConfidence: input.pageConfidence,
  };
  await dbPut('articles', article);
  return article;
}

/**
 * 保存一次完整阅读会话的行为轨迹。
 * 同一 sessionId 重复上报时覆盖（content 每 10s/卸载时都会 flush）。
 */
export async function saveReadingSession(session: ReadingSignals): Promise<void> {
  await dbPut('sessions', { ...session, url: normalizeUrl(session.url) });
}

export async function getSessionsByUrl(url: string, limit = 20): Promise<ReadingSignals[]> {
  const all = await dbGetAll<ReadingSignals>('sessions');
  return all
    .filter((s) => normalizeUrl(s.url) === normalizeUrl(url))
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit);
}

export async function getRecentSessions(days = 30): Promise<ReadingSignals[]> {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const all = await dbGetAll<ReadingSignals>('sessions');
  return all.filter((s) => s.startedAt >= since).sort((a, b) => b.startedAt - a.startedAt);
}

export async function getAllSessions(): Promise<ReadingSignals[]> {
  const all = await dbGetAll<ReadingSignals>('sessions');
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

/** 清理超过 retentionDays 天的会话轨迹，保留文章记录本身 */
export async function pruneOldSessions(retentionDays = 90): Promise<number> {
  const since = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const all = await dbGetAll<ReadingSignals>('sessions');
  const stale = all.filter((s) => s.startedAt < since);
  for (const session of stale) {
    await dbDelete('sessions', session.sessionId);
  }
  return stale.length;
}

/**
 * 4 层存储降级：hot → warm → cold → archive。
 * 只做降级与正文裁剪，不删除记录；starred 永不处理。
 */
export async function pruneOldArticles(): Promise<{ migrated: number; sessionsPruned: number }> {
  const articles = await dbGetAll<Article>('articles');
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  let migrated = 0;

  for (const article of articles) {
    if (article.starred) continue;

    const age = now - article.readAt;
    let layer: ArticleLayer = 'hot';
    if (age > 180 * day) layer = 'archive';
    else if (age > 90 * day) layer = 'cold';
    else if (age > 30 * day) layer = 'warm';

    let next: Article | null = null;
    if (article.layer !== layer) {
      next = { ...article, layer };
    }

    if (layer !== 'hot' && article.excerpt) {
      if (layer !== 'warm' || article.visibleTime <= 120) {
        next = { ...(next || article), excerpt: '' };
      }
    }

    if (next) {
      await dbPut('articles', next);
      migrated++;
    }
  }

  return { migrated, sessionsPruned: await pruneOldSessions(90) };
}

// —— 每日推荐 ——

export async function getLatestDigest(): Promise<Digest | undefined> {
  const all = await dbGetAll<Digest>('digests');
  if (!all.length) return undefined;
  all.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : b.date.localeCompare(a.date)));
  return all[0];
}

export async function getDigestByDate(date: string): Promise<Digest | undefined> {
  const all = await dbGetAll<Digest>('digests');
  const matches = all.filter((d) => d.date === date).sort((a, b) => b.createdAt - a.createdAt);
  return matches[0];
}

export async function getRecentDigests(days = 30): Promise<Digest[]> {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const all = await dbGetAll<Digest>('digests');
  return all.filter((d) => d.createdAt >= since).sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateDigest(digest: Digest): Promise<void> {
  await dbPut('digests', digest);
}

// —— 负反馈 ——

export async function addNegative(item: NegativeItem): Promise<void> {
  await dbPut('negative', { ...item, url: normalizeUrl(item.url) });
}

// —— 文章源 ——

export function defaultSources(): Omit<Source, 'id'>[] {
  const now = Date.now();
  return [
    {
      type: 'hn',
      name: 'Hacker News',
      url: 'https://news.ycombinator.com',
      enabled: true,
      autoDetected: false,
      host: 'news.ycombinator.com',
      addedAt: now,
    },
    {
      type: 'arxiv',
      name: 'arXiv cs.LG / cs.SE',
      url: 'https://arxiv.org',
      query: 'cat:cs.LG OR cat:cs.SE',
      enabled: true,
      autoDetected: false,
      host: 'arxiv.org',
      addedAt: now,
    },
    {
      type: 'rss',
      name: 'Lobsters',
      url: 'https://lobste.rs/rss',
      enabled: true,
      autoDetected: false,
      host: 'lobste.rs',
      addedAt: now,
    },
  ];
}

export async function seedDefaultSources(): Promise<void> {
  const existing = await dbGetAll<Source>('sources');
  if (existing.length > 0) return;

  for (const source of defaultSources()) {
    await dbPut('sources', source);
  }
}

export async function getSources(): Promise<Source[]> {
  const all = await dbGetAll<Source>('sources');
  return all.sort((a, b) => a.addedAt - b.addedAt);
}

export async function saveSource(source: Source): Promise<number> {
  if (!source.id) {
    const existing = await dbGetAll<Source>('sources');
    const maxId = existing.reduce((max, s) => Math.max(max, s.id || 0), 0);
    source.id = maxId + 1;
  }
  await dbPut('sources', source);
  return source.id;
}

export async function deleteSource(id: number): Promise<void> {
  await dbDelete('sources', id);
}

// —— 数据管理 ——

export async function exportAllData(): Promise<ExportBundle> {
  return {
    exportedAt: Date.now(),
    version: DB_VERSION,
    articles: await dbGetAll<Article>('articles'),
    digests: await dbGetAll<Digest>('digests'),
    negative: await dbGetAll<NegativeItem>('negative'),
    sources: await dbGetAll<Source>('sources'),
    settings: await dbGetAll<Setting>('settings'),
    sessions: await dbGetAll<ReadingSignals>('sessions'),
  };
}

export async function clearReadingData(): Promise<void> {
  await dbClear('articles');
  await dbClear('digests');
  await dbClear('negative');
  await dbClear('sessions');
}

export async function getStorageUsage(): Promise<{ usage: number; quota: number }> {
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      return { usage: estimate.usage || 0, quota: estimate.quota || 0 };
    } catch {
      return { usage: 0, quota: 0 };
    }
  }
  return { usage: 0, quota: 0 };
}

export async function deleteArticle(url: string): Promise<void> {
  await dbDelete('articles', normalizeUrl(url));
}
