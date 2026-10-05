// 冒烟验证：在 node 里模拟 localStorage，跑通管网查询/改管径/状态流转的核心逻辑。
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = new URL('..', import.meta.url).pathname
const out = join(mkdtempSync(join(tmpdir(), 'svc-')), 'svc.mjs')
await build({
  entryPoints: [join(root, 'src/api/local-service.ts')],
  bundle: true,
  format: 'esm',
  outfile: out,
  alias: { '@': join(root, 'src') },
  logLevel: 'silent',
})

// localStorage 垫片：两个独立实例模拟两个标签页共享同一存储。
const backing = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
  },
}

const svc = await import(pathToFileURL(out).href)
let failures = 0
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
}

// 1. 三条件叠加 + 管径区间 + 废弃默认排除
let r = svc.queryPipes({ 管段编号: '', 起点井号: 'J-0102', 终点井号: 'J-0103', 管径下限: '500', 管径上限: '700', 含已废弃: false })
check('井号叠加+管径区间命中 DRAI-0002', r.total === 1 && r.items[0]['管段编号'] === 'DRAI-0002')
r = svc.queryPipes({ 管段编号: '', 起点井号: '', 终点井号: '', 管径下限: '', 管径上限: '', 含已废弃: false })
check('已废弃默认不进结果', r.total === 3 && r.items.every((i) => i.status !== '已废弃'))
r = svc.queryPipes({ 管段编号: '', 起点井号: '', 终点井号: '', 管径下限: '', 管径上限: '', 含已废弃: true })
check('勾选含已废弃后 4 条', r.total === 4)

// 2. 空结果诊断：指出哪一格对不上
r = svc.queryPipes({ 管段编号: '', 起点井号: 'J-9999', 终点井号: '', 管径下限: '', 管径上限: '', 含已废弃: false })
check('井号抄错被点名', r.total === 0 && r.mismatches.some((m) => m.includes('起点井号') && m.includes('J-9999')))
r = svc.queryPipes({ 管段编号: '', 起点井号: '', 终点井号: '', 管径下限: '900', 管径上限: '1200', 含已废弃: false })
check('管径区间落空被点名', r.mismatches.some((m) => m.includes('管径区间')))
r = svc.queryPipes({ 管段编号: 'DRAI-0001', 起点井号: 'J-0102', 终点井号: '', 管径下限: '', 管径上限: '', 含已废弃: false })
check('条件张冠李戴给组合提示', r.total === 0 && r.combinationMiss === true)
r = svc.queryPipes({ 管段编号: 'DRAI-0004', 起点井号: '', 终点井号: '', 管径下限: '', 管径上限: '', 含已废弃: false })
check('只命中废弃段时提示勾选含已废弃', r.total === 0 && r.mismatches.some((m) => m.includes('含已废弃')))

// 3. 改管径乐观锁：后提交的被挡住
const before = svc.listEntries('drainpipe').items.find((i) => i['管段编号'] === 'DRAI-0001')
const v = Number(before.version ?? 1)
const ok1 = svc.updatePipeDiameter(before.id, 'DN500', v, '张三')
check('第一个人改管径成功', ok1.ok === true)
const ok2 = svc.updatePipeDiameter(before.id, 'DN700', v, '李四')
check('后提交的被挡住并提示看最新一版', ok2.ok === false && ok2.message.includes('最新一版') && ok2.message.includes('DN500'))
const after = svc.listEntries('drainpipe').items.find((i) => i['管段编号'] === 'DRAI-0001')
check('挡住后管径没被覆盖', after['管径'] === 'DN500' && Number(after.version) === v + 1)

// 4. 状态流转留痕 + 巡线办结同步清淤待开工台账
const act = svc.runAction('drainpipe', before.id, '安排清淤', '张三')
check('安排清淤成功且提示已同步台账', act.ok === true && act.message.includes('待开工台账'))
const dredge = svc.listEntries('dredge').items.filter((i) => i['清淤管段'] === 'DRAI-0001' && i.status === '待清淤')
check('清淤台账出现 DRAI-0001 待开工单', dredge.length === 1)
const act2 = svc.runAction('drainpipe', 2, '安排清淤', '李四')
check('第二段管安排清淤成功', act2.ok === true)
const dredge2 = svc.listEntries('dredge').items.filter((i) => i['清淤管段'] === 'DRAI-0002' && ['待清淤', '清淤中'].includes(i.status))
check('已有开口单不重复建', dredge2.length === 1 && dredge2[0]['清淤编号'] === 'DRED-0002')

const logs = svc.queryStatusLogs('drainpipe', before.id)
check('留痕可倒查：谁把 DRAI-0001 从待巡线改成待清淤', logs.some((l) => l.operator === '张三' && l.fromStatus === '待巡线' && l.toStatus === '待清淤'))
check('改管径也留了痕', logs.some((l) => l.action === '修改管径' && l.detail.includes('DN400') && l.detail.includes('DN500')))

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
