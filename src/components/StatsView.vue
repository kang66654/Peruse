<template>
  <div class="stats">
    <div class="kpis">
      <div class="kpi" :class="{ 'is-empty': !hasData }">
        <div class="kpi-icon" v-if="hasData">⏱</div>
        <div class="kpi-num" v-if="hasData">{{ weekMinutes }}<span>分钟</span></div>
        <div class="kpi-num empty-num" v-else>—</div>
        <div class="kpi-label">本周阅读</div>
        <div class="kpi-sub" v-if="hasData">近 7 天累计</div>
      </div>

      <div class="kpi" :class="{ 'is-empty': !hasData }">
        <div class="kpi-icon" v-if="hasData">📖</div>
        <div class="kpi-num" v-if="hasData">{{ seriousCount }}<span>篇</span></div>
        <div class="kpi-num empty-num" v-else>—</div>
        <div class="kpi-label">认真读完</div>
        <div class="kpi-sub" v-if="hasData">阅读评分 ≥ 0.6</div>
      </div>

      <div class="kpi" :class="{ 'is-empty': !hasData }">
        <div class="kpi-icon" v-if="hasData">⏳</div>
        <div class="kpi-num" v-if="hasData">{{ avgMinutes }}<span>分钟</span></div>
        <div class="kpi-num empty-num" v-else>—</div>
        <div class="kpi-label">平均每篇</div>
        <div class="kpi-sub" v-if="hasData">近 7 天</div>
      </div>

      <div class="kpi" :class="{ 'is-empty': !hasData }">
        <div class="kpi-icon" v-if="hasData">⭐</div>
        <div class="kpi-num host" v-if="hasData">{{ topHost || '—' }}</div>
        <div class="kpi-num empty-num" v-else>—</div>
        <div class="kpi-label">最常读站点</div>
        <div class="kpi-sub" v-if="hasData">按停留时长</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card chart-card">
        <div class="card-title">每日阅读时长（分钟）</div>
        <div v-if="hasData" ref="dailyEl" class="chart chart-daily" />
        <div v-else class="chart-empty">开始阅读后展示统计</div>
      </div>

      <div class="card chart-card">
        <div class="card-title">站点分布</div>
        <div v-if="hasData" class="donut-wrap">
          <div ref="hostEl" class="chart chart-donut" />
          <div class="donut-center">
            <strong>{{ hostCount || '—' }}</strong>
            <span>个站点</span>
          </div>
        </div>
        <div v-else class="chart-empty">开始阅读后展示统计</div>
      </div>
    </div>

    <div class="card chart-card">
      <div class="card-title">关注站点 TOP 5</div>
      <div v-if="hasData" ref="topEl" class="chart chart-top" />
      <div v-else class="chart-empty chart-empty-sm">开始阅读后展示统计</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import * as echarts from 'echarts';
import { getAllArticles, type Article } from '../utils/db';

const articles = ref<Article[]>([]);
const dailyEl = ref<HTMLDivElement | null>(null);
const hostEl = ref<HTMLDivElement | null>(null);
const topEl = ref<HTMLDivElement | null>(null);

const weekMinutes = ref(0);
const seriousCount = ref(0);
const avgMinutes = ref(0);
const topHost = ref('');
const hostCount = ref(0);

const hasData = computed(() => articles.value.length > 0);

let dailyChart: echarts.ECharts | null = null;
let hostChart: echarts.ECharts | null = null;
let topChart: echarts.ECharts | null = null;

