/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 排水管网的按井定位查询条件：三个文本条件叠加（与），管径按区间筛。 */
export type PipeQuery = {
  管段编号: string
  起点井号: string
  终点井号: string
  管径下限: string
  管径上限: string
  含已废弃: boolean
}

export type PipeQueryResult = PageResult & {
  /** 一段都没命中时，逐格指出哪个条件对不上 */
  mismatches: string[]
  /** 每个条件单独都能命中、但组合为空时为 true（条件之间张冠李戴） */
  combinationMiss: boolean
}

/** 状态流转留痕：谁在什么时候把哪一条从什么状态改成什么状态。 */
export type StatusLog = {
  id: number
  module: string
  rowId: number
  target: string
  action: string
  fromStatus: string
  toStatus: string
  operator: string
  time: string
  detail: string
}
