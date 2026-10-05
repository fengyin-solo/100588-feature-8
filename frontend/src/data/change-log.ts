import type { ChangeLogRow } from './types'

// 改动留痕单独存一份 localStorage，和业务数据分开：业务数据会重置，留痕不该跟着丢。
const LOG_KEY = 'drainage-pump:change-log'
const MAX_LOGS = 500

function readLogs(): ChangeLogRow[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(LOG_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as ChangeLogRow[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

let cache: ChangeLogRow[] | null = null

function allLogs(): ChangeLogRow[] {
  if (cache === null) {
    cache = readLogs()
  }
  return cache
}

export function appendChangeLog(entry: Omit<ChangeLogRow, 'id' | 'time'>): ChangeLogRow {
  const logs = allLogs()
  const row: ChangeLogRow = {
    ...entry,
    id: logs.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    time: new Date().toLocaleString('zh-CN', { hour12: false }),
  }
  // 新的排前面，倒查时最近改动一眼看到；条数封顶，防止 localStorage 越滚越大。
  const next = [row, ...logs].slice(0, MAX_LOGS)
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(LOG_KEY, JSON.stringify(next))
  }
  return row
}

export function listChangeLogs(moduleKey?: string): ChangeLogRow[] {
  const logs = allLogs()
  return moduleKey ? logs.filter((log) => log.module === moduleKey) : [...logs]
}
