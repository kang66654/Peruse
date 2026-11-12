// utils/reading.ts — 页面类型判定与多维阅读行为评分
//
// 目标：把「打开过」和「真的读了」区分开，并给出可解释的判定依据。
// 评分只依赖可观测行为（时长、滚动、停顿、交互、切走），不采集正文内容以外的隐私数据。

export type PageKind = 'article' | 'discussion' | 'utility' | 'index' | 'video' | 'unknown';

export interface PageProfile {
  host: string;
  url: string;
  wordCount: number;
  paragraphCount: number;
  avgParagraphChars: number;
  /** 链接文字长度 / 正文长度 */
  linkDensity: number;
  hasArticleTag: boolean;
  /** og:type，例如 article / website / video */
  ogType?: string;
  /** JSON-LD @type，多个用逗号分隔 */
  schemaType?: string;
  textChars: number;
  hasAuthorMeta: boolean;
  /** 是否从 article/main 等正文容器中提取 */
  isMainContent: boolean;
}

export interface PageDecision {
  kind: PageKind;
  isArticle: boolean;
  confidence: number;
  reasons: string[];
}

const UTILITY_PATHS = [
  /(^|\/)(settings?|account|preferences|profile|login|log-?in|signin|sign-?in|signup|register|password|security)\/?(\/|$)/i,
  /(^|\/)(search|feed|feed-home|explore|notifications?|inbox|messages?|cart|checkout|orders?)\/?(\/|$)/i,
  /(^|\/)(tag|tags|category|categories|archive|archives|author|authors|page)\/\d+\/?/i,
];

const DISCUSSION_HOSTS = ['reddit.com', 'www.reddit.com', 'old.reddit.com', 'news.ycombinator.com', 'v2ex.com', 'www.v2ex.com'];
const VIDEO_HOSTS = ['youtube.com', 'www.youtube.com', 'bilibili.com', 'www.bilibili.com', 'douyin.com', 'www.douyin.com', 'vimeo.com'];

function hostMatches(host: string, list: string[]): boolean {
  const h = host.toLowerCase();
  return list.some((entry) => h === entry || h.endsWith(`.${entry.replace(/^www\./, '')}`));
}

export function classifyPage(profile: PageProfile): PageDecision {
  const reasons: string[] = [];
  const host = profile.host.toLowerCase();
  let path = '';
  try {
    path = new URL(profile.url).pathname;
  } catch {
    path = profile.url;
  }

  if (hostMatches(host, VIDEO_HOSTS)) {
    return { kind: 'video', isArticle: false, confidence: 0, reasons: ['视频站点，不计入阅读'] };
  }

  if (hostMatches(host, DISCUSSION_HOSTS) || /\/(comments|discussion|thread)\//i.test(path)) {
    reasons.push('论坛/问答/评论区页面');
    if (host.includes('reddit')) reasons.push('Reddit 帖子与评论页不算文章');
    return { kind: 'discussion', isArticle: false, confidence: 0, reasons };
  }

  if (UTILITY_PATHS.some((rule) => rule.test(path))) {
    reasons.push('设置/账户/搜索/列表类功能页');
    return { kind: 'utility', isArticle: false, confidence: 0, reasons };
  }

  let confidence = 0;
  const schema = (profile.schemaType || '').toLowerCase();
  if (schema.includes('article') || schema.includes('blogposting') || schema.includes('newsarticle')) {
    confidence += 0.5;
    reasons.push('页面声明为 Article');
  }
  if ((profile.ogType || '').toLowerCase() === 'article') {
    confidence += 0.35;
    reasons.push('og:type=article');
  }
  if (profile.hasArticleTag && profile.paragraphCount >= 3) {
    confidence += 0.35;
    reasons.push('存在 article 正文块');
  }
  if (profile.isMainContent && profile.paragraphCount >= 4) confidence += 0.1;
  if (profile.hasAuthorMeta) {
    confidence += 0.1;
    reasons.push('有作者信息');
  }
  if (profile.wordCount >= 800) {
    confidence += 0.15;
  } else if (profile.wordCount >= 300) {
    confidence += 0.08;
  }
  if (profile.paragraphCount >= 5 && profile.avgParagraphChars >= 80) {
    confidence += 0.15;
    reasons.push(`正文 ${profile.paragraphCount} 段`);
  }
  if (profile.linkDensity > 0.55) {
    confidence -= 0.45;
    reasons.push('链接密度过高，更像列表页');
  } else if (profile.linkDensity > 0.4) {
    confidence -= 0.2;
  } else if (profile.linkDensity <= 0.2 && profile.textChars >= 1000) {
    confidence += 0.1;
  }
  if (profile.wordCount < 200) confidence -= 0.3;

  confidence = Math.max(0, Math.min(1, confidence));

  const kind: PageKind = confidence >= 0.55 ? 'article' : profile.linkDensity > 0.45 ? 'index' : 'unknown';
  const isArticle = kind === 'article' && profile.wordCount >= 200;

  if (!isArticle) {
    if (kind === 'index') reasons.push('判定为列表/索引页');
    else if (reasons.length === 0) reasons.push('缺少文章特征');
  }

  return { kind, isArticle, confidence: Math.round(confidence * 100) / 100, reasons };
}

