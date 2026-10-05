import { SEED_ROWS } from './seed'
import type { EntryRow, StatusLog } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'drainage-pump:entries'
// 状态流转留痕单独存一份，不跟台账数据一起被重置冲掉。
const LOG_STORAGE_KEY = 'drainage-pump:status-logs'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

/** 写操作前强制重读存储：另一个标签页刚改过的数据（版本号、状态）不能被本页缓存盖掉。 */
export function refreshRows(): void {
  cache = readStorage()
}

function readLogs(): StatusLog[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(LOG_STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    return JSON.parse(raw) as StatusLog[]
  } catch {
    return []
  }
}

export function listStatusLogs(module?: string, rowId?: number): StatusLog[] {
  return readLogs()
    .filter((log) => (module ? log.module === module : true))
    .filter((log) => (rowId !== undefined ? Number(log.rowId) === rowId : true))
    .sort((a, b) => b.time.localeCompare(a.time) || b.id - a.id)
}

export function appendStatusLog(entry: Omit<StatusLog, 'id' | 'time'> & { time?: string }): StatusLog {
  const logs = readLogs()
  const next: StatusLog = {
    ...entry,
    id: logs.reduce((max, log) => Math.max(max, Number(log.id)), 0) + 1,
    time: entry.time ?? new Date().toISOString(),
  }
  logs.push(next)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logs))
  }
  return next
}
