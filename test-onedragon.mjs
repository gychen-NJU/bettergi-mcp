/**
 * test-onedragon.mjs —— 一条龙「建配置 / 接配置组 / 改任务顺序」的集成测试
 *
 * 全程只动一个**临时配置** `_selftest-od`（从「日常」复制），跑完删除；用户既有配置只做只读校验。
 * 用法：node test-onedragon.mjs     退出码 0=全过
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const BGI = 'D:\\software\\BetterGI';
const OD = path.join(BGI, 'User', 'OneDragon');
const TMP = '_selftest-od';
const SERVER = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'bettergi-mcp.mjs');

const readCfg = (n) => JSON.parse(readFileSync(path.join(OD, `${n}.json`), 'utf8').replace(/^\uFEFF/, ''));
const tasksOf = (c) => (c.TaskOrder || []).map((id) => c.TaskDefinitions?.[id] || id);
const backups = () => readdirSync(BGI).filter((n) => n.startsWith('_backup_')).sort();

const beforeDaily = readCfg('日常');
const beforeWith = readCfg('日常-含委托');
const backupBefore = backups();

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
const req = (method, params, t = 120000) => new Promise((res) => {
  const i = id++;
  cp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n');
  const to = setTimeout(() => res({ timeout: true }), t);
  pend.set(i, (x) => { clearTimeout(to); res(x); });
});
const call = async (name, args) => {
  const r = await req('tools/call', { name, arguments: args || {} });
  return { err: !!r.result?.isError, text: (r.result?.content || []).map((c) => c.text).join('\n') };
};

let fails = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };

await req('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
cp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

// 清理上次残留
try { rmSync(path.join(OD, `${TMP}.json`), { force: true }); } catch { }

// ① 建临时配置
const c1 = await call('bgi_create_onedragon', { config: TMP, from: '日常' });
check('① 新建临时配置', !c1.err && existsSync(path.join(OD, `${TMP}.json`)));
const tmpCfg = readCfg(TMP);
check('   Name 字段已改动（不是模板名）', tmpCfg.Name === TMP, `Name=${tmpCfg.Name}`);
check('   初始任务与模板一致', JSON.stringify(tasksOf(tmpCfg)) === JSON.stringify(tasksOf(beforeDaily)), tasksOf(tmpCfg).join(' → '));

// ② 把配置组接进去（真实写入）
const c2 = await call('bgi_add_group_to_onedragon', { group: '采集-星螺', config: TMP, confirm: true });
check('② 接入配置组（confirm:true）', !c2.err, c2.text.split('\n')[0]);
const after2 = readCfg(TMP);
const t2 = tasksOf(after2);
check('   任务表里出现了该配置组', t2.includes('采集-星螺'), t2.join(' → '));
const gid = after2.TaskOrder[t2.indexOf('采集-星螺')];
check('   TaskEnabledList 标为启用', after2.TaskEnabledList[gid] === true);
check('   TaskDefinitions 有 GUID→名字映射', after2.TaskDefinitions[gid] === '采集-星螺');

// ③ 幂等：再接一次应当"未改动"
const c3 = await call('bgi_add_group_to_onedragon', { group: '采集-星螺', config: TMP, confirm: true });
check('③ 重复接入是幂等的', !c3.err && /已经在一條龙|已经在一条龙/.test(c3.text), c3.text.split('\n')[0]);
const after3 = readCfg(TMP);
check('   任务表没有重复项', tasksOf(after3).filter((x) => x === '采集-星螺').length === 1);

// ④ 改任务顺序（未列出的应被停用）
const c4 = await call('bgi_set_onedragon', { config: TMP, tasks: ['领取邮件', '采集-星螺', '自动秘境'] });
check('④ 改任务顺序', !c4.err);
const after4 = readCfg(TMP);
const t4 = tasksOf(after4);
check('   顺序正确', JSON.stringify(t4) === JSON.stringify(['领取邮件', '采集-星螺', '自动秘境']), t4.join(' → '));
const disabled = Object.entries(after4.TaskEnabledList).filter(([k, v]) => v !== true).map(([k]) => after4.TaskDefinitions[k] || k);
check('   未列出的任务被停用', disabled.includes('合成树脂') && disabled.includes('领取每日奖励'), `停用：${disabled.join('、')}`);

// ⑤ 触发命令预览（应指向临时配置）
const c5 = await call('bgi_run_one_dragon', { config: TMP, dry_run: true });
check('⑤ 触发命令指向该配置', /startOneDragon _selftest-od/.test(c5.text), (c5.text.match(/Would run: .*/) || [''])[0]);

// ⑥ 备份存在
const backupAfter = backups();
check('⑥ 产生了备份目录', backupAfter.length > backupBefore.length, `${backupBefore.length} → ${backupAfter.length}`);

// ⑦ 用户既有配置一字未动
const afterDaily = readCfg('日常');
const afterWith = readCfg('日常-含委托');
check('⑦ 日常.json 未被改动', JSON.stringify(afterDaily) === JSON.stringify(beforeDaily));
check('   日常-含委托.json 未被改动', JSON.stringify(afterWith) === JSON.stringify(beforeWith));

// 清理临时配置
try { rmSync(path.join(OD, `${TMP}.json`), { force: true }); console.log('   ↳ 已删除临时配置 _selftest-od.json'); } catch (e) { console.log('   ⚠ 清理失败：' + e.message); fails++; }
check('⑧ 临时配置已清理', !existsSync(path.join(OD, `${TMP}.json`)));
const remain = readdirSync(OD).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
check('   只剩用户自己的配置', remain.length === 2 && remain.includes('日常') && remain.includes('日常-含委托'), remain.join(', '));

console.log(`\n结果：${fails === 0 ? '全部通过 ✓' : fails + ' 项失败 ✗'}`);
cp.kill();
process.exit(fails ? 1 : 0);
