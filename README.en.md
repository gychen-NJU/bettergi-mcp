# bettergi-mcp

[简体中文](README.md) | **English**

An **MCP stdio server for BetterGI** (the open-source Genshin Impact automation tool). It wraps "start the game, run the daily chain, farm materials, do domains, edit configs/teams, inspect results and failures" into 29 `bgi_*` tools, so DSH / Claude Code / any MCP-capable agent can drive BetterGI on this machine in one sentence.

Zero third-party dependencies (Node ≥ 18), single-file server. Every real action is delegated to the already-verified `bettergi-control` skill scripts; the MCP layer only does argument validation, structured returns, and searching/downloading the official script repository.

## Tools at a glance

| Group | Tools |
| --- | --- |
| Health / status | `bgi_doctor` (pre-flight check) · `bgi_status` · `bgi_schedule_info` · `bgi_results` · `bgi_watch` |
| Launch / close | `bgi_start_game` · `bgi_focus_game` · `bgi_close` |
| Daily chain (OneDragon) | `bgi_run_one_dragon` · `bgi_create_onedragon` · `bgi_set_onedragon` · `bgi_add_group_to_onedragon` · `bgi_run_task_progress` |
| Script groups | `bgi_run_groups` · `bgi_create_group` · `bgi_list_groups` · `bgi_list_pathing` |
| Farming / routes | `bgi_collect_material` · `bgi_collect_now` (one-shot) · `bgi_find_routes` · `bgi_repo_index` |
| JS scripts | `bgi_list_js_scripts` · `bgi_install_js` · `bgi_run_js` · `bgi_js_settings` |
| Config | `bgi_set_config` · `bgi_list_strategies` |
| Troubleshooting | `bgi_log_search` · `bgi_wait_milestone` |

`bgi_collect_now { material: "Starconch", confirm: true }` is the easiest entry: find a route → download if missing → build a script group → check the window → trigger → poll until it has really started.

## Requirements

- Windows + Node.js ≥ 18
- BetterGI installed (default `D:\software\BetterGI`, override with `BETTERGI_ROOT`)
- The `bettergi-control` skill (`~/.agents/skills/bettergi-control/`, providing the 15 PowerShell scripts; override with `BETTERGI_SKILL_DIR`)
- The game window must be visible and foreground at 16:9 ≥ 1920×1080; **there is no background mode**

## Install

```powershell
git clone https://github.com/gychen-NJU/bettergi-mcp.git
```

No `npm install` needed (zero dependencies).

### Register in DSH

Edit the profile's `cordis.patch.yml` (e.g. `~/.dsh/profiles/desktop/cordis.patch.yml`) and append:

```yaml
- insert:
    - id: bettergi-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: bettergi
        transport: stdio
        command: node
        args:
          - '<cloned dir>/bettergi-mcp.mjs'
        cwd: '<cloned dir>'
        failOnStartupError: false
```

Restart DSH and the `mcp__bettergi__*` tools appear in sessions.

### Register in Claude Code / other MCP clients

```jsonc
{
  "mcpServers": {
    "bettergi": {
      "command": "node",
      "args": ["<cloned dir>/bettergi-mcp.mjs"],
      "env": { "BETTERGI_ROOT": "D:\\software\\BetterGI" }
    }
  }
}
```

### Hand it to an agent (one sentence)

> Install https://github.com/gychen-NJU/bettergi-mcp into my DSH: clone it locally, add an MCP stdio entry with serverName=bettergi pointing at bettergi-mcp.mjs in the profile's cordis.patch.yml, restart, then confirm mcp__bettergi__bgi_doctor works.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `BETTERGI_ROOT` | `D:\software\BetterGI` | BetterGI install root (`User\`, `log\` live here) |
| `BETTERGI_SKILL_DIR` | `%USERPROFILE%\.agents\skills\bettergi-control\scripts` | Scripts provided by the skill |
| `BETTERGI_REPO_RAW` | GitHub raw | Raw prefix of the official script repository (CNB may fail on some networks) |

## Safety and limits

- **Never reads/writes game memory or game files**; only drives BetterGI, its configs and logs.
- Hard requirements: a running BetterGI instance swallows command-line arguments; config edits require quitting BetterGI first.
- Action tools run a **run gate** (`run-gate.mjs`): BetterGI already running, window < 1080p, non-16:9, or minimized are blocked as "doomed runs"; pass `force:true` to override intentionally.
- Long tasks are always "start → poll": each tool call is capped at 50 seconds; use `bgi_watch` / `bgi_wait_milestone` to confirm completion.
- Account risk depends on usage: the official terms list third-party software / simulated input as grounds for a ban. Use it discreetly.

## Tests

```powershell
node --check bettergi-mcp.mjs
node test-gate.mjs          # pure-function run-gate tests (no BetterGI needed)
node selftest.mjs --quiet   # MCP self-check (read-only)
powershell -NoProfile -File gate-check.ps1   # full acceptance (needs local BetterGI)
```

`cache/` holds the official repository index (auto-generated, git-ignored).

## Related

- [dsh-game-daily](https://github.com/gychen-NJU/dsh-game-daily): the "Game Daily" Settings panel for DSH. Its Genshin daily agent needs this MCP; the plugin auto-downloads `bettergi-mcp.mjs` into `$DSH_HOME/game-daily/vendor/bettergi-mcp/` when missing and reminds you to add the profile entry.

## License

[MIT](LICENSE) © 2026 gychen-NJU
