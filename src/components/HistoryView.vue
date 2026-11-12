<template>
  <div class="history">
    <div class="filters">
      <select v-model.number="range" class="select">
        <option :value="7">最近 7 天</option>
        <option :value="30">最近 30 天</option>
        <option :value="0">全部时间</option>
      </select>
      <select v-model="hostFilter" class="select">
        <option value="">全部站点</option>
        <option v-for="host in hosts" :key="host" :value="host">{{ host }}</option>
      </select>
      <input v-model="search" class="search" placeholder="搜索文章标题或站点..." />
    </div>

    <template v-if="filtered.length">
      <div class="table-card">
        <div class="table-scroll">
          <table class="table">
            <thead>
              <tr>
                <th class="col-title">文章</th>
                <th class="col-host">站点</th>
                <th class="col-time">阅读时长</th>
                <th class="col-score">判定</th>
                <th class="col-date">阅读时间</th>
                <th class="col-star">收藏</th>
                <th class="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="article in visible" :key="article.url">
                <tr :class="{ flagged: article.falsePositive }">
                  <td class="col-title">
                    <button class="article-title" @click="openUrl(article.url)">{{ article.title }}</button>
                    <div class="article-url">{{ article.url }}</div>
                  </td>
                  <td class="col-host">
                    <span class="host">{{ article.host }}</span>
                  </td>
                  <td class="col-time nowrap">
                    {{ formatDuration(article.lastSessionSec || article.visibleTime) }}
                  </td>
                  <td class="col-score">
                    <span class="badge" :class="verdictClass(article)" :title="`综合评分 ${Math.round((article.readingScore || 0) * 100)}`">
                      {{ verdictText(article) }}
                    </span>
                  </td>
                  <td class="col-date nowrap">{{ formatDate(article.readAt) }}</td>
                  <td class="col-star">
                    <button
                      class="star-btn"
                      :class="{ on: article.starred }"
                      :title="article.starred ? '取消收藏' : '收藏'"
                      @click="toggleStar(article)"
                    >
                      {{ article.starred ? '★' : '☆' }}
                    </button>
                  </td>
                  <td class="col-actions">
                    <div class="row-actions">
                      <button
                        class="icon-btn"
                        :class="{ active: expanded.includes(article.url) }"
                        :title="expanded.includes(article.url) ? '收起行为详情' : '查看行为详情'"
                        @click="toggleDetail(article.url)"
                      >
                        ▤
                      </button>
                      <button
                        class="icon-btn"
                        v-if="!article.falsePositive"
                        title="这篇我没读"
                        @click="flagFalsePositive(article)"
                      >
                        ✕
                      </button>
                      <span v-else class="tiny">已反馈</span>
                      <button class="icon-btn danger" title="删除记录" @click="remove(article)">
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
                <tr v-if="expanded.includes(article.url)" class="detail-row">
                  <td colspan="7">
                    <div class="detail">
                      <div class="detail-head">
                        <span class="detail-title">阅读行为轨迹</span>
                        <span class="detail-page" v-if="article.pageKind">
                          页面判定：{{ kindLabel(article.pageKind) }}
                          <template v-if="article.pageConfidence !== undefined">
                            · 置信度 {{ Math.round(article.pageConfidence * 100) }}%
                          </template>
                        </span>
                      </div>

                      <div class="detail-grid" v-if="article.signals">
                        <div class="stat"><span class="k">可见停留</span><b>{{ formatDuration(article.signals.visibleSec) }}</b></div>
                        <div class="stat"><span class="k">切走时长</span><b>{{ formatDuration(article.signals.hiddenSec) }}</b></div>
                        <div class="stat"><span class="k">空闲时长</span><b>{{ formatDuration(article.signals.idleSec) }}</b></div>
                        <div class="stat"><span class="k">编辑时长</span><b>{{ formatDuration(article.signals.editingSec) }}</b></div>
                        <div class="stat"><span class="k">滚动深度</span><b>{{ Math.round(article.signals.maxDepth * 100) }}%</b></div>
                        <div class="stat"><span class="k">滚动次数</span><b>{{ article.signals.scrollEvents }} 次</b></div>
                        <div class="stat"><span class="k">滚动距离</span><b>{{ article.signals.scrollDistancePx }} px</b></div>
                        <div class="stat"><span class="k">滚动速度</span><b>均 {{ article.signals.avgScrollSpeed }} / 峰 {{ article.signals.maxScrollSpeed }} px/s</b></div>
                        <div class="stat"><span class="k">方向变化</span><b>{{ article.signals.directionChanges }} 次</b></div>
                        <div class="stat"><span class="k">阅读停顿</span><b>{{ article.signals.pauseCount }} 次 · 均 {{ article.signals.avgPauseSec }}s</b></div>
                        <div class="stat"><span class="k">拖选</span><b>{{ article.signals.selectionCount }} 次 · {{ article.signals.selectedChars }} 字</b></div>
                        <div class="stat"><span class="k">复制</span><b>{{ article.signals.copyCount }} 次</b></div>
                        <div class="stat"><span class="k">鼠标 / 点击 / 按键</span><b>{{ article.signals.mouseMoves }} / {{ article.signals.clicks }} / {{ article.signals.keyPresses }}</b></div>
                        <div class="stat"><span class="k">切走 / 失焦</span><b>{{ article.signals.visibilityChanges }} / {{ article.signals.focusLossCount }} 次</b></div>
                        <div class="stat"><span class="k">正文长度</span><b>{{ article.signals.wordCount }} 字</b></div>
                        <div class="stat"><span class="k">综合评分</span><b>{{ Math.round((article.readingScore || 0) * 100) }} / 100</b></div>
                      </div>
                      <div class="detail-empty" v-else>
                        这条记录来自旧版本，只保留了基础统计；新阅读会记录完整行为明细。
                      </div>

                      <div class="reason-list" v-if="article.signals?.reasons?.length">
                        <span class="reason" v-for="(reason, idx) in article.signals.reasons" :key="idx">{{ reason }}</span>
                      </div>

                      <div class="detail-actions">
                        <button
                          class="detail-btn"
                          :disabled="loadingSessions === article.url"
                          @click="loadSessions(article.url)"
                        >
                          {{ loadingSessions === article.url ? '加载中…' : '查看原始会话记录' }}
                        </button>
                      </div>

                      <div class="session-list" v-if="sessionsMap[article.url]?.length">
                        <div class="session" v-for="s in sessionsMap[article.url]" :key="s.sessionId">
                          <div class="session-head">
                            <b>{{ verdictLabel(s.verdict) }}</b>
                            <span>{{ formatDate(s.startedAt) }}</span>
                            <span>停留 {{ formatDuration(s.visibleSec) }}</span>
                            <span>评分 {{ Math.round(s.engagementScore * 100) }}</span>
                          </div>
                          <div class="session-meta">
                            滚动 {{ s.scrollEvents }} 次 / {{ s.scrollDistancePx }}px · 停顿 {{ s.pauseCount }} 次 ·
                            复制 {{ s.copyCount }} 次 · 选中 {{ s.selectedChars }} 字 · 切走 {{ formatDuration(s.hiddenSec) }} ·
                            空闲 {{ formatDuration(s.idleSec) }}
                          </div>
                          <div class="spark" v-if="s.timeline.length">
                            <span
                              v-for="(bar, idx) in sparkBars(s.timeline)"
                              :key="idx"
                              class="spark-bar"
                              :style="{ height: bar }"
                              :title="`${s.timeline[idx].t}s · ${Math.round(s.timeline[idx].depth * 100)}%`"
                            ></span>
                          </div>
                          <div class="reason-list" v-if="s.reasons.length">
                            <span class="reason" v-for="(r, idx) in s.reasons" :key="idx">{{ r }}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
      <div class="table-foot">
        共 {{ filtered.length }} 条记录
        <span v-if="filtered.length > visible.length">（显示最近 {{ visible.length }} 条）</span>
      </div>
    </template>

    <div class="empty-card" v-else>
      <div class="empty-icon">{{ articles.length ? '🔍' : '📖' }}</div>
      <div class="empty-title">
        {{ articles.length ? '没有符合条件的阅读记录' : '还没有阅读记录' }}
      </div>
      <div class="empty-desc">
        {{
          articles.length
            ? '试试调整筛选条件，或清除筛选以查看全部记录。'
            : '打开一篇长文并停留一会儿，记录会自动出现在这里。'
        }}
      </div>
      <button v-if="articles.length" class="empty-btn" @click="resetFilters">清除筛选</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { dbPut, deleteArticle, getAllArticles, getSessionsByUrl, type Article } from '../utils/db';
