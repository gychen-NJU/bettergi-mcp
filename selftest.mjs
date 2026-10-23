#!/usr/bin/env node
/**
 * selftest.mjs —— BetterGI MCP 工具层的只读验收套件
 *
 * 目的：一条命令回答"这 27 个工具现在到底能不能用"。
 * 原则：
 *   · **只跑只读 / dry_run 分支**——不启动 BetterGI、不接管游戏、不改用户配置（唯一例外见下）；
 *   · 每个用例断言"输出里应出现的锚点"，而不是只看有没有报错；
 *   · 需要写盘的用例（安装脚本、建组、改配置、接一条龙）**不在这里跑**，列在末尾提示用手动流程验证。
 *
 * 用法：
 *   node selftest.mjs            # 全量（默认）
 *   node selftest.mjs --quiet    # 只打印失败与汇总
 *
 * 退出码：0=全过；1=有失败。
 */
import { spawn } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, 'bettergi-mcp.mjs');
const QUIET = process.argv.includes('--quiet');

const cp = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
let buf = '';
let nextId = 1;
const pending = new Map();

cp.stdout.setEncoding('utf8');
cp.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const r = pending.get(msg.id);
    if (r) { pending.delete(msg.id); r(msg); }
  }
});

function request(method, params, timeoutMs = 120000) {
  const id = nextId++;
  cp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((resolve) => {
    const t = setTimeout(() => { pending.delete(id); resolve({ timeout: true }); }, timeoutMs);
    pending.set(id, (m) => { clearTimeout(t); resolve(m); });
  });
}

async function call(name, args) {
  const r = await request('tools/call', { name, arguments: args || {} });
  if (r.timeout) return { isError: true, text: '（超时）', timeout: true };
  if (r.error) return { isError: true, text: `RPC 错误: ${JSON.stringify(r.error)}` };
  const text = (r.result?.content || []).map((c) => c.text).join('\n');
  return { isError: !!r.result?.isError, text };
}

/**
 * 用例：{ tool, args, expect: [锚点...], expectError?: true, note }
 * expect 全部命中才算通过（大小写敏感，锚点取输出里稳定出现的字串）。
 */
const CASES = [
  { tool: 'bgi_status', args: { json: false }, expect: ['BetterGI 状态'], note: '人读形态' },
  { tool: 'bgi_status', args: { json: true }, expect: ['"root"'], note: 'JSON 形态（默认）' },
  { tool: 'bgi_doctor', args: { material: '星螺' }, expect: ['体检', '配置组', '资产版本', 'JS 图片资产'], note: '含配置组完整性/版本门禁/图片资产魔数' },
  { tool: 'bgi_schedule_info', args: {}, expect: ['计划任务', '配置组'] },
  { tool: 'bgi_results', args: {}, expect: ['执行战果'], note: '无记录也要优雅报告' },
  { tool: 'bgi_log_search', args: { levels: ['INF'], tail: 3 }, expect: ['日志检索'] },
  { tool: 'bgi_log_search', args: { pattern: '匹配到战斗脚本', tail: 2 }, expect: ['日志检索'] },
  { tool: 'bgi_wait_milestone', args: { milestone: 'finished', wait_seconds: 2 }, expect: ['里程碑'] },
  { tool: 'bgi_watch', args: { mode: 'oneDragon', wait_seconds: 0 }, expect: ['结论'] },
  { tool: 'bgi_focus_game', args: { no_focus: true }, expect: ['窗口就绪检查'], note: '最小化/不可用时按 ⛔ 报告，不算工具失败' },
  { tool: 'bgi_start_game', args: { dry_run: true }, expect: ['Would run'] },
  { tool: 'bgi_run_one_dragon', args: { dry_run: true }, expect: ['Would run'] },
  { tool: 'bgi_run_groups', args: { groups: ['采集-星螺'], dry_run: true }, expect: ['Would run'] },
  { tool: 'bgi_set_config', args: { changes: [{ path: 'autoDomainConfig.condensedResinUseCount', value: 5 }], dry_run: true }, expect: ['DryRun'] },
  { tool: 'bgi_set_onedragon', args: { min_resin_to_keep: 0, dry_run: true }, expect: [] },
  { tool: 'bgi_list_strategies', args: {}, expect: ['策略'] },
  { tool: 'bgi_list_groups', args: {}, expect: ['配置组'] },
  { tool: 'bgi_list_pathing', args: { filter: '星螺' }, expect: ['星螺'] },
  { tool: 'bgi_find_routes', args: { material: '星螺' }, expect: ['主命中'] },
  { tool: 'bgi_repo_index', args: { kind: 'js', filter: '委托' }, expect: ['js/'] },
  { tool: 'bgi_list_js_scripts', args: { filter: '委托' }, expect: ['委托'] },
  { tool: 'bgi_js_settings', args: { name: '使用历练点完成每日委托' }, expect: ['可配置项'] },
  { tool: 'bgi_js_settings', args: { name: '使用历练点完成每日委托', set: { adventurePath: '火星' } }, expect: ['只能取'], expectError: true, note: '非法值必须被拒且不写入' },
  { tool: 'bgi_install_js', args: { name: '使用历练点完成每日委托' }, expect: ['manifest.json 就位'], note: '幂等：文件已存在则只校验不重下（回归保护：曾因文本下载写坏 15 张识别图）' },
  { tool: 'bgi_close', args: { target: 'bettergi', dry_run: true }, expect: ['关闭'], note: 'dry_run 只报告，不动手' },
  { tool: 'bgi_create_onedragon', args: { config: '日常', dry_run: true }, expect: ['Name'], expectError: true, note: '与现有配置 Name 重名必须被拒（命令行按 Name 匹配，重名会不确定命中）' },
  { tool: 'bgi_create_onedragon', args: { config: '_selftest-od', dry_run: true }, expect: ['将创建'], note: 'dry_run 只预览不写文件' },
  { tool: 'bgi_add_group_to_onedragon', args: { group: '采集-星螺' }, expect: ['confirm'], expectError: true, note: '缺 confirm 必须拒绝' },
  { tool: 'bgi_collect_material', args: { material: '星螺' }, expect: ['配置组'], note: '幂等：文件已存在则不下载' },
  { tool: 'bgi_collect_now', args: { material: '星螺', dry_run: true }, expect: ['dry_run'], note: 'dry_run 不抢前台' },
];

