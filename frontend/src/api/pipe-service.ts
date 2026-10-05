import { moduleMeta, runAction } from '@/api/local-service'
import { appendChangeLog, listChangeLogs } from '@/data/change-log'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, ChangeLogRow, EntryRow } from '@/data/types'

// 排水管网专用服务：按井定位的组合查询、管径区间筛选、乐观锁改管径、
// 状态留痕倒查、巡线办结后同步清淤待开工台账。页面不直接碰 local-store。

export type PipeQuery = {
  管段编号: string
  起点井号: string
  终点井号: string
  管径下限: string
  管径上限: string
  包含已废弃: boolean
}

export type PipeQueryResult = {
  items: EntryRow[]
  total: number
  /** 一段都没命中时的诊断：哪一格填得对不上，逐条列给人看。 */
  diagnosis: string[]
}

type Criterion = {
  label: string
  input: string
  test: (row: EntryRow) => boolean
}

const ABANDONED = '已废弃'
const DREDGE_OPEN_STATUSES = ['待清淤', '清淤中']

export function queryPipes(query: PipeQuery): PipeQueryResult {
  const all = listRows('drainpipe')
  // 已废弃默认不进结果，勾了「含已废弃」才放进来。
  const base = query.包含已废弃 ? all : all.filter((row) => String(row.status) !== ABANDONED)
  const criteria: Criterion[] = []
  const diagnosis: string[] = []

  const code = query.管段编号.trim()
  if (code) {
    criteria.push({ label: '管段编号', input: code, test: (row) => String(row['管段编号'] ?? '').includes(code) })
  }
  const start = query.起点井号.trim()
  if (start) {
    criteria.push({ label: '起点井号', input: start, test: (row) => String(row['起点井号'] ?? '').includes(start) })
  }
  const end = query.终点井号.trim()
  if (end) {
    criteria.push({ label: '终点井号', input: end, test: (row) => String(row['终点井号'] ?? '').includes(end) })
  }

  const minRaw = query.管径下限.trim()
  const maxRaw = query.管径上限.trim()
  const min = minRaw === '' ? null : Number(minRaw)
  const max = maxRaw === '' ? null : Number(maxRaw)
  if (min !== null && !Number.isFinite(min)) {
    diagnosis.push(`管径下限「${minRaw}」不是数字，这一格没参与筛选`)
  }
  if (max !== null && !Number.isFinite(max)) {
    diagnosis.push(`管径上限「${maxRaw}」不是数字，这一格没参与筛选`)
  }
  const lo = min !== null && Number.isFinite(min) ? min : null
  const hi = max !== null && Number.isFinite(max) ? max : null
  if (lo !== null || hi !== null) {
    criteria.push({
      label: '管径区间',
      input: `${lo ?? '不限'}~${hi ?? '不限'}mm`,
      test: (row) => {
        const diameter = Number(row['管径'])
        if (!Number.isFinite(diameter)) {
          return false
        }
        if (lo !== null && diameter < lo) {
          return false
        }
        if (hi !== null && diameter > hi) {
          return false
        }
        return true
      },
    })
  }

  const items = base.filter((row) => criteria.every((criterion) => criterion.test(row)))

  if (items.length === 0) {
    if (criteria.length === 0) {
      if (base.length === 0 && all.length > 0) {
        diagnosis.push('在册管段全部已废弃，默认不进结果；勾选「含已废弃」再看')
      }
    } else {
      // 逐格单测：哪一格自己就在册管段里一条都命不中，就是哪一格填得对不上。
      const misses = criteria.filter((criterion) => !base.some(criterion.test))
      for (const miss of misses) {
        diagnosis.push(`${miss.label}「${miss.input}」对不上：在册管段里没有一条能满足这一格`)
      }
      if (misses.length === 0) {
        diagnosis.push('每个条件单独都能命中，但叠在一起没有同时满足的管段，检查是不是把不同管段的条件填串了')
      }
      if (!query.包含已废弃) {
        const abandonedHits = all.filter(
          (row) => String(row.status) === ABANDONED && criteria.every((criterion) => criterion.test(row)),
        ).length
        if (abandonedHits > 0) {
          diagnosis.push(`另有 ${abandonedHits} 段已废弃管段命中这些条件，默认不进结果，需要的话勾选「含已废弃」`)
        }
      }
    }
  }

  return { items, total: items.length, diagnosis }
}

