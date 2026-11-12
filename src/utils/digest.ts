// utils/digest.ts — 每晚推荐生成流水线
import {
  addNegative,
  dbGetAll,
  dbPut,
  getArticlesSince,
  getDigestByDate,
  getRecentDigests,
  getSources,
  normalizeUrl,
  pruneOldArticles,
  seedDefaultSources,
  type Article,
  type Digest,
  type DigestPick,
  type NegativeItem,
  type Source,
} from './db';
import { callLLM, extractJson, isLlmConfigured } from './llm';
import {
  getActiveProfile,
  getProviderPreset,
  getSettings,
  type Settings,
} from './settings';
import {
  fetchArxivCandidates,
  fetchHNCandidates,
  fetchSourceCandidates,
  type Candidate,
} from './sources';
import { setDigestStatus } from './status';

let running = false;

export function isDigestRunning(): boolean {
  return running;
}

function todayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function countWords(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const latin = (text.match(/[A-Za-z0-9]+/g) || []).length;
  return cjk + latin;
}

function estimateMinutes(candidate: Candidate): number {
  const words = countWords(`${candidate.title} ${candidate.excerpt || ''}`);
  if (!words) return 5;
  const minutes = Math.round(words / 250);
  return Math.min(30, Math.max(2, minutes || 3));
}

function tokenize(text: string): Set<string> {
  const normalized = text.toLowerCase();
  const result = new Set<string>();
  const latin = normalized.match(/[a-z0-9]{3,}/g) || [];
  const stop = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you', 'are', 'was',
    'how', 'what', 'why', 'not', 'but', 'has', 'have', 'can', 'will', 'about', 'into',
  ]);
  for (const word of latin) {
    if (!stop.has(word)) result.add(word);
  }
  const cjkRuns = normalized.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  for (const run of cjkRuns) {
    if (run.length <= 4) result.add(run);
    for (let i = 0; i + 2 <= run.length; i++) {
      const gram = run.slice(i, i + 2);
      if (!['的是', '了这', '这个', '一个', '我们', '可以'].includes(gram)) result.add(gram);
    }
  }
  return result;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const token of a) {
    if (b.has(token)) count++;
  }
  return count;
}

function formatHistory(articles: Article[]): string {
  return articles
    .slice(0, 18)
    .map((a) => `- [${a.host}] ${a.title}（停留 ${Math.round(a.visibleTime / 60)} 分钟）`)
    .join('\n');
}

async function generateQueries(
  settings: Settings,
  articles: Article[]
): Promise<string[]> {
  if (!isLlmConfigured(settings)) return settings.interests.slice(0, 4);
  try {
    const text = await callLLM(
      settings,
      [
        {
          role: 'system',
          content:
            'You extract search keywords from a reader profile. Return only JSON.',
        },
        {
          role: 'user',
          content:
            `User's interests: ${settings.interests.join(', ')}\n` +
            `Recent reading:\n${formatHistory(articles)}\n\n` +
            'Give 3-5 short English or Chinese search queries that would find new, relevant articles tonight. ' +
            'Return JSON: {"queries": ["..."]}',
        },
      ],
      { maxTokens: 300, temperature: 0.4, timeoutMs: 30000, json: true }
    );
    const parsed = extractJson<{ queries?: string[] }>(text);
    const queries = (parsed?.queries || [])
      .filter((q) => typeof q === 'string' && q.trim())
      .map((q) => q.trim())
      .slice(0, 5);
    return queries.length ? queries : settings.interests.slice(0, 4);
  } catch {
    return settings.interests.slice(0, 4);
  }
}

async function buildPool(
  settings: Settings,
  articles: Article[],
  sources: Source[],
  negative: NegativeItem[]
): Promise<Candidate[]> {
  const readUrls = new Set(
    articles.filter((a) => !a.falsePositive).map((a) => normalizeUrl(a.url))
  );
  const negativeUrls = new Set(negative.map((n) => normalizeUrl(n.url)));

  const recentDigests = await getRecentDigests(30);
  const pushedUrls = new Set<string>();
  for (const digest of recentDigests) {
    for (const pick of digest.picks) pushedUrls.add(normalizeUrl(pick.url));
  }

  const tasks: Array<Promise<Candidate[]>> = sources
    .filter((source) => source.enabled)
    .map(async (source) => {
      try {
        return await fetchSourceCandidates(source);
      } catch {
        return [];
      }
    });

  const queries = await generateQueries(settings, articles);
  for (const query of queries.slice(0, 4)) {
    tasks.push(
      (async () => {
        try {
          return await fetchHNCandidates(query);
        } catch {
          return [];
        }
      })()
    );
    tasks.push(
      (async () => {
        try {
          return await fetchArxivCandidates(`all:${query}`);
        } catch {
          return [];
        }
      })()
    );
  }

  const results = await Promise.allSettled(tasks);
  const pool = new Map<string, Candidate>();

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const candidate of result.value) {
      if (!candidate.url || !candidate.title) continue;
      const key = normalizeUrl(candidate.url);
      if (readUrls.has(key) || negativeUrls.has(key) || pushedUrls.has(key)) continue;
      if (!pool.has(key)) {
        pool.set(key, { ...candidate, url: key });
      }
    }
  }

  return Array.from(pool.values()).slice(0, 60);
}

