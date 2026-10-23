// test-setconfig.mjs —— bgi_set_config 真实写入往返测试（选完全惰性的字段，跑完还原）
// 用法：node test-setconfig.mjs
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const BGI = 'D:\\software\\BetterGI';
const CFG = path.join(BGI, 'User', 'config.json');
const SERVER = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'bettergi-mcp.mjs');

const orig = JSON.parse(readFileSync(CFG, 'utf8').replace(/^\uFEFF/, ''));
// 选**四层且无歧义**的惰性字段：miyousheDataConfig 是 farmingPlanConfig 的嵌套对象，其内 dailyEliteCap/dailyMobCap 各只出现一次
// （顶层 farmingPlanConfig 里也有同名字段，所以不能用 otherConfig.farmingPlanConfig.* —— 脚本会正确地拒绝歧义路径）
const P1 = 'otherConfig.farmingPlanConfig.miyousheDataConfig.dailyEliteCap';
const P2 = 'otherConfig.farmingPlanConfig.miyousheDataConfig.dailyMobCap';
const v1 = orig.otherConfig.farmingPlanConfig.miyousheDataConfig.dailyEliteCap;
const v2 = orig.otherConfig.farmingPlanConfig.miyousheDataConfig.dailyMobCap;
console.log(`原始值：${P1}=${v1}  ${P2}=${v2}（miyoushe 数据配置，采集计划未启用 → 字段惰性）`);

const cp = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'ignore'] });
let buf = '', id = 1; const pend = new Map();
cp.stdout.setEncoding('utf8');
cp.stdout.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!l) continue;
    let m; try { m = JSON.parse(l); } catch { continue; }
    const r = pend.get(m.id); if (r) { pend.delete(m.id); r(m); }
  }
});
const req = (m, p, t = 120000) => new Promise((res) => {
  const i = id++;
  cp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method: m, params: p }) + '\n');
  const to = setTimeout(() => res({ timeout: true }), t);
  pend.set(i, (x) => { clearTimeout(to); res(x); });
});
const call = async (n, a) => {
  const r = await req('tools/call', { name: n, arguments: a || {} });
  return { err: !!r.result?.isError, text: (r.result?.content || []).map((c) => c.text).join('\n') };
};
const readCfg = () => JSON.parse(readFileSync(CFG, 'utf8').replace(/^\uFEFF/, ''));
const backups = () => (existsSync(BGI) ? readdirSync(BGI).filter((n) => n.startsWith('_backup_')) : []).sort();

await req('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
cp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

// ① 多改动 dry_run（修复前这里会报"格式应为 父.子=值"）
const dry = await call('bgi_set_config', { changes: [{ path: P1, value: v1 + 1 }, { path: P2, value: v2 + 1 }], dry_run: true });
check('多改动 dry_run 不再报格式错误', !dry.err && !/参数格式/.test(dry.text), dry.text.split('\n').slice(0, 2).join(' | '));

// ② 真实多改动写入
const before = backups().length;
const w = await call('bgi_set_config', { changes: [{ path: P1, value: v1 + 1 }, { path: P2, value: v2 + 1 }] });
const after1 = readCfg();
check('真实写入成功（无错误）', !w.err);
check('两个字段都被写成新值', after1.otherConfig.farmingPlanConfig.miyousheDataConfig.dailyEliteCap === v1 + 1 && after1.otherConfig.farmingPlanConfig.miyousheDataConfig.dailyMobCap === v2 + 1,
  `实得 ${after1.otherConfig.farmingPlanConfig.miyousheDataConfig.dailyEliteCap}/${after1.otherConfig.farmingPlanConfig.miyousheDataConfig.dailyMobCap}`);
check('产生了备份目录', backups().length > before, `备份数 ${before} → ${backups().length}`);

// ③ 还原
const r = await call('bgi_set_config', { changes: [{ path: P1, value: v1 }, { path: P2, value: v2 }] });
const final = readCfg();
check('还原成功', !r.err);
check('字段已还原为原始值', final.otherConfig.farmingPlanConfig.miyousheDataConfig.dailyEliteCap === v1 && final.otherConfig.farmingPlanConfig.miyousheDataConfig.dailyMobCap === v2,
  `实得 ${final.otherConfig.farmingPlanConfig.miyousheDataConfig.dailyEliteCap}/${final.otherConfig.farmingPlanConfig.miyousheDataConfig.dailyMobCap}`);
check('顶层键数量未变', Object.keys(final).length === Object.keys(orig).length, `${Object.keys(orig).length} → ${Object.keys(final).length}`);

// ④ 非法参数必须被拒
const bad = await call('bgi_set_config', { changes: [{ path: 'nokey', value: 1 }] });
check('非法 path（没有父.子）被拒', bad.err);
const bad2 = await call('bgi_set_config', { changes: [] });
check('空 changes 被拒', bad2.err);

console.log(`\n结果：${failures === 0 ? '全部通过 ✓' : failures + ' 项失败 ✗'}`);
cp.kill();
process.exit(failures ? 1 : 0);
