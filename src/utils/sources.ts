// utils/sources.ts — 文章发现源（HN / arXiv / RSS / 主题 / 自动发现）
import type { Source } from './db';

export interface Candidate {
  url: string;
  title: string;
  source: string;
  excerpt?: string;
  publishedAt?: number;
  score?: number;
}

const HN_API = 'https://hn.algolia.com/api/v1';
const ARXIV_API = 'https://export.arxiv.org/api/query';

function decodeEntities(text: string): string {
  return text
    .split('<![CDATA[').join('')
    .split(']]>').join('')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripHtml(text: string): string {
  return decodeEntities(text)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url: string, timeoutMs = 20000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchHNCandidates(query?: string): Promise<Candidate[]> {
  const url = query
    ? `${HN_API}/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=15`
    : `${HN_API}/search?tags=front_page&hitsPerPage=30`;
  const raw = await fetchText(url);
  const data = JSON.parse(raw) as {
    hits?: Array<{
      objectID: string;
      title?: string;
      url?: string;
      story_text?: string;
      created_at?: string;
      points?: number;
    }>;
  };

  return (data.hits || [])
    .filter((hit) => hit.title)
    .map((hit) => ({
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      title: hit.title || 'Untitled',
      source: query ? `HN · ${query}` : 'Hacker News',
      excerpt: stripHtml(hit.story_text || '').slice(0, 280),
      publishedAt: hit.created_at ? Date.parse(hit.created_at) : undefined,
      score: hit.points || 0,
    }))
    .filter((item) => /^https?:/.test(item.url));
}

export async function fetchArxivCandidates(query?: string): Promise<Candidate[]> {
  const search = query && query.trim() ? query.trim() : 'cat:cs.LG OR cat:cs.SE';
  const url =
    `${ARXIV_API}?search_query=${encodeURIComponent(search)}` +
    '&start=0&max_results=10&sortBy=submittedDate&sortOrder=descending';
  const xml = await fetchText(url);
  const blocks = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];

  return blocks
    .map((block) => {
      const title = stripHtml(extractTag(block, 'title') || 'Untitled');
      const summary = stripHtml(extractTag(block, 'summary') || '').slice(0, 280);
      const id = stripHtml(extractTag(block, 'id') || '');
      const published = extractTag(block, 'published');
      return {
        url: id.replace(/^http:/, 'https:'),
        title,
        source: 'arXiv',
        excerpt: summary,
        publishedAt: published ? Date.parse(published) : undefined,
      };
    })
    .filter((item) => item.url);
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? match[1].trim() : '';
}

function extractLink(block: string): string {
  const atom = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  if (atom) return atom[1];
  const rss = extractTag(block, 'link');
  return rss;
}

export async function fetchRssCandidates(url: string, sourceName: string): Promise<Candidate[]> {
  const xml = await fetchText(url);
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];

  return blocks
    .slice(0, 25)
    .map((block) => {
      const title = stripHtml(extractTag(block, 'title') || 'Untitled');
      const link = extractLink(block);
      const summary = stripHtml(
        extractTag(block, 'description') ||
          extractTag(block, 'summary') ||
          extractTag(block, 'content:encoded') ||
          ''
      ).slice(0, 280);
      const published =
        extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated');
      return {
        url: link,
        title,
        source: sourceName,
        excerpt: summary,
        publishedAt: published ? Date.parse(published) : undefined,
      };
    })
    .filter((item) => /^https?:/.test(item.url));
}

export async function fetchTopicCandidates(query: string): Promise<Candidate[]> {
  const results = await Promise.allSettled([
    fetchHNCandidates(query),
    fetchArxivCandidates(`all:${query}`),
  ]);
  const candidates: Candidate[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') candidates.push(...result.value);
  }
  return candidates;
}

export async function fetchSourceCandidates(source: Source): Promise<Candidate[]> {
  switch (source.type) {
    case 'hn':
      return fetchHNCandidates(source.query);
    case 'arxiv':
      return fetchArxivCandidates(source.query);
    case 'rss':
    case 'auto_discovered':
      return source.url ? fetchRssCandidates(source.url, source.name) : [];
    case 'topic':
    case 'llm_search':
      return source.query ? fetchTopicCandidates(source.query) : [];
    default:
      return [];
  }
}

/** 把页面里的 RSS 自动发现结果做成一个源 */
export function makeAutoSource(feedUrl: string, host: string): Omit<Source, 'id'> {
  return {
    type: 'auto_discovered',
    name: `${host} RSS`,
    url: feedUrl,
    enabled: true,
    autoDetected: true,
    host,
    addedAt: Date.now(),
  };
}