function dayKey(ts: number): string {
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

function sumSeconds(article: Article): number {
  return article.lastSessionSec || article.visibleTime || 0;
}

function computeData() {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const weekArticles = articles.value.filter((article) => article.readAt >= now - 7 * day);
  weekMinutes.value = Math.round(
    weekArticles.reduce((sum, article) => sum + sumSeconds(article), 0) / 60
  );
  seriousCount.value = weekArticles.filter((article) => article.readingScore >= 0.6).length;
  avgMinutes.value = weekArticles.length
    ? Math.round((weekMinutes.value / weekArticles.length) * 10) / 10
    : 0;

  const hostTotals = new Map<string, number>();
  for (const article of weekArticles) {
    hostTotals.set(article.host, (hostTotals.get(article.host) || 0) + sumSeconds(article));
  }
  topHost.value =
    Array.from(hostTotals.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

function renderDaily() {
  if (!dailyEl.value) return;
  dailyChart ||= echarts.init(dailyEl.value);

  const labels: string[] = [];
  const values: number[] = [];
  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    labels.push(`${date.getMonth() + 1}/${date.getDate()}`);
    const total = articles.value
      .filter((article) => dayKey(article.readAt) === dayKey(date.getTime()))
      .reduce((sum, article) => sum + sumSeconds(article), 0);
    values.push(Math.round((total / 60) * 10) / 10);
  }

  dailyChart.setOption({
    grid: { left: 6, right: 8, top: 14, bottom: 6, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#fff',
      borderColor: '#E8E5F5',
      textStyle: { color: '#28243D', fontSize: 12 },
      formatter: (params: unknown) => {
        const list = params as Array<{ name: string; value: number }>;
        const first = list[0];
        return first ? `${first.name}<br/>阅读 ${first.value} 分钟` : '';
      },
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLine: { lineStyle: { color: '#E8E5F5' } },
      axisTick: { show: false },
      axisLabel: { color: '#6B6B8A', fontSize: 10, margin: 10 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#F3F1FA' } },
      axisLabel: { color: '#9B9BB0', fontSize: 10 },
    },
    series: [
      {
        type: 'bar',
        data: values,
        barWidth: 24,
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: '#6551D6',
        },
        emphasis: { itemStyle: { color: '#5844C4' } },
      },
    ],
  });
}

function hostTotals(days: number): Array<{ name: string; value: number }> {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const totals = new Map<string, number>();
  for (const article of articles.value) {
    if (article.readAt < since) continue;
    totals.set(article.host, (totals.get(article.host) || 0) + sumSeconds(article));
  }
  return Array.from(totals.entries())
    .map(([name, seconds]) => ({ name, value: Math.round((seconds / 60) * 10) / 10 }))
    .sort((a, b) => b.value - a.value);
}

function renderHosts() {
  if (!hostEl.value) return;
  hostChart ||= echarts.init(hostEl.value);
  const totals = hostTotals(30);
  const top = totals.slice(0, 5);
  const rest = totals.slice(5).reduce((sum, item) => sum + item.value, 0);
  const data = rest > 0 ? [...top, { name: '其他', value: Math.round(rest * 10) / 10 }] : top;
  hostCount.value = data.length;

  hostChart.setOption({
    color: ['#6551D6', '#AAA0EF', '#F2AA7E', '#F7D978', '#C9C4DC', '#E8E5F5'],
    tooltip: {
      trigger: 'item',
      backgroundColor: '#fff',
      borderColor: '#E8E5F5',
      textStyle: { color: '#28243D', fontSize: 12 },
      formatter: '{b}<br/>{c} 分钟（{d}%）',
    },
    legend: {
      bottom: 0,
      type: 'scroll',
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 14,
      textStyle: { color: '#6B6B8A', fontSize: 11 },
    },
    series: [
      {
        type: 'pie',
        radius: ['52%', '74%'],
        center: ['50%', '45%'],
        avoidLabelOverlap: true,
        label: { show: false },
        itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
        data,
      },
    ],
  });
}

function renderTop() {
  if (!topEl.value) return;
  topChart ||= echarts.init(topEl.value);
  const top = hostTotals(30).slice(0, 5).reverse();

  topChart.setOption({
    grid: { left: 4, right: 40, top: 6, bottom: 6, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#fff',
      borderColor: '#E8E5F5',
      textStyle: { color: '#28243D', fontSize: 12 },
      formatter: '{b}<br/>{c} 分钟',
    },
    xAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#F3F1FA' } },
      axisLabel: { color: '#9B9BB0', fontSize: 10 },
    },
    yAxis: {
      type: 'category',
      data: top.map((item) => item.name),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: '#28243D',
        fontSize: 12,
        margin: 8,
        formatter: (value: string, index: number) => `{r|${index + 1}} {n|${value}}`,
        rich: {
          r: {
            width: 18,
            height: 18,
            lineHeight: 18,
            align: 'center',
            verticalAlign: 'middle',
            backgroundColor: '#F0EDFF',
            color: '#6551D6',
            borderRadius: 4,
            fontSize: 10,
            fontWeight: 600,
          },
          n: {
            color: '#28243D',
            fontSize: 12,
            padding: [0, 0, 0, 6],
          },
        },
      },
    },
    series: [
      {
        type: 'bar',
        data: top.map((item) => item.value),
        barWidth: 8,
        showBackground: true,
        backgroundStyle: { color: '#E8E5F5', borderRadius: 4 },
        itemStyle: { borderRadius: 4, color: '#6551D6' },
        label: { show: true, position: 'right', color: '#6B6B8A', fontSize: 11 },
      },
    ],
  });
}

