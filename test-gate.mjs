/**
 * test-gate.mjs —— run-gate 纯函数单测（不启动 BetterGI、不碰文件）
 * 用法：node test-gate.mjs     退出码 0=全过
 */
import { evaluateRunGate, statusForGate } from './run-gate.mjs';

// 采集侧（bgi-status.ps1）输出的 session 字段样板：交互会话、已解锁
const SESS_OK = { sessionId: 1, state: 0, stateName: 'Active', flags: 1, locked: false, known: true };
// 1080p + 前台 + 未最小化的合格窗口样板
const GW_OK = { clientWidth: 1920, clientHeight: 1080, is169: true, atLeast1080p: true, minimized: false, foreground: true };

const cases = [
  {
    name: '一切就绪（1080p + 前台 + BetterGI 未运行 + 会话正常）',
    st: { bgiRunning: false, session: SESS_OK, gameWindow: GW_OK },
    expect: { canRun: true, blockers: 0, warnings: 0 },
  },
  {
    name: '720p（本机今晚的真实状态）→ 必须硬拦',
    st: { bgiRunning: false, session: SESS_OK, gameWindow: { clientWidth: 1280, clientHeight: 720, is169: true, atLeast1080p: false, minimized: false, foreground: false, foregroundTitle: 'Bilibili' } },
    expect: { canRun: false, blockers: 1, warnings: 1 },
  },
  {
    name: '最小化 + 客户区 0x0 → 必须硬拦（两条）',
    st: { bgiRunning: false, session: SESS_OK, gameWindow: { clientWidth: 0, clientHeight: 0, is169: false, atLeast1080p: false, minimized: true, foreground: false, foregroundTitle: 'DSH' } },
    expect: { canRun: false, blockers: 2, warnings: 1 },
  },
  {
    name: 'BetterGI 已在运行 → 必须硬拦（否则命令被吞）',
    st: { bgiRunning: true, session: SESS_OK, gameWindow: GW_OK },
    expect: { canRun: false, blockers: 1, warnings: 0 },
  },
  {
    name: '非 16:9（1920x1200）→ 硬拦',
    st: { bgiRunning: false, session: SESS_OK, gameWindow: { clientWidth: 1920, clientHeight: 1200, is169: false, atLeast1080p: true, minimized: false, foreground: true } },
    expect: { canRun: false, blockers: 1, warnings: 0 },
  },
  {
    name: '只有"不在前台"这一条 → 允许跑（软警告）',
    st: { bgiRunning: false, session: SESS_OK, gameWindow: { clientWidth: 1920, clientHeight: 1080, is169: true, atLeast1080p: true, minimized: false, foreground: false, foregroundTitle: 'DSH' } },
    expect: { canRun: true, blockers: 0, warnings: 1 },
  },
  {
    name: 'force=true 时硬阻断也放行，但要标注 forced',
    st: { bgiRunning: false, session: SESS_OK, gameWindow: { clientWidth: 1280, clientHeight: 720, is169: true, atLeast1080p: false, minimized: false, foreground: true } },
    opts: { force: true },
    expect: { canRun: true, blockers: 1, warnings: 0, forced: true },
  },
  {
    name: '游戏没在运行（requireGame=true）→ 硬拦',
    st: { bgiRunning: false, session: SESS_OK, gameWindow: null },
    expect: { canRun: false, blockers: 1, warnings: 0 },
  },
  {
    name: 'requireGame=false（例如只跑不需要游戏的步骤）→ 不因窗口拦',
    st: { bgiRunning: false, session: SESS_OK, gameWindow: null },
    opts: { requireGame: false },
    expect: { canRun: true, blockers: 0, warnings: 0 },
  },
  {
    name: 'statusForGate 容错：状态缺失 → 保守判为不可跑（BetterGI 未知 + 无窗口 = 2 条阻断；session 未知另给 1 条软警告）',
    st: undefined,
    viaStatusForGate: true,
    expect: { canRun: false, blockers: 2, warnings: 1 },
  },

  // ─────────── 锁屏 / 会话（2026-11-19 新增，口径来自 ZMAL-PC 2026-11-17 全链路实测） ───────────
  {
    name: '屏幕已锁定（SessionFlags=0=LOCK）→ 必须硬拦（否则静默白跑）',
    st: { bgiRunning: false, session: { ...SESS_OK, flags: 0, locked: true }, gameWindow: GW_OK },
    expect: { canRun: false, blockers: 1, warnings: 0 },
  },
  {
    name: 'Session 0（SSH/服务会话，无桌面输入权限）→ 必须硬拦',
    st: { bgiRunning: false, session: { ...SESS_OK, sessionId: 0 }, gameWindow: GW_OK },
    expect: { canRun: false, blockers: 1, warnings: 0 },
  },
  {
    name: '锁屏 + Session 0 同时命中 → 两条阻断都要报',
    st: { bgiRunning: false, session: { ...SESS_OK, sessionId: 0, flags: 0, locked: true }, gameWindow: GW_OK },
    expect: { canRun: false, blockers: 2, warnings: 0 },
  },
  {
    name: '探测失败（known:false）→ 软警告不硬拦（不能误杀旧环境）',
    st: { bgiRunning: false, session: { sessionId: 1, state: null, stateName: null, flags: null, locked: null, known: false }, gameWindow: GW_OK },
    expect: { canRun: true, blockers: 0, warnings: 1 },
  },
  {
    name: '旧版 bettergi-control（status 里根本没有 session 字段）→ 软警告不硬拦',
    st: { bgiRunning: false, gameWindow: GW_OK },
    expect: { canRun: true, blockers: 0, warnings: 1 },
  },
  {
    name: 'force=true 时锁屏也放行，但要标注 forced',
    st: { bgiRunning: false, session: { ...SESS_OK, flags: 0, locked: true }, gameWindow: GW_OK },
    opts: { force: true },
    expect: { canRun: true, blockers: 1, warnings: 0, forced: true },
  },
  {
    name: 'statusForGate 透传 session：锁屏状态穿过映射后仍被硬拦',
    st: { bgiRunning: false, session: { ...SESS_OK, flags: 0, locked: true }, gameWindow: GW_OK },
    viaStatusForGate: true,
    expect: { canRun: false, blockers: 1, warnings: 0 },
  },
];

let pass = 0;
const failures = [];
for (const c of cases) {
  const st = c.viaStatusForGate ? statusForGate(c.st) : c.st;
  const gate = evaluateRunGate(st, c.opts || {});
  const got = {
    canRun: gate.canRun,
    blockers: gate.blockers.length,
    warnings: gate.warnings.length,
    forced: gate.forced,
  };
  const want = c.expect;
  const ok = got.canRun === want.canRun &&
    got.blockers === want.blockers &&
    got.warnings === want.warnings &&
    (want.forced === undefined || got.forced === want.forced);
  if (ok) { pass++; console.log(`✅ ${c.name}`); }
  else {
    failures.push(c.name);
    console.log(`❌ ${c.name}`);
    console.log(`   期望 ${JSON.stringify(want)}  实得 ${JSON.stringify(got)}`);
    for (const b of gate.blockers) console.log(`     阻断: ${b}`);
    for (const w of gate.warnings) console.log(`     警告: ${w}`);
  }
}

console.log(`\n结果：${pass}/${cases.length} 通过`);
if (failures.length) { console.log('失败：' + failures.join(' / ')); process.exit(1); }
process.exit(0);
