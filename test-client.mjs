#!/usr/bin/env node
/**
 * 冒烟测试：以 MCP 客户端身份驱动 bettergi-mcp.mjs（stdio JSON-RPC），
 * 验证 握手 → tools/list → tools/call 的真实往返。
 * 用法：node test-client.mjs [--live]   （--live 时额外执行会改本机状态的调用）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, 'bettergi-mcp.mjs');
const LIVE = process.argv.includes('--live');

const cp = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
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
    try { msg = JSON.parse(line); } catch { console.log('!! 非 JSON 输出:', line.slice(0, 200)); continue; }
    const r = pending.get(msg.id);
    if (r) { pending.delete(msg.id); r(msg); }
    else console.log('!! 未匹配的响应:', JSON.stringify(msg).slice(0, 200));
  }
});

function request(method, params, timeoutMs = 180000) {
  const id = nextId++;
  cp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((resolve) => {
    const t = setTimeout(() => { pending.delete(id); resolve({ timeout: true, id }); }, timeoutMs);
    pending.set(id, (m) => { clearTimeout(t); resolve(m); });
  });
}

const show = (label, text, max = 1400) => {
  const t = String(text ?? '');
  console.log(`\n──────── ${label} ────────`);
  console.log(t.length > max ? t.slice(0, max) + `\n…（共 ${t.length} 字）` : t);
};

const call = async (name, args) => {
  const r = await request('tools/call', { name, arguments: args || {} });
  if (r.timeout) return { isError: true, text: '（超时）' };
  if (r.error) return { isError: true, text: `RPC 错误: ${JSON.stringify(r.error)}` };
  const text = (r.result?.content || []).map((c) => c.text).join('\n');
  return { isError: !!r.result?.isError, text };
};

const main = async () => {
  const init = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } }, 15000);
  show('1) initialize', JSON.stringify(init.result, null, 2));
  cp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const list = await request('tools/list', {}, 15000);
  const tools = list.result?.tools || [];
  show('2) tools/list', `${tools.length} 个工具：\n` + tools.map((t) => `  · ${t.name}`).join('\n'));

  let pass = 0, fail = 0;
  const check = (name, cond, detail) => { (cond ? pass++ : fail++); console.log(`  ${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

  console.log('\n──────── 3) 工具实调 ────────');
  const st = await call('bgi_status', { json: false });
  show('bgi_status(json=false)', st.text, 900);
  check('bgi_status 返回', !st.isError && /BetterGI 状态/.test(st.text));

  const stj = await call('bgi_status', {});
  let parsed = null;
  try { parsed = JSON.parse(stj.text); } catch { /* ignore */ }
  check('bgi_status JSON 可解析', !!parsed && typeof parsed.root === 'string', parsed ? `root=${parsed.root} bgiRunning=${parsed.bgiRunning}` : '');

  const groups = await call('bgi_list_groups');
  check('bgi_list_groups 返回', !groups.isError && /配置组/.test(groups.text), groups.text.split('\n')[0]);

  const paths = await call('bgi_list_pathing');
  check('bgi_list_pathing 返回', !paths.isError && /路径/.test(paths.text), paths.text.split('\n')[0]);

  const routes = await call('bgi_find_routes', { material: '星螺' });
  show('bgi_find_routes(星螺)', routes.text, 900);
  check('bgi_find_routes 命中星螺', !routes.isError && /主命中/.test(routes.text));

  if (LIVE) {
    const collect = await call('bgi_collect_material', { material: '星螺', run: false });
    show('bgi_collect_material(星螺, run=false)', collect.text, 1600);
    check('bgi_collect_material 成功', !collect.isError && /配置组/.test(collect.text));

    const find2 = await call('bgi_list_pathing', { filter: '星螺' });
    show('bgi_list_pathing(filter=星螺)', find2.text, 1200);
    check('下载后本机能索引到星螺', !find2.isError && /星螺/.test(find2.text));
  } else {
    console.log('\n（未加 --live：跳过会写本机文件/触发任务的调用）');
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  cp.kill();
  process.exit(fail ? 1 : 0);
};

main().catch((e) => { console.error('测试异常:', e); cp.kill(); process.exit(2); });
