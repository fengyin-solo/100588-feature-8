// 状态 → 色调：结果列表里一眼看出状态，不用凑近读字。
const TONE_BY_STATUS: Record<string, string> = {
  待巡线: 'tone-info',
  运行正常: 'tone-ok',
  待清淤: 'tone-warn',
  已废弃: 'tone-dead',
  清淤中: 'tone-info',
  已完工: 'tone-ok',
  需返工: 'tone-bad',
}

export function statusTone(status: string): string {
  return TONE_BY_STATUS[status] ?? 'tone-info'
}