function renderAll() {
  computeData();
  renderDaily();
  renderHosts();
  renderTop();
}

function resize() {
  dailyChart?.resize();
  hostChart?.resize();
  topChart?.resize();
}

onMounted(async () => {
  articles.value = await getAllArticles();
  await nextTick();
  if (articles.value.length) renderAll();
  window.addEventListener('resize', resize);
});

onUnmounted(() => {
  window.removeEventListener('resize', resize);
  dailyChart?.dispose();
  hostChart?.dispose();
  topChart?.dispose();
});
</script>

<style scoped>
.stats {
  width: 100%;
}
.kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}
.kpi {
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid var(--peruse-border);
  border-radius: 12px;
  padding: 20px;
}
.kpi-icon {
  order: 0;
  font-size: 20px;
  line-height: 1;
  margin-bottom: 8px;
}
.kpi-num {
  order: 1;
  font-size: 28px;
  font-weight: 700;
  color: var(--peruse-text);
  line-height: 1.25;
}
.kpi-num span {
  font-size: 12px;
  font-weight: 400;
  color: var(--peruse-muted);
  margin-left: 3px;
}
.kpi-num.host {
  font-size: 18px;
  line-height: 1.95;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kpi-label {
  order: 2;
  font-size: 12px;
  color: var(--peruse-muted);
  margin-top: 2px;
}
.kpi-sub {
  order: 3;
  font-size: 11px;
  color: var(--peruse-faint);
  margin-top: 4px;
}
.kpi.is-empty .kpi-label {
  order: 1;
  margin: 0 0 4px;
}
.kpi.is-empty .kpi-num {
  order: 2;
}
.kpi-num.empty-num {
  color: var(--peruse-faint);
}
.grid-2 {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
  align-items: stretch;
}
.card {
  background: #fff;
  border: 1px solid var(--peruse-border);
  border-radius: 12px;
  box-shadow: none;
}
.chart-card {
  padding: 20px;
  min-width: 0;
}
.card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--peruse-text);
  margin-bottom: 16px;
}
.chart {
  width: 100%;
}
.chart-daily {
  height: 200px;
}
.chart-donut {
  height: 200px;
}
.chart-top {
  height: 210px;
}
.donut-wrap {
  position: relative;
}
.donut-center {
  position: absolute;
  left: 50%;
  top: 45%;
  transform: translate(-50%, -50%);
  width: 84px;
  height: 84px;
  border-radius: 50%;
  background: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.donut-center strong {
  font-size: 18px;
  font-weight: 700;
  color: var(--peruse-text);
  line-height: 1.2;
}
.donut-center span {
  font-size: 10px;
  color: var(--peruse-muted);
}
.chart-empty {
  height: 200px;
  display: grid;
  place-items: center;
  background: var(--peruse-bg);
  border-radius: 8px;
  color: var(--peruse-faint);
  font-size: 13px;
}
.chart-empty-sm {
  height: 180px;
}
@media (max-width: 860px) {
  .kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .grid-2 {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 520px) {
  .kpis {
    grid-template-columns: 1fr;
  }
  .kpi {
    padding: 16px;
  }
  .kpi-num {
    font-size: 24px;
  }
}
</style>