import { verdictLabel, type PageKind, type ReadingSignals, type TimelinePoint } from '../utils/reading';

const articles = ref<Article[]>([]);
const search = ref('');
const hostFilter = ref('');
const range = ref(30);
const expanded = ref<string[]>([]);
const sessionsMap = ref<Record<string, ReadingSignals[]>>({});
const loadingSessions = ref('');

const hosts = computed(() =>
  Array.from(new Set(articles.value.map((article) => article.host))).sort()
);

const filtered = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  const since = range.value ? Date.now() - range.value * 24 * 60 * 60 * 1000 : 0;
  return articles.value
    .filter((article) => article.readAt >= since)
    .filter((article) => !hostFilter.value || article.host === hostFilter.value)
    .filter(
      (article) =>
        !keyword ||
        article.title.toLowerCase().includes(keyword) ||
        article.host.toLowerCase().includes(keyword)
    );
});

const visible = computed(() => filtered.value.slice(0, 200));

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

function formatDate(ts: number): string {
  const date = new Date(ts);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${String(
    date.getHours()
  ).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function verdictText(article: Article): string {
  if (article.verdict) return verdictLabel(article.verdict);
  return legacyLabel(article.readingScore || 0);
}

function verdictClass(article: Article): string {
  if (article.verdict) {
    if (article.verdict === 'deep') return 'success';
    if (article.verdict === 'bounce') return 'low';
    return 'muted';
  }
  return legacyClass(article.readingScore || 0);
}

function legacyLabel(score: number): string {
  if (score >= 0.6) return '认真读';
  if (score >= 0.3) return '路过';
  return '低';
}

function legacyClass(score: number): string {
  if (score >= 0.6) return 'success';
  if (score >= 0.3) return 'muted';
  return 'low';
}

function kindLabel(kind: PageKind): string {
  switch (kind) {
    case 'article':
      return '文章';
    case 'discussion':
      return '讨论区';
    case 'utility':
      return '功能页';
    case 'index':
      return '列表页';
    case 'video':
      return '视频';
    default:
      return '未判定';
  }
}

function toggleDetail(url: string) {
  expanded.value = expanded.value.includes(url)
    ? expanded.value.filter((item) => item !== url)
    : [...expanded.value, url];
}

async function loadSessions(url: string) {
  if (sessionsMap.value[url]) {
    const next = { ...sessionsMap.value };
    delete next[url];
    sessionsMap.value = next;
    return;
  }
  loadingSessions.value = url;
  try {
    const list = await getSessionsByUrl(url);
    sessionsMap.value = { ...sessionsMap.value, [url]: list };
  } finally {
    loadingSessions.value = '';
  }
}

function sparkBars(timeline: TimelinePoint[]): string[] {
  return timeline.map((point) => `${Math.max(6, Math.round(point.depth * 100))}%`);
}

function resetFilters() {
  search.value = '';
  hostFilter.value = '';
  range.value = 30;
}

function openUrl(url: string) {
  void chrome.tabs.create({ url });
}

async function toggleStar(article: Article) {
  article.starred = !article.starred;
  await dbPut('articles', article);
}

async function flagFalsePositive(article: Article) {
  article.falsePositive = true;
  await dbPut('articles', article);
}

async function remove(article: Article) {
  if (!window.confirm(`删除《${article.title}》的阅读记录？`)) return;
  await deleteArticle(article.url);
  articles.value = articles.value.filter((item) => item.url !== article.url);
}

onMounted(async () => {
  articles.value = await getAllArticles();
});
</script>

<style scoped>
.history {
  width: 100%;
}
.filters {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.select {
  flex: 0 0 auto;
  width: auto;
  padding: 8px 12px;
  border: 1px solid var(--peruse-border);
  border-radius: 8px;
  background: #fff;
  color: var(--peruse-text);
  font-size: 13px;
  outline: none;
}
.select:focus {
  border-color: var(--peruse-secondary);
  box-shadow: 0 0 0 3px rgba(170, 160, 239, 0.18);
}
.search {
  flex: 1 1 200px;
  min-width: 180px;
  padding: 8px 12px;
  border: 1px solid var(--peruse-border);
  border-radius: 8px;
  background: #fff;
  color: var(--peruse-text);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.search::placeholder {
  color: var(--peruse-faint);
}
.search:focus {
  border-color: var(--peruse-secondary);
  box-shadow: 0 0 0 3px rgba(170, 160, 239, 0.18);
}
.table-card {
  background: #fff;
  border: 1px solid var(--peruse-border);
  border-radius: 12px;
  overflow: hidden;
}
.table-scroll {
  overflow-x: auto;
}
.table {
  width: 100%;
  min-width: 820px;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 14px;
}
.table th {
  background: var(--peruse-bg);
  padding: 14px 16px;
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  color: var(--peruse-muted);
  white-space: nowrap;
}
.table td {
  padding: 14px 16px;
  border-top: 1px solid #f0edf5;
  vertical-align: middle;
}
.table tbody tr:hover {
  background: #fcfbff;
}
.table tr.flagged {
  opacity: 0.55;
}
.col-title {
  width: auto;
}
.article-title {
  display: block;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--peruse-text);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.article-title:hover {
  color: var(--peruse-primary);
}
.article-url {
  font-size: 11px;
  color: var(--peruse-faint);
  max-width: 100%;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.col-host {
  width: 140px;
}
.host {
  font-size: 13px;
  color: var(--peruse-muted);
}
.col-time {
  width: 100px;
  font-size: 13px;
}
.col-score {
  width: 84px;
}
.col-date {
  width: 170px;
  font-size: 13px;
  color: var(--peruse-muted);
}
.col-star {
  width: 64px;
}
.col-actions {
  width: 104px;
}
.nowrap {
  white-space: nowrap;
}
.badge.low {
  background: #f1f0f6;
  color: var(--peruse-faint);
}
.icon-btn.active {
  background: var(--peruse-primary-weak);
  color: var(--peruse-primary);
}
.detail-row td {
  background: #faf9ff;
  padding: 0 16px 16px;
}
.detail {
  border: 1px solid var(--peruse-border);
  border-radius: 10px;
  background: #fff;
  padding: 14px 16px;
}
.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}
.detail-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--peruse-text);
}
.detail-page {
  font-size: 11px;
  color: var(--peruse-muted);
}
.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px 16px;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
}
.stat .k {
  color: var(--peruse-muted);
}
.stat b {
  font-size: 12px;
  font-weight: 600;
  color: var(--peruse-text);
}
.detail-empty {
  font-size: 12px;
  color: var(--peruse-muted);
}
.reason-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.reason {
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--peruse-primary-weak);
  color: var(--peruse-primary);
  font-size: 11px;
}
.detail-actions {
  margin-top: 12px;
}
.detail-btn {
  padding: 6px 12px;
  border: 1px solid var(--peruse-border);
  border-radius: 8px;
  background: #fff;
  color: var(--peruse-muted);
  font-size: 12px;
  cursor: pointer;
}
.detail-btn:hover {
  border-color: var(--peruse-secondary);
  color: var(--peruse-primary);
}
.session-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}
.session {
  border-top: 1px dashed var(--peruse-border);
  padding-top: 10px;
}
.session-head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: var(--peruse-muted);
}
.session-head b {
  color: var(--peruse-text);
}
.session-meta {
  margin-top: 4px;
  font-size: 11px;
  color: var(--peruse-muted);
}
.spark {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  height: 42px;
  margin-top: 8px;
}
.spark-bar {
  flex: 1 1 0;
  min-width: 2px;
  max-width: 8px;
  border-radius: 2px 2px 0 0;
  background: var(--peruse-primary-weak);
}
.star-btn {
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #c9c4dc;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: background 0.15s ease, color 0.15s ease;
}
.star-btn:hover {
  background: var(--peruse-primary-weak);
  color: var(--peruse-primary);
}
.star-btn.on {
  color: var(--peruse-yellow);
}
.row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: flex-end;
}
.icon-btn {
  border: 0;
  background: transparent;
  cursor: pointer;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--peruse-faint);
  font-size: 13px;
  display: grid;
  place-items: center;
}
.icon-btn:hover {
  background: var(--peruse-primary-weak);
  color: var(--peruse-primary);
}
.icon-btn.danger:hover {
  background: #fdeceb;
  color: var(--peruse-danger);
}
.tiny {
  font-size: 10px;
  color: var(--peruse-faint);
  white-space: nowrap;
}
.table-foot {
  margin-top: 8px;
  font-size: 12px;
  color: var(--peruse-muted);
}
.empty-card {
  background: #fff;
  border: 1px solid var(--peruse-border);
  border-radius: 12px;
  padding: 60px 20px;
  text-align: center;
}
.empty-icon {
  font-size: 48px;
  line-height: 1;
  margin-bottom: 16px;
  opacity: 0.5;
}
.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--peruse-text);
  margin-bottom: 8px;
}
.empty-desc {
  font-size: 13px;
  color: var(--peruse-muted);
  margin-bottom: 20px;
}
.empty-btn {
  padding: 10px 20px;
  border: 1px solid var(--peruse-border);
  border-radius: 8px;
  background: #fff;
  color: var(--peruse-text);
  font-size: 13px;
  cursor: pointer;
}
.empty-btn:hover {
  border-color: var(--peruse-secondary);
  color: var(--peruse-primary);
}
@media (max-width: 760px) {
  .filters {
    gap: 8px;
  }
  .select,
  .search {
    flex: 1 1 140px;
  }
  .table {
    font-size: 12px;
  }
  .table th,
  .table td {
    padding: 8px 10px;
  }
}
</style>
