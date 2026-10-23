/**
 * test-gate.mjs —— run-gate 纯函数单测（不启动 BetterGI、不碰文件）
 * 用法：node test-gate.mjs     退出码 0=全过
 */
import { evaluateRunGate, statusForGate } from './run-gate.mjs';

const cases = [
  {
    name: '一切就绪（1080p + 前台 + BetterGI 未运行）',
    st: { bgiRunning: false, gameWindow: { clientWidth: 1920, clientHeight: 1080, is169: true, atLeast1080p: true, minimized: false, foreground: true } },
    expect: { canRun: true, blockers: 0, warnings: 0 },
  },
  {
    name: '720p（本机今晚的真实状态）→ 必须硬拦',
    st: { bgiRunning: false, gameWindow: { clientWidth: 1280, clientHeight: 720, is169: true, atLeast1080p: false, minimized: false, foreground: false, foregroundTitle: 'Bilibili' } },
    expect: { canRun: false, blockers: 1, warnings: 1 },
  },
  {
    name: '最小化 + 客户区 0x0 → 必须硬拦（两条）',
    st: { bgiRunning: false, gameWindow: { clientWidth: 0, clientHeight: 0, is169: false, atLeast1080p: false, minimized: true, foreground: false, foregroundTitle: 'DSH' } },
    expect: { canRun: false, blockers: 2, warnings: 1 },
  },
  {
    name: 'BetterGI 已在运行 → 必须硬拦（否则命令被吞）',
    st: { bgiRunning: true, gameWindow: { clientWidth: 1920, clientHeight: 1080, is169: true, atLeast1080p: true, minimized: false, foreground: true } },
    expect: { canRun: false, blockers: 1, warnings: 0 },
  },
  {
    name: '非 16:9（1920x1200）→ 硬拦',
    st: { bgiRunning: false, gameWindow: { clientWidth: 1920, clientHeight: 1200, is169: false, atLeast1080p: true, minimized: false, foreground: true } },
    expect: { canRun: false, blockers: 1, warnings: 0 },
  },
  {
    name: '只有"不在前台"这一条 → 允许跑（软警告）',
    st: { bgiRunning: false, gameWindow: { clientWidth: 1920, clientHeight: 1080, is169: true, atLeast1080p: true, minimized: false, foreground: false, foregroundTitle: 'DSH' } },
    expect: { canRun: true, blockers: 0, warnings: 1 },
  },
  {
    name: 'force=true 时硬阻断也放行，但要标注 forced',
    st: { bgiRunning: false, gameWindow: { clientWidth: 1280, clientHeight: 720, is169: true, atLeast1080p: false, minimized: false, foreground: true } },
    opts: { force: true },
    expect: { canRun: true, blockers: 1, warnings: 0, forced: true },
  },
  {
    name: '游戏没在运行（requireGame=true）→ 硬拦',
    st: { bgiRunning: false, gameWindow: null },
    expect: { canRun: false, blockers: 1, warnings: 0 },
  },
  {
    name: 'requireGame=false（例如只跑不需要游戏的步骤）→ 不因窗口拦',
    st: { bgiRunning: false, gameWindow: null },
    opts: { requireGame: false },
    expect: { canRun: true, blockers: 0, warnings: 0 },
  },
  {
    name: 'statusForGate 容错：状态缺失 → 保守判为不可跑（BetterGI 未知 + 无窗口 = 2 条阻断）',
    st: undefined,
    viaStatusForGate: true,
    expect: { canRun: false, blockers: 2, warnings: 0 },
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
