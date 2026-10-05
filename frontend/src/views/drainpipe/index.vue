<template>
  <section class="page" data-module="drainpipe">
    <header class="page-head">
      <div>
        <h2>排水管网管理</h2>
        <p class="page-desc">按井定位查管段：管段编号、起点井号、终点井号可叠加查询，管径按区间筛，已废弃默认不进结果。</p>
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

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>管段编号</span>
        <input v-model="query.管段编号" placeholder="如 DRAI-0001" />
      </label>
      <label class="filter-item">
        <span>起点井号</span>
        <input v-model="query.起点井号" placeholder="如 J-0101" />
      </label>
      <label class="filter-item">
        <span>终点井号</span>
        <input v-model="query.终点井号" placeholder="如 J-0102" />
      </label>
      <label class="filter-item">
        <span>管径下限(mm)</span>
        <input v-model="query.管径下限" placeholder="如 400" inputmode="numeric" />
      </label>
      <label class="filter-item">
        <span>管径上限(mm)</span>
        <input v-model="query.管径上限" placeholder="如 800" inputmode="numeric" />
      </label>
      <label class="filter-check">
        <input v-model="query.含已废弃" type="checkbox" />
        含已废弃
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-if="mismatches.length || combinationMiss" class="mismatch-panel">
      <strong>一段都没命中，问题出在：</strong>
      <ul v-if="mismatches.length">
        <li v-for="item in mismatches" :key="item">{{ item }}</li>
      </ul>
      <p v-else>
        每个条件单独都能查到管段，但没有一段管同时满足全部条件——井号、编号、管径区间可能张冠李戴，请对照图纸核一遍。
      </p>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td><span class="status-tag" :class="statusTone(String(row.status))">{{ row.status }}</span></td>
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
            <button class="link" type="button" @click="openLogs(row)">流转记录</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            {{ mismatches.length || combinationMiss ? '按上面的提示修正条件后再查' : '暂无排水管网数据，可先登记排水管段' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条排水管网记录{{ query.含已废弃 ? '（含已废弃）' : '（已废弃不列出）' }}</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="editing" class="modal-mask" @click.self="editing = null">
      <div class="modal-card">
        <h3>修改管径 · {{ editing['管段编号'] }}</h3>
        <p class="field-row">
          <span>当前管径（第 {{ editingVersion }} 版，提交时若版本被别人抢先改动会被挡住）</span>
          <input v-model="diameterInput" placeholder="如 DN600" />
        </p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="editing = null">取消</button>
          <button class="btn primary" type="button" @click="submitDiameter">提交</button>
        </div>
      </div>
    </div>

    <div v-if="logTarget" class="modal-mask" @click.self="logTarget = null">
      <div class="modal-card">
        <h3>流转记录 · {{ logTarget['管段编号'] }}</h3>
        <ul v-if="logs.length" class="log-list">
          <li v-for="log in logs" :key="log.id">
            <div>
              {{ log.operator }} 执行「{{ log.action }}」：
              <template v-if="log.fromStatus !== log.toStatus">{{ log.fromStatus }} → {{ log.toStatus }}</template>
              <template v-else>{{ log.detail }}</template>
            </div>
            <div class="log-meta">{{ formatTime(log.time) }}</div>
          </li>
        </ul>
        <p v-else class="log-empty">这段管还没有状态改动记录</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="logTarget = null">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  queryPipes,
  queryStatusLogs,
  runAction as applyAction,
  updatePipeDiameter,
} from '@/api/local-service'
import type { EntryRow, StatusLog } from '@/data/types'
import { useSessionStore } from '@/stores/session'
import { statusTone } from '@/utils/status-tone'

const meta = moduleMeta('drainpipe')
const columns = ["管段编号", "起点井号", "终点井号", "管径", "埋深", "管材", "敷设日期", "管段状态"]
const actions = ["完成巡线", "安排清淤", "报废管段"]
const statuses = ["待巡线", "运行正常", "待清淤", "已废弃"]

const router = useRouter()
const session = useSessionStore()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const query = reactive({
  管段编号: '',
  起点井号: '',
  终点井号: '',
  管径下限: '',
  管径上限: '',
  含已废弃: false,
})
const mismatches = ref<string[]>([])
const combinationMiss = ref(false)

// 统计看全量台账，不随筛选条件变。
const allPipeRows = ref<EntryRow[]>([])
const stats = computed(() => [
  { label: '运行正常管段', value: countByStatus('运行正常') },
  { label: '待清淤管段', value: countByStatus('待清淤') },
  { label: '待巡线管段', value: countByStatus('待巡线') },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({ status, count: countByStatus(status) })),
)

function countByStatus(status: string) {
  return allPipeRows.value.filter((row) => String(row.status) === status).length
}

function resetFilters() {
  query.管段编号 = ''
  query.起点井号 = ''
  query.终点井号 = ''
  query.管径下限 = ''
  query.管径上限 = ''
  query.含已废弃 = false
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
  const result = applyAction(meta.key, Number(row.id), action, session.operator)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  // 动作成功：提示里会带上「已同步到清淤待开工台账」等后续结果。
  noticeMessage.value = result.message
  reload()
}

const editing = ref<EntryRow | null>(null)
const editingVersion = ref(1)
const diameterInput = ref('')

function openDiameter(row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  editing.value = row
  // 记住打开时看到的版本号，提交时拿它证明「我基于最新版改的」。
  editingVersion.value = Number(row.version ?? 1)
  diameterInput.value = String(row['管径'] ?? '')
}

function submitDiameter() {
  if (!editing.value) return
  const result = updatePipeDiameter(
    Number(editing.value.id),
    diameterInput.value,
    editingVersion.value,
    session.operator,
  )
  editing.value = null
  if (!result.ok) {
    // 被别人抢先改过时，消息里带着最新管径和版本，先刷新列表让人看到最新一版。
    errorMessage.value = result.message
    reload()
    return
  }
  noticeMessage.value = result.message
  reload()
}

function gotoDredge(row: EntryRow) {
  router.push({ path: '/dredge', query: { 管段: String(row['管段编号'] ?? '') } })
}

const logTarget = ref<EntryRow | null>(null)
const logs = ref<StatusLog[]>([])

function openLogs(row: EntryRow) {
  logTarget.value = row
  logs.value = queryStatusLogs(meta.key, Number(row.id))
}

function formatTime(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false })
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = queryPipes({ ...query })
    rows.value = payload.items
    total.value = payload.total
    mismatches.value = payload.mismatches
    combinationMiss.value = payload.combinationMiss
    allPipeRows.value = listEntries('drainpipe').items
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '排水管网列表读取失败'
  }
}

// 另一个标签页改了数据（比如别人改了管径），这边跟着刷新，看到的始终是最新一版。
function onStorage(event: StorageEvent) {
  if (event.key && event.key.includes('drainage-pump')) {
    reload()
  }
}

onMounted(() => {
  reload()
  window.addEventListener('storage', onStorage)
})
onUnmounted(() => window.removeEventListener('storage', onStorage))
</script>
