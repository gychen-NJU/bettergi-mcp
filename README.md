# bettergi-mcp

**简体中文** | [English](README.en.md)

BetterGI（更好的原神）的 **MCP stdio 服务器**：把「启动游戏、跑一条龙、采集材料、打秘境、改配置/队伍、查战果与失败原因」这些操作包成 29 个 `bgi_*` 工具，让 DSH / Claude Code / 任何支持 MCP 的 agent 用一句话直接指挥本机 BetterGI。

零第三方依赖（Node ≥ 18），单文件服务器；所有真实操作都转发给已经验证过的 `bettergi-control` 技能脚本，MCP 层只负责参数校验、结构化返回，以及官方脚本仓库的检索/下载。

## 能力一览

| 分组 | 工具 |
| --- | --- |
| 体检 / 状态 | `bgi_doctor`（开跑前体检）· `bgi_status` · `bgi_schedule_info` · `bgi_results`（战果统计）· `bgi_watch`（观察并判定成败） |
| 启动 / 关闭 | `bgi_start_game` · `bgi_focus_game`（还原窗口并置前）· `bgi_close` |
| 一条龙 | `bgi_run_one_dragon` · `bgi_create_onedragon` · `bgi_set_onedragon` · `bgi_add_group_to_onedragon` · `bgi_run_task_progress`（断点续跑） |
| 配置组 | `bgi_run_groups` · `bgi_create_group` · `bgi_list_groups` · `bgi_list_pathing` |
| 采集 / 路线 | `bgi_collect_material` · `bgi_collect_now`（一句话闭环）· `bgi_find_routes` · `bgi_repo_index` |
| JS 脚本 | `bgi_list_js_scripts` · `bgi_install_js` · `bgi_run_js` · `bgi_js_settings` |
| 配置 | `bgi_set_config` · `bgi_list_strategies` |
| 排错 | `bgi_log_search`（按级别/正则/时间窗/任务检索日志）· `bgi_wait_milestone` |

`bgi_collect_now { material: "星螺", confirm: true }` 是最省事的一个：找路线 → 缺则下载 → 建配置组 → 检查窗口 → 触发 → 轮询到"真的开始跑了"。

## 环境要求

- Windows + Node.js ≥ 18
- 本机已安装 **BetterGI**（默认 `D:\software\BetterGI`，可用 `BETTERGI_ROOT` 覆盖）
- `bettergi-control` 技能（`~/.agents/skills/bettergi-control/`，提供被复用的 15 个 PowerShell 脚本；可用 `BETTERGI_SKILL_DIR` 覆盖）
- 游戏需可见且前台、16:9 ≥ 1920×1080；**没有后台挂机**

## 安装

```powershell
git clone https://github.com/gychen-NJU/bettergi-mcp.git
```

不需要 `npm install`（零依赖）。

### 在 DSH 里注册

编辑对应 profile 的 `cordis.patch.yml`（例如 `~/.dsh/profiles/desktop/cordis.patch.yml`），在末尾的 insert 段加一行：

```yaml
- insert:
    - id: bettergi-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: bettergi
        transport: stdio
        command: node
        args:
          - '<clone 下来的目录>/bettergi-mcp.mjs'
        cwd: '<clone 下来的目录>'
        failOnStartupError: false
```

重启 DSH 后即可在会话里看到 `mcp__bettergi__*` 工具。

### 在 Claude Code / 其它 MCP 客户端里注册

```jsonc
// .mcp.json 或等价配置
{
  "mcpServers": {
    "bettergi": {
      "command": "node",
      "args": ["<clone 下来的目录>/bettergi-mcp.mjs"],
      "env": { "BETTERGI_ROOT": "D:\\software\\BetterGI" }
    }
  }
}
```

### 交给 Agent 安装（一句话）

> 帮我把 https://github.com/gychen-NJU/bettergi-mcp 装进当前 DSH：clone 到本地，在 profile 的 cordis.patch.yml 里加一条 serverName=bettergi 的 MCP stdio 声明指向 bettergi-mcp.mjs，重启后确认 mcp__bettergi__bgi_doctor 能调通。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `BETTERGI_ROOT` | `D:\software\BetterGI` | BetterGI 安装根（`User\`、`log\` 都在下面） |
| `BETTERGI_SKILL_DIR` | `%USERPROFILE%\.agents\skills\bettergi-control\scripts` | 被复用的技能脚本目录 |
| `BETTERGI_REPO_RAW` | GitHub raw | 官方脚本仓库 raw 前缀（CNB 在部分网络下解析失败） |

## 安全与边界

- **不读写游戏内存、不改游戏文件**；只驱动 BetterGI 与它的配置/日志。
- 硬要求：BetterGI 运行中时命令行参数会被单实例吃掉；改配置必须先退出 BetterGI。
- 执行类工具内置 **运行闸门**（`run-gate.mjs`）：BetterGI 占用、窗口 <1080p、非 16:9、最小化等"注定白跑"的情况直接拦下；确需强行放行用 `force:true`。
- 长任务一律「发起 → 轮询」：单次工具调用被夹在 50 秒内，跑完用 `bgi_watch` / `bgi_wait_milestone` 确认。
- 账号风险由使用方式决定：官方条款把第三方软件 / 模拟操作列为封号理由之一，低调使用。

## 自测

```powershell
node --check bettergi-mcp.mjs
node test-gate.mjs          # 运行闸门纯函数单测（不需要 BetterGI 在跑）
node selftest.mjs --quiet   # MCP 自检（只读）
powershell -NoProfile -File gate-check.ps1   # 全量验收（需要本机 BetterGI）
```

`cache/` 是官方仓库索引缓存（自动生成，已在 `.gitignore` 里）。

## 相关项目

- [dsh-game-daily](https://github.com/gychen-NJU/dsh-game-daily)：DSH 设置页里的「游戏日常」插件。原神的每日代理需要这个 MCP；插件会在缺失时自动把 `bettergi-mcp.mjs` 下载到 `$DSH_HOME/game-daily/vendor/bettergi-mcp/`，并提示你补 profile 注册行。

## 许可

[MIT](LICENSE) © 2026 gychen-NJU