interface LlmPick {
  index?: number;
  url?: string;
  reason?: string;
  estimatedMinutes?: number;
}

async function rankWithLLM(
  settings: Settings,
  articles: Article[],
  negative: NegativeItem[],
  candidates: Candidate[]
): Promise<DigestPick[]> {
  const count = settings.digestCount;
  const list = candidates
    .slice(0, 40)
    .map(
      (c, index) =>
        `#${index} [${c.source}] ${c.title}\n  URL: ${c.url}\n  ${
          c.excerpt ? `摘要: ${c.excerpt.slice(0, 160)}` : ''
        }`
    )
    .join('\n');

  const disliked = negative
    .slice(-10)
    .map((n) => n.title || n.url)
    .join('; ');

  const isNewUser = articles.length < 5;
  const newUserNote = isNewUser
    ? '\n\n[NEW USER] This user has almost no reading history yet. Act like a great editor: pick genuinely interesting, well-written pieces around their stated interests. Do NOT pretend to personalise.'
    : '';

  const prompt =
    `User's recent reading (past 7 days, sorted by dwell time):\n${formatHistory(articles)}\n\n` +
    `User's interest tags: ${settings.interests.join(', ')}\n` +
    `User explicitly dislikes: ${disliked || 'nothing recorded'}\n\n` +
    `Candidate articles:\n${list}\n\n` +
    `Task:\n` +
    `1. Pick up to ${count} articles the user would love but has not read.\n` +
    `2. For each pick, write a 2-sentence reason in Chinese that connects to their actual reading history (not generic keywords).\n` +
    `3. Prefer mix: deep technical pieces, essays, and one serendipity pick.\n` +
    `4. index must be an integer from the candidate list.\n` +
    `Return JSON: {"picks":[{"index":0,"reason":"...","estimatedMinutes":6}]}` +
    newUserNote;

  // JSON 解析失败时重试一次，再失败交给调用方降级到规则推荐。
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await callLLM(
      settings,
      [
        {
          role: 'system',
          content:
            'You are Peruse, a thoughtful reading curator. You choose articles a specific person will actually read. ' +
            'Be honest: if the candidate pool is weak, recommend fewer than requested instead of padding. ' +
            'Return ONLY valid JSON.',
        },
        {
          role: 'user',
          content:
            prompt +
            (attempt > 0 ? '\n\nIMPORTANT: output ONLY the JSON object, no prose or explanation.' : ''),
        },
      ],
      { maxTokens: 1600, temperature: 0.5, timeoutMs: 60000, json: true }
    );

    const parsed = extractJson<{ picks?: LlmPick[] }>(text);
    const picks = parsed?.picks;
    if (!Array.isArray(picks) || picks.length === 0) continue;

    const seen = new Set<number>();
    const result: DigestPick[] = [];
    for (const pick of picks) {
      const index =
        typeof pick.index === 'number'
          ? pick.index
          : candidates.findIndex((c) => pick.url && normalizeUrl(c.url) === normalizeUrl(pick.url));
      if (index < 0 || index >= candidates.length || seen.has(index)) continue;
      seen.add(index);
      const candidate = candidates[index];
      result.push({
        url: candidate.url,
        title: candidate.title,
        source: candidate.source,
        reason: (pick.reason || '与你近期的阅读兴趣相关').slice(0, 240),
        estimatedMinutes: Math.min(
          60,
          Math.max(1, Math.round(Number(pick.estimatedMinutes) || estimateMinutes(candidate)))
        ),
        status: 'unread',
      });
      if (result.length >= count) break;
    }
    if (result.length > 0) return result;
  }

  return [];
}

