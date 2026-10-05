<template>
  <section class="page" data-module="drainpipe">
    <header class="page-head">
      <div>
        <h2>排水管网管理</h2>
        <p class="page-desc">按井定位查管段：管段编号、起点井号、终点井号可叠加，管径按区间筛；已废弃默认不进结果，状态变更全程留痕。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记排水管段</button>
        <button class="btn" type="button" @click="exportRows">导出排水管网清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>管段编号</span>
        <input v-model="filters.管段编号" placeholder="如 GD-1001" />
      </label>
      <label class="filter-item">
        <span>起点井号</span>
        <input v-model="filters.起点井号" placeholder="如 WS-1001" />
      </label>
      <label class="filter-item">
        <span>终点井号</span>
        <input v-model="filters.终点井号" placeholder="如 WS-1002" />
      </label>
      <label class="filter-item">
        <span>管径下限（mm）</span>
        <input v-model="filters.管径下限" placeholder="如 600" />
      </label>
      <label class="filter-item">
        <span>管径上限（mm）</span>
        <input v-model="filters.管径上限" placeholder="如 1200" />
      </label>
      <label class="filter-item checkbox-item">
        <input v-model="filters.包含已废弃" type="checkbox" />
        <span>含已废弃</span>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <p v-for="(tip, index) in inlineTips" :key="index" class="error-text">{{ tip }}</p>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>版本</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span class="status-badge" :class="statusClass(String(row.status))">{{ row.status }}</span>
          </td>
          <td>第 {{ row.version ?? 1 }} 版</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openDiameter(row)">改管径</button>
            <button class="link" type="button" @click="gotoDredge(row)">清淤记录</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">
            <div v-if="diagnosis.length" class="diagnosis">
              <p>一段都没命中，对照看看是哪一格填得对不上：</p>
              <ul>
                <li v-for="(item, index) in diagnosis" :key="index">{{ item }}</li>
              </ul>
            </div>
            <span v-else>暂无排水管网数据，可先登记排水管段</span>
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 段命中（已废弃默认不进结果）</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="editing" class="dialog-mask" @click.self="closeDiameter">
      <div class="dialog">
        <h3>修改管径 · {{ editing.code }}</h3>
        <p class="page-desc">
          当前管径 {{ editing.current }}mm（第 {{ editing.version }} 版）。提交时若别人已先改过，
          这次会被拦下并载入最新一版。
        </p>
        <label class="filter-item">
          <span>新管径（mm）</span>
          <input v-model="editing.input" type="number" min="1" />
        </label>
        <p v-if="editing.error" class="error-text">{{ editing.error }}</p>
        <div class="dialog-actions">
          <button class="btn primary" type="button" @click="submitDiameter">提交</button>
          <button class="btn ghost" type="button" @click="closeDiameter">取消</button>
        </div>
      </div>
    </div>

    <section class="log-panel">
      <header class="log-head">
        <h3>管段状态变更留痕</h3>
        <label class="filter-item">
          <span>按管段编号倒查</span>
          <input v-model="logKeyword" placeholder="如 GD-1001" @input="reloadLogs" />
        </label>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>管段编号</th>
            <th>类别</th>
            <th>动作</th>
            <th>变更前</th>
            <th>变更后</th>
            <th>操作人</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in logs" :key="log.id">
            <td>{{ log.time }}</td>
            <td>{{ log.code }}</td>
            <td>{{ log.category }}</td>
            <td>{{ log.action }}</td>
            <td>{{ log.fromValue }}</td>
            <td>{{ log.toValue }}</td>
            <td>{{ log.operator }}</td>
          </tr>
          <tr v-if="!logs.length">
            <td colspan="7" class="empty-state">还没有留痕，管段状态或管径一动就会记在这里</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import {
  getPipe,
  pipeChangeLogs,
  pipeStatusCounts,
  queryPipes,
  runPipeAction,
  updatePipeDiameter,
  type PipeQuery,
} from '@/api/pipe-service'
import type { ChangeLogRow, EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('drainpipe')
// 「管段状态」字段不单独占一列，用带颜色的状态徽章展示，一眼看出。
const columns = meta.fields.filter((field) => field !== '管段状态')
const actions = meta.actions

const store = useSessionStore()
const router = useRouter()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const diagnosis = ref<string[]>([])
const errorMessage = ref('')
const noticeMessage = ref('')
const stats = ref<{ label: string; value: number }[]>([])
const logs = ref<ChangeLogRow[]>([])
const logKeyword = ref('')

const filters = ref<PipeQuery>({
  管段编号: '',
  起点井号: '',
  终点井号: '',
  管径下限: '',
  管径上限: '',
  包含已废弃: false,
})

// 有结果时诊断里剩下的只是提醒（比如管径填了非数字），单独成行亮出来。
const inlineTips = computed(() => (rows.value.length > 0 ? diagnosis.value : []))

type DiameterEdit = {
  id: number
  code: string
  current: string
  version: number
  input: string
  error: string
}
const editing = ref<DiameterEdit | null>(null)

function statusClass(status: string): string {
  if (status === '运行正常') return 'is-ok'
  if (status === '待清淤') return 'is-warn'
  if (status === '待巡线') return 'is-idle'
  if (status === '已废弃') return 'is-dead'
  return ''
}

function resetFilters() {
  filters.value = { 管段编号: '', 起点井号: '', 终点井号: '', 管径下限: '', 管径上限: '', 包含已废弃: false }
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '排水管段登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = runPipeAction(Number(row.id), action, store.operator)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function gotoDredge(row: EntryRow) {
  router.push({ path: '/dredge', query: { 管段: String(row['管段编号'] ?? '') } })
}

function openDiameter(row: EntryRow) {
  editing.value = {
    id: Number(row.id),
    code: String(row['管段编号'] ?? ''),
    current: String(row['管径'] ?? ''),
    version: Number(row.version ?? 1),
    input: String(row['管径'] ?? ''),
    error: '',
  }
}

function closeDiameter() {
  editing.value = null
}

function submitDiameter() {
  const form = editing.value
  if (!form) {
    return
  }
  const next = Number(form.input)
  if (!Number.isFinite(next) || next <= 0) {
    form.error = '管径要填大于 0 的数字（毫米）'
    return
  }
  const result = updatePipeDiameter(form.id, next, form.version, store.operator)
  if (!result.ok) {
    // 被别人抢先改了：把最新一版拉进对话框，看着最新值再决定怎么改。
    const latest = getPipe(form.id)
    if (latest) {
      form.current = String(latest['管径'] ?? '')
      form.version = Number(latest.version ?? 1)
      form.input = String(latest['管径'] ?? '')
    }
    form.error = result.message
    reload()
    return
  }
  editing.value = null
  noticeMessage.value = result.message
  reload()
}

function reloadLogs() {
  logs.value = pipeChangeLogs(logKeyword.value)
}

function reload() {
  errorMessage.value = ''
  try {
    const result = queryPipes(filters.value)
    rows.value = result.items
    total.value = result.total
    diagnosis.value = result.diagnosis
    stats.value = pipeStatusCounts()
    reloadLogs()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '排水管网列表读取失败'
  }
}

onMounted(reload)
</script>
