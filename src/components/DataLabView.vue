<template>
  <div class="lab">
    <div class="test-note">
      <b>测试版采集</b>
      <span>本页只在此测试版保留，用于收集真实阅读行为、校准「什么才算读了一篇文章」。数据仅存本机，可随时导出。</span>
    </div>

    <div class="filters">
      <select v-model.number="range" class="select">
        <option :value="7">最近 7 天</option>
        <option :value="30">最近 30 天</option>
        <option :value="0">全部时间</option>
      </select>
      <select v-model="verdictFilter" class="select">
        <option value="">全部判定</option>
        <option v-for="verdict in VERDICTS" :key="verdict" :value="verdict">
          {{ verdictLabel(verdict) }}
        </option>
      </select>
      <select v-model="kindFilter" class="select">
        <option value="">全部页面类型</option>
        <option v-for="kind in KINDS" :key="kind" :value="kind">{{ kindLabel(kind) }}</option>
      </select>
      <button class="btn ghost" @click="reload">刷新</button>
      <div class="spacer"></div>
      <button class="btn" @click="exportJson">导出 JSON</button>
      <button class="btn" @click="exportCsv">导出 CSV</button>
    </div>

    <div class="cards">
      <div class="card">
        <span class="k">会话总数</span>
        <b>{{ filtered.length }}</b>
        <span class="sub">文章页 {{ articleSessions }} 条</span>
      </div>
      <div class="card">
        <span class="k">合格阅读</span>
        <b>{{ qualifiedCount }}</b>
        <span class="sub">合格率 {{ qualifiedRate }}%</span>
      </div>
      <div class="card">
        <span class="k">平均可见停留</span>
        <b>{{ formatSeconds(avgVisible) }}</b>
        <span class="sub">平均滚动深度 {{ avgDepth }}%</span>
      </div>
      <div class="card">
        <span class="k">平均滚动速度</span>
        <b>{{ avgSpeed }} px/s</b>
        <span class="sub">平均停顿 {{ avgPause }} 次</span>
      </div>
      <div class="card">
        <span class="k">误读反馈</span>
        <b>{{ falsePositiveCount }}</b>
        <span class="sub">共 {{ articles.length }} 条文章记录</span>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">
        <h3>判定分布</h3>
        <span class="hint">用于观察阈值是否过松/过严</span>
      </div>
      <div class="dist">
        <div class="dist-row" v-for="row in verdictDist" :key="row.key">
          <span class="dist-label">{{ row.label }}</span>
          <div class="bar"><span :class="row.cls" :style="{ width: `${row.pct}%` }"></span></div>
          <span class="dist-num">{{ row.count }} · {{ row.pct }}%</span>
        </div>
      </div>

      <div class="panel-title spaced">
        <h3>页面类型分布</h3>
        <span class="hint">功能页/讨论页应为 0 条文章记录</span>
      </div>
      <div class="dist">
        <div class="dist-row" v-for="row in kindDist" :key="row.key">
          <span class="dist-label">{{ row.label }}</span>
          <div class="bar"><span class="fill muted" :style="{ width: `${row.pct}%` }"></span></div>
          <span class="dist-num">{{ row.count }} · {{ row.pct }}%</span>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">
        <h3>各判定的平均行为</h3>
        <span class="hint">看「跳过 / 扫读」与「深读」的指标差距</span>
      </div>
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>判定</th>
              <th>会话</th>
              <th>停留</th>
              <th>滚动深度</th>
              <th>滚动次数</th>
              <th>平均速度</th>
              <th>停顿</th>
              <th>有复制的会话</th>
              <th>切走</th>
              <th>空闲</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in verdictStats" :key="row.key">
              <td><span class="badge" :class="row.cls">{{ row.label }}</span></td>
              <td>{{ row.count }}</td>
              <td>{{ formatSeconds(row.visible) }}</td>
              <td>{{ row.depth }}%</td>
              <td>{{ row.scrolls }}</td>
              <td>{{ row.speed }} px/s</td>
              <td>{{ row.pauses }} 次</td>
              <td>{{ row.copyRate }}%</td>
              <td>{{ formatSeconds(row.hidden) }}</td>
              <td>{{ formatSeconds(row.idle) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">
        <h3>最近会话（原始数据）</h3>
        <span class="hint">显示最近 {{ recent.length }} 条，完整数据请导出</span>
      </div>
      <div class="table-scroll">
        <table class="table wide">
          <thead>
            <tr>
              <th>时间</th>
              <th>判定</th>
              <th>类型</th>
              <th>标题</th>
              <th>停留</th>
              <th>深度</th>
              <th>滚动</th>
              <th>速度</th>
              <th>停顿</th>
              <th>鼠标/点击/按键</th>
              <th>复制/选中</th>
              <th>切走</th>
              <th>空闲</th>
              <th>评分</th>
              <th>合格</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="session in recent" :key="session.sessionId">
              <td class="nowrap">{{ formatDate(session.startedAt) }}</td>
              <td><span class="badge" :class="verdictClass(session.verdict)">{{ verdictLabel(session.verdict) }}</span></td>
              <td>{{ kindLabel(session.pageKind) }}</td>
              <td class="title-cell" :title="session.title">{{ session.title }}</td>
              <td class="nowrap">{{ formatSeconds(session.visibleSec) }}</td>
              <td>{{ Math.round(session.maxDepth * 100) }}%</td>
              <td>{{ session.scrollEvents }} 次 / {{ session.scrollDistancePx }}px</td>
              <td>{{ session.avgScrollSpeed }} px/s</td>
              <td>{{ session.pauseCount }} 次</td>
              <td>{{ session.mouseMoves }} / {{ session.clicks }} / {{ session.keyPresses }}</td>
              <td>{{ session.copyCount }} / {{ session.selectedChars }} 字</td>
              <td>{{ formatSeconds(session.hiddenSec) }}</td>
              <td>{{ formatSeconds(session.idleSec) }}</td>
              <td>{{ Math.round(session.engagementScore * 100) }}</td>
              <td>{{ session.qualified ? '是' : '否' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getAllArticles, getAllSessions, type Article } from '../utils/db';
import {
  verdictLabel,
  type PageKind,
  type ReadingSignals,
  type ReadingVerdict,
} from '../utils/reading';

const VERDICTS: ReadingVerdict[] = ['deep', 'skim', 'glance', 'bounce'];
const KINDS: PageKind[] = ['article', 'discussion', 'utility', 'index', 'video', 'unknown'];

const sessions = ref<ReadingSignals[]>([]);
const articles = ref<Article[]>([]);
const range = ref(30);
const verdictFilter = ref<'' | ReadingVerdict>('');
const kindFilter = ref<'' | PageKind>('');

const filtered = computed(() => {
  const since = range.value ? Date.now() - range.value * 24 * 60 * 60 * 1000 : 0;
  return sessions.value
    .filter((session) => session.startedAt >= since)
    .filter((session) => !verdictFilter.value || session.verdict === verdictFilter.value)
    .filter((session) => !kindFilter.value || session.pageKind === kindFilter.value);
});

const recent = computed(() => filtered.value.slice(0, 100));

const articleSessions = computed(
  () => filtered.value.filter((session) => session.pageKind === 'article').length
);
const qualifiedCount = computed(() => filtered.value.filter((session) => session.qualified).length);
const qualifiedRate = computed(() =>
  filtered.value.length ? Math.round((qualifiedCount.value / filtered.value.length) * 100) : 0
);
const falsePositiveCount = computed(
  () => articles.value.filter((article) => article.falsePositive).length
);

function average(list: ReadingSignals[], pick: (session: ReadingSignals) => number): number {
  if (!list.length) return 0;
  return Math.round(list.reduce((sum, session) => sum + pick(session), 0) / list.length);
}

const avgVisible = computed(() => average(filtered.value, (s) => s.visibleSec));
const avgDepth = computed(() => average(filtered.value, (s) => s.maxDepth * 100));
const avgSpeed = computed(() => average(filtered.value, (s) => s.avgScrollSpeed));
const avgPause = computed(() => average(filtered.value, (s) => s.pauseCount));

const verdictDist = computed(() =>
  VERDICTS.map((verdict) => {
    const count = filtered.value.filter((session) => session.verdict === verdict).length;
    return {
      key: verdict,
      label: verdictLabel(verdict),
      count,
      pct: filtered.value.length ? Math.round((count / filtered.value.length) * 100) : 0,
      cls: verdictClass(verdict),
    };
  })
);

const kindDist = computed(() =>
  KINDS.map((kind) => {
    const count = filtered.value.filter((session) => session.pageKind === kind).length;
    return {
      key: kind,
      label: kindLabel(kind),
      count,
      pct: filtered.value.length ? Math.round((count / filtered.value.length) * 100) : 0,
    };
  })
);

const verdictStats = computed(() =>
  VERDICTS.map((verdict) => {
    const list = filtered.value.filter((session) => session.verdict === verdict);
    return {
      key: verdict,
      label: verdictLabel(verdict),
      cls: verdictClass(verdict),
      count: list.length,
      visible: average(list, (s) => s.visibleSec),
      depth: average(list, (s) => s.maxDepth * 100),
      scrolls: average(list, (s) => s.scrollEvents),
      speed: average(list, (s) => s.avgScrollSpeed),
      pauses: average(list, (s) => s.pauseCount),
      copyRate: list.length
        ? Math.round((list.filter((session) => session.copyCount > 0).length / list.length) * 100)
        : 0,
      hidden: average(list, (s) => s.hiddenSec),
      idle: average(list, (s) => s.idleSec),
    };
  })
);

function verdictClass(verdict: ReadingVerdict): string {
  if (verdict === 'deep') return 'success';
  if (verdict === 'bounce') return 'low';
  return 'muted';
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

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

function formatDate(ts: number): string {
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`;
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson() {
  const bundle = {
    exportedAt: Date.now(),
    rangeDays: range.value,
    sessions: filtered.value,
    articles: articles.value,
  };
  download(`peruse-sessions-${Date.now()}.json`, JSON.stringify(bundle, null, 2), 'application/json');
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv() {
  const header = [
    'sessionId',
    'startedAt',
    'url',
    'title',
    'host',
    'pageKind',
    'pageConfidence',
    'verdict',
    'engagementScore',
    'qualified',
    'visibleSec',
    'hiddenSec',
    'idleSec',
    'editingSec',
    'maxDepth',
    'scrollEvents',
    'scrollDistancePx',
    'avgScrollSpeed',
    'maxScrollSpeed',
    'directionChanges',
    'pauseCount',
    'avgPauseSec',
    'mouseMoves',
    'clicks',
    'keyPresses',
    'selectionCount',
    'selectedChars',
    'copyCount',
    'visibilityChanges',
    'focusLossCount',
    'wordCount',
    'estimatedReadSec',
    'timelinePoints',
    'reasons',
  ];

  const rows = filtered.value.map((session) =>
    [
      session.sessionId,
      new Date(session.startedAt).toISOString(),
      session.url,
      session.title,
      session.host,
      session.pageKind,
      session.pageConfidence,
      session.verdict,
      session.engagementScore,
      session.qualified,
      session.visibleSec,
      session.hiddenSec,
      session.idleSec,
      session.editingSec,
      session.maxDepth,
      session.scrollEvents,
      session.scrollDistancePx,
      session.avgScrollSpeed,
      session.maxScrollSpeed,
      session.directionChanges,
      session.pauseCount,
      session.avgPauseSec,
      session.mouseMoves,
      session.clicks,
      session.keyPresses,
      session.selectionCount,
      session.selectedChars,
      session.copyCount,
      session.visibilityChanges,
      session.focusLossCount,
      session.wordCount,
      session.estimatedReadSec,
      session.timeline.length,
      session.reasons.join(' | '),
    ]
      .map(csvCell)
      .join(',')
  );

  download(
    `peruse-sessions-${Date.now()}.csv`,
    `\uFEFF${header.join(',')}\n${rows.join('\n')}`,
    'text/csv;charset=utf-8'
  );
}

async function reload() {
  sessions.value = await getAllSessions();
  articles.value = await getAllArticles();
}

onMounted(reload);
</script>

<style scoped>
.lab {
  width: 100%;
}
.test-note {
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
  padding: 10px 14px;
  margin-bottom: 16px;
  border: 1px dashed var(--peruse-secondary);
  border-radius: 10px;
  background: var(--peruse-primary-weak);
  font-size: 12px;
  color: var(--peruse-muted);
}
.test-note b {
  color: var(--peruse-primary);
  flex: 0 0 auto;
}
.filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.select {
  padding: 8px 12px;
  border: 1px solid var(--peruse-border);
  border-radius: 8px;
  background: #fff;
  color: var(--peruse-text);
  font-size: 13px;
  outline: none;
}
.spacer {
  flex: 1;
}
.btn {
  padding: 8px 14px;
  border: 1px solid var(--peruse-border);
  border-radius: 8px;
  background: #fff;
  color: var(--peruse-text);
  font-size: 13px;
  cursor: pointer;
}
.btn:hover {
  border-color: var(--peruse-secondary);
  color: var(--peruse-primary);
}
.btn.ghost {
  background: transparent;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border: 1px solid var(--peruse-border);
  border-radius: 12px;
  background: #fff;
}
.card .k {
  font-size: 12px;
  color: var(--peruse-muted);
}
.card b {
  font-size: 22px;
  line-height: 1.2;
}
.card .sub {
  font-size: 11px;
  color: var(--peruse-faint);
}
.panel {
  padding: 16px;
  margin-bottom: 16px;
  border: 1px solid var(--peruse-border);
  border-radius: 12px;
  background: #fff;
}
.panel-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.panel-title.spaced {
  margin-top: 20px;
}
.panel-title h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.hint {
  font-size: 11px;
  color: var(--peruse-faint);
}
.dist {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dist-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.dist-label {
  flex: 0 0 64px;
  color: var(--peruse-muted);
}
.bar {
  flex: 1;
  height: 10px;
  border-radius: 999px;
  background: #f1f0f6;
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  min-width: 2px;
  border-radius: 999px;
}
.bar .success {
  background: var(--peruse-success);
}
.bar .muted {
  background: var(--peruse-secondary);
}
.bar .low {
  background: #d7d2e8;
}
.fill.muted {
  background: var(--peruse-secondary);
}
.dist-num {
  flex: 0 0 92px;
  text-align: right;
  color: var(--peruse-muted);
}
.table-scroll {
  overflow-x: auto;
}
.table {
  width: 100%;
  min-width: 780px;
  border-collapse: collapse;
  font-size: 12px;
}
.table.wide {
  min-width: 1280px;
}
.table th {
  padding: 8px 10px;
  background: var(--peruse-bg);
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  color: var(--peruse-muted);
  white-space: nowrap;
}
.table td {
  padding: 8px 10px;
  border-top: 1px solid #f0edf5;
  vertical-align: middle;
}
.table tbody tr:hover {
  background: #fcfbff;
}
.title-cell {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nowrap {
  white-space: nowrap;
}
.badge.low {
  background: #f1f0f6;
  color: var(--peruse-faint);
}
</style>