function fallbackRank(
  settings: Settings,
  articles: Article[],
  candidates: Candidate[]
): DigestPick[] {
  const interestTokens = tokenize(settings.interests.join(' '));
  const historyTokens = tokenize(articles.map((a) => a.title).join(' '));
  const count = settings.digestCount;

  const scored = candidates
    .map((candidate) => {
      const tokens = tokenize(`${candidate.title} ${candidate.excerpt || ''}`);
      let score = overlap(tokens, historyTokens) * 2 + overlap(tokens, interestTokens) * 3;
      if (candidate.source === 'Hacker News' || candidate.source.startsWith('HN')) score += 1;
      if (candidate.source === 'arXiv') score += 0.5;
      if (candidate.publishedAt) {
        const ageDays = (Date.now() - candidate.publishedAt) / (24 * 60 * 60 * 1000);
        if (ageDays < 3) score += 1.5;
        else if (ageDays < 14) score += 0.5;
      }
      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score);

  const bestMatchFor = (candidate: Candidate): Article | undefined => {
    const tokens = tokenize(candidate.title);
    let best: { article: Article; score: number } | undefined;
    for (const article of articles) {
      const score = overlap(tokens, tokenize(article.title));
      if (!best || score > best.score) best = { article, score };
    }
    return best && best.score > 0 ? best.article : undefined;
  };

  return scored.slice(0, count).map(({ candidate, score }) => {
    const match = bestMatchFor(candidate);
    const reason = match
      ? `与你在 ${match.host} 读过的《${match.title}》相近，适合今晚继续深入。`
      : score > 0
        ? `匹配你的兴趣标签「${settings.interests.slice(0, 3).join('、')}」。`
        : `来自 ${candidate.source} 的高质量候选，适合拓展阅读。`;
    return {
      url: candidate.url,
      title: candidate.title,
      source: candidate.source,
      reason,
      estimatedMinutes: estimateMinutes(candidate),
      status: 'unread' as const,
    };
  });
}

export interface GenerateResult {
  ok: boolean;
  digest?: Digest;
  error?: string;
  alreadyRunning?: boolean;
}

export async function generateDigest(): Promise<GenerateResult> {
  if (running) return { ok: false, alreadyRunning: true, error: '推荐正在生成中' };
  running = true;

  try {
    await setDigestStatus({ state: 'running', message: '正在收集候选文章…' });

    const settings = await getSettings();
    const articles = (await getArticlesSince(Date.now() - 7 * 24 * 60 * 60 * 1000)).filter(
      (a) => !a.falsePositive
    );
    const negative = await dbGetAll<NegativeItem>('negative');
    let sources = (await getSources()).filter((s) => s.enabled);
    if (!sources.length) {
      await seedDefaultSources();
      sources = (await getSources()).filter((s) => s.enabled);
    }

    await setDigestStatus({ state: 'running', message: '正在抓取文章源…' });
    const candidates = await buildPool(settings, articles, sources, negative);
    if (!candidates.length) {
      throw new Error('候选池为空：请检查网络，或在设置里添加更多文章来源');
    }

    await setDigestStatus({
      state: 'running',
      message: `已收集 ${candidates.length} 篇候选，正在排序…`,
    });

    let picks: DigestPick[] = [];
    let fallback = true;
    if (isLlmConfigured(settings)) {
      try {
        picks = await rankWithLLM(settings, articles, negative, candidates);
        fallback = picks.length === 0;
      } catch (error) {
        console.warn('[Peruse] LLM ranking failed, using fallback:', error);
        picks = [];
        fallback = true;
      }
    }
    if (picks.length === 0) {
      picks = fallbackRank(settings, articles, candidates);
      fallback = true;
    }
    if (picks.length === 0) {
      throw new Error('没有找到可推荐的文章');
    }

    const profile = getActiveProfile(settings);
    const preset = getProviderPreset(settings.provider);
    const date = todayString();
    const existing = await getDigestByDate(date);
    const digest: Digest = {
      date,
      picks,
      createdAt: Date.now(),
      provider: isLlmConfigured(settings) ? preset.label : '规则推荐',
      model: isLlmConfigured(settings) ? profile.model : 'keyword-match',
      sourceCount: candidates.length,
      fallback,
    };
    // 注意：id 为 undefined 时不能出现在对象里，否则 IndexedDB 会因 keyPath 取值非法而抛错。
    if (existing?.id !== undefined) digest.id = existing.id;
    const savedKey = await dbPut('digests', digest);
    if (digest.id === undefined && typeof savedKey === 'number') digest.id = savedKey;
    await pruneOldArticles();

    await setDigestStatus({
      state: 'done',
      message: fallback
        ? `已用规则推荐生成 ${picks.length} 篇（配置模型后可获得更精准的个性化推荐）`
        : `今晚为你挑选了 ${picks.length} 篇文章`,
      digestId: digest.id,
      pickCount: picks.length,
      fallback,
    });

    if (settings.notify) {
      try {
        await chrome.notifications.create('peruse-digest', {
          type: 'basic',
          iconUrl: '/icon/128.png',
          title: fallback ? 'Peruse · 规则推荐已生成' : 'Peruse · 今晚的推荐',
          message: `为你挑了 ${picks.length} 篇：${picks[0].title}`,
          priority: 1,
        });
      } catch (error) {
        console.warn('[Peruse] notification failed:', error);
      }
    }

    return { ok: true, digest };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setDigestStatus({ state: 'error', message: `生成失败：${message}` });
    return { ok: false, error: message };
  } finally {
    running = false;
  }
}

export async function dismissPick(
  digest: Digest,
  pick: DigestPick,
  reason: NegativeItem['reason']
): Promise<Digest> {
  await addNegative({
    url: pick.url,
    title: pick.title,
    reason,
    createdAt: Date.now(),
  });
  pick.status = 'dismissed';
  await dbPut('digests', digest);
  return digest;
}