/** 只在这些地方跑：需要写盘/接管游戏，套件不自动执行 */
const MANUAL = [
  'bgi_run_task_progress（会真的拉起 BetterGI）',
  'bgi_run_groups / bgi_run_one_dragon / bgi_start_game 不带 dry_run（会接管游戏）',
  'bgi_add_group_to_onedragon 带 confirm:true（改每日流程）',
  'bgi_set_config / bgi_set_onedragon 不带 dry_run（改用户配置，需 BetterGI 已退出）',
];

/**
 * --live：额外跑"写盘但可逆"的用例（用一个临时配置组，跑完删掉）。
 * 不会碰用户既有资产，也不会启动 BetterGI。
 */
const LIVE_CASES = [
  {
    tool: 'bgi_create_group',
    args: { name: '_selftest-tmp', type: 'Pathing', targets: ['01-星螺-瑶光滩-17个.json'], folder: '地方特产/璃月/星螺' },
    expect: ['配置组'],
    note: '建临时配置组（结束即删）',
    cleanupFile: 'D:\\software\\BetterGI\\User\\ScriptGroup\\_selftest-tmp.json',
  },
  {
    tool: 'bgi_run_js',
    args: { name: '使用历练点完成每日委托', run: false },
    expect: ['配置组'],
    note: '幂等：脚本已装则只重建组',
  },
];

const main = async () => {
  const LIVE = process.argv.includes('--live');
  const init = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'selftest', version: '1' } }, 15000);
  if (!init.result) { console.error('初始化失败：', JSON.stringify(init)); cp.kill(); process.exit(1); }
  cp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const list = await request('tools/list', {}, 15000);
  const tools = list.result?.tools || [];
  const cases = LIVE ? [...CASES, ...LIVE_CASES] : [...CASES];
  console.log(`BetterGI MCP 自检  ·  服务器暴露工具 ${tools.length} 个  ·  用例 ${cases.length} 个${LIVE ? '（含 --live 写盘用例）' : '（仅只读）'}\n`);

  let pass = 0;
  const failures = [];
  for (const c of cases) {
    const r = await call(c.tool, c.args);
    const missing = (c.expect || []).filter((m) => !r.text.includes(m));
    const errOk = c.expectError ? r.isError : !r.isError;
    const ok = errOk && missing.length === 0;
    if (ok) pass++;
    else failures.push({ ...c, r, missing, errOk });
    if (!QUIET || !ok) {
      const mark = ok ? '✅' : '❌';
      const extra = c.note ? `  (${c.note})` : '';
      console.log(`${mark} ${c.tool}${extra}`);
      if (!ok) {
        console.log(`   期望错误态=${!!c.expectError} 实得=${r.isError}；缺少锚点=${JSON.stringify(missing)}`);
        console.log('   输出片段：' + r.text.split('\n').slice(0, 4).join(' / ').slice(0, 300));
      }
    }
    // 临时产物清理：--live 建的临时配置组不允许留在用户目录里（失败要报出来，别静默吞掉）
    if (c.cleanupFile) {
      try {
        if (existsSync(c.cleanupFile)) {
          rmSync(c.cleanupFile, { force: true });
          console.log(`   ↳ 已清理临时文件 ${path.basename(c.cleanupFile)}`);
        }
      } catch (e) {
        console.log(`   ⚠ 临时文件清理失败：${e.message}（请手动删除 ${c.cleanupFile}）`);
      }
    }
  }

  console.log(`\n结果：${pass}/${cases.length} 通过`);
  if (failures.length) {
    console.log('\n失败清单：');
    for (const f of failures) console.log(`  · ${f.tool}`);
  }
  console.log('\n未纳入自检（会接管游戏或改用户既有配置，请人工按需验证）：');
  for (const m of MANUAL) console.log(`  · ${m}`);

  const uncovered = tools.map((t) => t.name).filter((n) => !cases.some((c) => c.tool === n));
  console.log(`\n覆盖率：${cases.length} 用例触及 ${new Set(cases.map((c) => c.tool)).size}/${tools.length} 个工具；未触及：${uncovered.join(', ') || '（无）'}`);

  cp.kill();
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => { console.error('自检异常：', e); cp.kill(); process.exit(2); });