export function getPipe(id: number): EntryRow | null {
  return listRows('drainpipe').find((row) => Number(row.id) === id) ?? null
}

export function pipeStatusCounts(): { label: string; value: number }[] {
  const rows = listRows('drainpipe')
  const count = (status: string) => rows.filter((row) => String(row.status) === status).length
  return [
    { label: '运行正常管段', value: count('运行正常') },
    { label: '待清淤管段', value: count('待清淤') },
    { label: '待巡线管段', value: count('待巡线') },
    { label: '已废弃管段', value: count(ABANDONED) },
  ]
}

/**
 * 改管径带乐观锁：打开编辑框时记下版本号，提交时版本对不上说明别人先改了，
 * 这次提交被挡下，提示先看最新一版。
 */
export function updatePipeDiameter(
  id: number,
  nextDiameter: number,
  expectedVersion: number,
  operator: string,
): ActionResult {
  const rows = listRows('drainpipe')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的排水管段` }
  }
  const current = rows[index]
  const version = Number(current.version ?? 1)
  if (version !== expectedVersion) {
    return {
      ok: false,
      message: `提交被拦下：管段 ${current['管段编号']} 的管径已是「${current['管径']}mm」（第 ${version} 版），你手里改的是第 ${expectedVersion} 版，先看最新一版再提交`,
    }
  }
  if (String(current['管径']) === String(nextDiameter)) {
    return { ok: false, message: `管径本来就是 ${nextDiameter}mm，没有改动` }
  }
  const updated: EntryRow = { ...current, '管径': nextDiameter, version: version + 1 }
  const next = [...rows]
  next[index] = updated
  saveRows('drainpipe', next)
  appendChangeLog({
    module: 'drainpipe',
    rowId: id,
    code: String(current['管段编号'] ?? id),
    category: '管径修改',
    action: '修改管径',
    fromValue: `${current['管径']}mm`,
    toValue: `${nextDiameter}mm`,
    operator,
  })
  return { ok: true, message: `管段 ${current['管段编号']} 管径已改为 ${nextDiameter}mm（第 ${version + 1} 版）` }
}

/** 管段动作：走通用流转，巡线办结转「待清淤」时把结果同步进清淤待开工台账。 */
export function runPipeAction(id: number, action: string, operator: string): ActionResult {
  const result = runAction('drainpipe', id, action, operator)
  if (!result.ok) {
    return result
  }
  const meta = moduleMeta('drainpipe')
  if (meta.actionTargets[action] !== '待清淤') {
    return result
  }
  const pipe = getPipe(id)
  if (!pipe) {
    return result
  }
  const sync = syncDredgeLedger(pipe)
  if (sync.existed) {
    return { ok: true, message: `${result.message}；清淤待开工台账里已有这段管的 ${sync.code}，没重复建单` }
  }
  return { ok: true, message: `${result.message}；已同步清淤待开工台账（${sync.code}）` }
}

/** 巡线办结要清淤的管段，在清淤模块补一条「待清淤」记录，就是班组的待开工台账。 */
function syncDredgeLedger(pipe: EntryRow): { code: string | null; existed: boolean } {
  const rows = listRows('dredge')
  const pipeCode = String(pipe['管段编号'] ?? '')
  const open = rows.find(
    (row) => String(row['清淤管段']) === pipeCode && DREDGE_OPEN_STATUSES.includes(String(row.status)),
  )
  if (open) {
    return { code: String(open['清淤编号'] ?? ''), existed: true }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const code = `DRED-${String(id).padStart(4, '0')}`
  const today = new Date().toISOString().slice(0, 10)
  const row: EntryRow = {
    id,
    status: '待清淤',
    pending: true,
    abnormal: false,
    '清淤编号': code,
    '清淤管段': pipeCode,
    '淤积厚度': '待检测',
    '清淤方式': '待定',
    '清淤班组': '待派班',
    '清淤日期': today,
    '清淤量': '—',
    '清淤状态': '待清淤',
  }
  saveRows('dredge', [...rows, row])
  return { code, existed: false }
}

/** 留痕倒查：不传编号看全部，传了按管段编号过滤。 */
export function pipeChangeLogs(code?: string): ChangeLogRow[] {
  const logs = listChangeLogs('drainpipe')
  const keyword = code?.trim()
  if (!keyword) {
    return logs
  }
  return logs.filter((log) => log.code.includes(keyword))
}