export interface TimelinePoint {
  /** 相对会话开始的秒数 */
  t: number;
  /** 0-1 滚动深度 */
  depth: number;
}

export type ReadingVerdict = 'deep' | 'skim' | 'glance' | 'bounce';

export interface SessionMetrics {
  visibleSec: number;
  hiddenSec: number;
  idleSec: number;
  editingSec: number;
  maxDepth: number;
  scrollEvents: number;
  scrollDistancePx: number;
  avgScrollSpeed: number;
  maxScrollSpeed: number;
  directionChanges: number;
  pauseCount: number;
  avgPauseSec: number;
  mouseMoves: number;
  clicks: number;
  keyPresses: number;
  selectionCount: number;
  selectedChars: number;
  copyCount: number;
  visibilityChanges: number;
  focusLossCount: number;
  wordCount: number;
  timeline: TimelinePoint[];
}

export interface ReadingSignals extends SessionMetrics {
  sessionId: string;
  url: string;
  title: string;
  host: string;
  startedAt: number;
  endedAt: number;
  estimatedReadSec: number;
  engagementScore: number;
  verdict: ReadingVerdict;
  reasons: string[];
  pageKind: PageKind;
  pageConfidence: number;
  qualified: boolean;
}

/** 计算预计阅读时长（秒）：中文按 300 字/分钟，英文词按 250 词/分钟粗估 */
export function estimateReadSec(wordCount: number): number {
  return Math.round(Math.min(900, Math.max(30, (wordCount / 300) * 60)));
}

