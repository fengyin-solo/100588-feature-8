import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  appendStatusLog,
  listRows,
  listStatusLogs,
  refreshRows,
  resetRows,
  saveRows,
} from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  PipeQuery,
  PipeQueryResult,
  StatusLog,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(
  key: string,
  id: number,
  action: string,
  operator = '值班管理员',
): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  // 状态流转是写操作，先丢掉本页缓存，基于最新数据判断，避免盖住别的标签页的改动。
  refreshRows()
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  // 留痕：谁在什么时候把哪一条从什么状态改成什么状态，之后能倒查。
  appendStatusLog({
    module: key,
    rowId: id,
    target: String(updated[meta.fields[0]] ?? id),
    action,
    fromStatus: current,
    toStatus: target,
    operator,
    detail: '',
  })
  let message = `${meta.entity}已${action}，当前状态「${target}」`
  // 巡线办结、管段转入待清淤时，同步到清淤的待开工台账。
  if (key === 'drainpipe' && target === '待清淤') {
    message += syncDredgeLedger(updated, operator)
  }
  return { ok: true, message }
}

/** 管段转入待清淤后，在清淤模块补一张待开工单；已有开口单（待清淤/清淤中）就不重复建。 */
function syncDredgeLedger(pipe: EntryRow, operator: string): string {
  const code = String(pipe['管段编号'] ?? '')
  const rows = listRows('dredge')
  const open = rows.find(
    (row) =>
      String(row['清淤管段']) === code && ['待清淤', '清淤中'].includes(String(row.status)),
  )
  if (open) {
    return `；清淤待开工台账已有该管段的单子（${open['清淤编号']}），不重复建单`
  }
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const record: EntryRow = {
    id: nextId,
    status: '待清淤',
    pending: true,
    abnormal: false,
    清淤编号: `DRED-${String(nextId).padStart(4, '0')}`,
    清淤管段: code,
    淤积厚度: '待测量',
    清淤方式: '待定',
    清淤班组: '待派班',
    清淤日期: '待排期',
    清淤量: '—',
    清淤状态: '待清淤',
  }
  saveRows('dredge', [...rows, record])
  appendStatusLog({
    module: 'dredge',
    rowId: nextId,
    target: code,
    action: '巡线办结同步',
    fromStatus: '—',
    toStatus: '待清淤',
    operator,
    detail: `巡线办结，管段「${code}」转入待清淤，自动登上待开工台账`,
  })
  return `；已同步到清淤待开工台账（${record['清淤编号']}）`
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

/** 从「DN600」「600mm」这类写法里取出管径数值，取不到就返回 null。 */
function parseDiameter(value: unknown): number | null {
  const match = String(value ?? '').match(/\d+(\.\d+)?/)
  return match ? Number(match[0]) : null
}

const PIPE_TEXT_FIELDS = ['管段编号', '起点井号', '终点井号'] as const

/**
 * 排水管网按井定位查询：管段编号、起点井号、终点井号三个条件叠加（与），
 * 管径按区间筛；已废弃的管段默认不进结果。
 * 一段都没命中时不丢空表，逐格诊断是哪个条件对不上。
 */
export function queryPipes(query: PipeQuery): PipeQueryResult {
  refreshRows()
  const all = listRows('drainpipe')
  const pool = query.含已废弃 ? all : all.filter((row) => String(row.status) !== '已废弃')

  const textConds = PIPE_TEXT_FIELDS.map((field) => ({ field, value: query[field].trim() })).filter(
    (cond) => cond.value !== '',
  )
  const min = query.管径下限.trim() === '' ? null : Number(query.管径下限)
  const max = query.管径上限.trim() === '' ? null : Number(query.管径上限)
  const rangeActive = min !== null || max !== null
  const rangeValid =
    !rangeActive ||
    ((min === null || Number.isFinite(min)) &&
      (max === null || Number.isFinite(max)) &&
      (min === null || max === null || min <= max))

  const matchText = (row: EntryRow, field: string, value: string) =>
    String(row[field] ?? '').includes(value)
  const inRange = (row: EntryRow) => {
    const diameter = parseDiameter(row['管径'])
    if (diameter === null) return false
    if (min !== null && diameter < min) return false
    if (max !== null && diameter > max) return false
    return true
  }
  const matchAll = (row: EntryRow) =>
    textConds.every((cond) => matchText(row, cond.field, cond.value)) &&
    (!rangeActive || inRange(row))

  const matched = rangeValid ? pool.filter(matchAll) : []
  const result: PipeQueryResult = {
    items: matched,
    total: matched.length,
    page: 1,
    size: matched.length,
    mismatches: [],
    combinationMiss: false,
  }

  const hasCondition = textConds.length > 0 || rangeActive
  if (matched.length > 0 || !hasCondition) {
    return result
  }

  // 空结果诊断：逐格回放每个条件，指出是哪一格填得对不上。
  if (!rangeValid) {
    result.mismatches.push(
      min !== null && max !== null && min > max
        ? `管径区间对不上：下限 ${query.管径下限} 比上限 ${query.管径上限} 还大`
        : `管径区间对不上：「${query.管径下限 || query.管径上限}」不是能比较的数值`,
    )
    return result
  }
  for (const cond of textConds) {
    if (pool.some((row) => matchText(row, cond.field, cond.value))) continue
    const abandonedHit = all.some(
      (row) => String(row.status) === '已废弃' && matchText(row, cond.field, cond.value),
    )
    if (abandonedHit) {
      result.mismatches.push(
        `${cond.field}「${cond.value}」只命中已废弃的管段，默认不进结果，可勾选「含已废弃」再看`,
      )
      continue
    }
    const hints: Record<string, string> = {
      管段编号: '没有任何管段用这个编号，请核对是否抄错',
      起点井号: '没有管段从这口井出发，请核对是否抄错井号',
      终点井号: '没有管段汇入这口井，请核对是否抄错井号',
    }
    result.mismatches.push(`${cond.field}「${cond.value}」对不上：${hints[cond.field] ?? '没有管段符合'}`)
  }
  if (rangeActive && !pool.some(inRange)) {
    const lo = min === null ? '不限' : String(min)
    const hi = max === null ? '不限' : String(max)
    result.mismatches.push(`管径区间 ${lo} ~ ${hi} 对不上：没有管段的管径落在这个区间`)
  }
  if (result.mismatches.length === 0) {
    // 每格单独都能查到，叠在一起才空：条件之间张冠李戴。
    result.combinationMiss = true
  }
  return result
}

/**
 * 改管径带版本号：打开编辑时记住看到的版本，提交时版本对不上
 * 说明中间已被别人改过，这次提交要被挡住，提示先看最新一版。
 */
export function updatePipeDiameter(
  id: number,
  diameter: string,
  expectedVersion: number,
  operator: string,
): ActionResult {
  const trimmed = diameter.trim()
  if (trimmed === '') {
    return { ok: false, message: '管径不能为空' }
  }
  refreshRows()
  const rows = listRows('drainpipe')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的排水管段` }
  }
  const row = rows[index]
  const currentVersion = Number(row.version ?? 1)
  if (currentVersion !== expectedVersion) {
    return {
      ok: false,
      message: `提交被挡住：管段「${row['管段编号']}」的管径刚被${String(
        row['管径修改人'] ?? '别人',
      )}改成「${row['管径']}」（第 ${currentVersion} 版），你手里还是第 ${expectedVersion} 版，请先看最新一版再改`,
    }
  }
  if (trimmed === String(row['管径'])) {
    return { ok: false, message: '管径没有变化，不用提交' }
  }
  const updated: EntryRow = {
    ...row,
    管径: trimmed,
    version: currentVersion + 1,
    管径修改人: operator,
  }
  const next = [...rows]
  next[index] = updated
  saveRows('drainpipe', next)
  appendStatusLog({
    module: 'drainpipe',
    rowId: id,
    target: String(row['管段编号'] ?? id),
    action: '修改管径',
    fromStatus: String(row.status),
    toStatus: String(row.status),
    operator,
    detail: `管径由「${row['管径']}」改为「${trimmed}」（第 ${currentVersion} 版 → 第 ${currentVersion + 1} 版）`,
  })
  return { ok: true, message: `管径已改为「${trimmed}」，当前第 ${currentVersion + 1} 版` }
}

/** 倒查状态流转留痕：可按模块、按记录筛，新的在前。 */
export function queryStatusLogs(module?: string, rowId?: number): StatusLog[] {
  return listStatusLogs(module, rowId)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