export function computeEngagement(metrics: SessionMetrics, decision: PageDecision): {
  score: number;
  verdict: ReadingVerdict;
  reasons: string[];
  qualified: boolean;
} {
  const reasons: string[] = [];
  const estimated = estimateReadSec(metrics.wordCount);
  const total = metrics.visibleSec + metrics.hiddenSec + metrics.idleSec;
  const dwellRatio = estimated > 0 ? metrics.visibleSec / estimated : 0;
  const hiddenRatio = total > 0 ? metrics.hiddenSec / total : 0;
  const idleRatio = metrics.visibleSec > 0 ? metrics.idleSec / metrics.visibleSec : 0;

  let score = 0;

  // 1. 停留时长 25%：接近预计阅读时长才算投入
  if (dwellRatio >= 0.35 && dwellRatio <= 2.5) {
    score += 0.25;
    reasons.push(`停留 ${formatSeconds(metrics.visibleSec)}，接近预计阅读时长`);
  } else if (dwellRatio >= 0.2 && dwellRatio < 0.35) {
    score += 0.12;
    reasons.push('停留偏短');
  } else if (dwellRatio > 2.5) {
    score += 0.1;
    reasons.push('停留时间远超正文长度，可能挂着页面');
  } else if (metrics.visibleSec >= 15) {
    score += 0.04;
  }

  // 2. 滚动深度 20%
  if (metrics.maxDepth >= 0.85) {
    score += 0.2;
    reasons.push(`滚动到 ${Math.round(metrics.maxDepth * 100)}%`);
  } else if (metrics.maxDepth >= 0.6) {
    score += 0.15;
    reasons.push(`滚动到 ${Math.round(metrics.maxDepth * 100)}%`);
  } else if (metrics.maxDepth >= 0.35) {
    score += 0.08;
  } else if (metrics.maxDepth > 0) {
    score += 0.03;
    reasons.push('刚开头就离开');
  }

  // 3. 滚动节奏 20%：有停顿说明在阅读，而不是一路刷到底
  if (metrics.pauseCount >= 2 && metrics.avgPauseSec >= 3 && metrics.avgPauseSec <= 30) {
    score += 0.2;
    reasons.push(`${metrics.pauseCount} 次阅读停顿`);
  } else if (metrics.pauseCount >= 1) {
    score += 0.12;
  } else if (metrics.scrollEvents >= 3) {
    score += 0.06;
  } else if (metrics.scrollEvents === 0 && dwellRatio >= 0.5) {
    score += 0.1;
    reasons.push('未滚动但持续停留，可能是短文');
  }
  if (metrics.directionChanges >= 3) {
    score += 0.03;
    reasons.push('有回读动作');
  }

  // 4. 交互质量 18%
  let interaction = 0;
  if (metrics.copyCount > 0) {
    interaction += 0.08;
    reasons.push(`复制 ${metrics.copyCount} 次`);
  }
  if (metrics.selectionCount > 0) {
    interaction += 0.06;
    reasons.push(`选中共 ${metrics.selectedChars} 字`);
  }
  if (metrics.keyPresses >= 3) interaction += 0.04;
  if (metrics.clicks >= 2) interaction += 0.03;
  if (metrics.mouseMoves >= 10) interaction += 0.03;
  score += Math.min(0.18, interaction);

  // 5. 注意力连续性 17%：切走、长时间无操作都会扣分
  if (hiddenRatio > 0.4 && metrics.hiddenSec > 30) {
    reasons.push(`中途切走 ${formatSeconds(metrics.hiddenSec)}`);
  } else if (hiddenRatio > 0.15) {
    score += 0.04;
  } else {
    score += 0.09;
  }
  if (idleRatio > 0.5 && metrics.idleSec > 60) {
    reasons.push(`长时间无操作 ${formatSeconds(metrics.idleSec)}`);
  } else if (idleRatio > 0.3) {
    score += 0.03;
  } else {
    score += 0.08;
  }
  if (metrics.visibilityChanges === 0 && metrics.focusLossCount === 0) score += 0.02;

  score = Math.round(Math.min(1, score) * 100) / 100;

  let verdict: ReadingVerdict;
  if (score >= 0.7 && metrics.maxDepth >= 0.7 && hiddenRatio < 0.25) verdict = 'deep';
  else if (score >= 0.45) verdict = 'skim';
  else if (score >= 0.22) verdict = 'glance';
  else verdict = 'bounce';

  if (verdict === 'bounce' && reasons.length === 0) reasons.push('几乎没有有效阅读行为');
  if (metrics.maxDepth === 0 && metrics.scrollEvents === 0 && metrics.visibleSec < 20) {
    reasons.push('未滚动且迅速离开');
  }

  const qualified =
    decision.isArticle &&
    decision.confidence >= 0.55 &&
    metrics.wordCount >= 200 &&
    metrics.visibleSec >= 15 &&
    score >= 0.45 &&
    verdict !== 'glance' &&
    verdict !== 'bounce';

  return { score, verdict, reasons, qualified };
}

export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  const minutes = Math.round((seconds / 60) * 10) / 10;
  return `${minutes} 分钟`;
}

export function verdictLabel(verdict: ReadingVerdict): string {
  switch (verdict) {
    case 'deep':
      return '深读';
    case 'skim':
      return '略读';
    case 'glance':
      return '扫读';
    default:
      return '跳过';
  }
}
