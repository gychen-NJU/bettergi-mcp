<#
.SYNOPSIS
    skill 文档与脚本参数一致性走查：把 SKILL.md 里示范过的调用逐条跑一遍，确认"照文档做能跑通"。
.DESCRIPTION
    为什么需要它：文档里写的命令一旦和脚本真实参数漂移（改名、删参数、拼错开关），
    新 agent 照抄就会撞 "A parameter cannot be found"。本测试断言两件事：
      ① **不出现参数绑定错误**（NamedParameterNotFound / "A parameter cannot be found"）；
      ② 退出码落在该脚本**文档声明的合法集合**内（很多脚本的退出码取决于本机环境，所以给集合而非单值）。
    只跑只读 / -DryRun 调用，绝不触发任务、不写文件。
.PARAMETER Json
    输出机器可读 JSON。
.EXAMPLE
    powershell -NoProfile -File test-skill-playbook.ps1
.NOTES
    退出码：0=全部一致；1=有漂移/绑定错误。UTF-8 带 BOM（PS 5.1）。
#>
[CmdletBinding()]
param(
    [string]$SkillDir = "$env:USERPROFILE\.agents\skills\bettergi-control\scripts",
    [switch]$Json
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# 每条 = SKILL.md 里示范/表格里出现过的调用（只读或 -DryRun）
$cases = @(
    @{ label = '§0-1 bgi-status.ps1';                          script = 'bgi-status.ps1';          args = @();                                     exits = @(0, 1, 2) },
    @{ label = '§0-2 bgi-doctor.ps1 -Material 星螺';             script = 'bgi-doctor.ps1';          args = @('-Material', '星螺');                    exits = @(0, 1, 2) },
    @{ label = '§3 bgi-collect.ps1 -List';                     script = 'bgi-collect.ps1';         args = @('-List');                               exits = @(0, 1, 2) },
    @{ label = '§3 bgi-collect.ps1 -Material 星螺 -List';       script = 'bgi-collect.ps1';         args = @('-Material', '星螺', '-List');           exits = @(0, 1, 2) },
    @{ label = '§3 bgi-collect.ps1 -Material 星螺 -DryRun';     script = 'bgi-collect.ps1';         args = @('-Material', '星螺', '-DryRun');         exits = @(0, 1, 2) },
    @{ label = '§2 bgi-run.ps1 -Mode groups -Name 采集-星螺 -DryRun'; script = 'bgi-run.ps1';       args = @('-Mode', 'groups', '-Name', '采集-星螺', '-DryRun'); exits = @(0, 2) },
    @{ label = '§2 bgi-run.ps1 -Mode oneDragon -DryRun';        script = 'bgi-run.ps1';             args = @('-Mode', 'oneDragon', '-DryRun');        exits = @(0, 2) },
    @{ label = '§3 bgi-watch.ps1 -Mode groups -DryRun';         script = 'bgi-watch.ps1';           args = @('-Mode', 'groups', '-DryRun');           exits = @(0, 1, 2) },
    @{ label = '§3 bgi-wait.ps1 -Milestone finished -TimeoutSeconds 2'; script = 'bgi-wait.ps1';    args = @('-Milestone', 'finished', '-TimeoutSeconds', '2'); exits = @(0, 1) },
    @{ label = '§3 bgi-results.ps1 -Group 采集-星螺';            script = 'bgi-results.ps1';        args = @('-Group', '采集-星螺');                   exits = @(0, 1) },
    @{ label = '§3 bgi-schedule.ps1';                          script = 'bgi-schedule.ps1';        args = @();                                      exits = @(0, 1) },
    @{ label = '§3 bgi-log.ps1 -Level ERR -Tail 3';             script = 'bgi-log.ps1';             args = @('-Level', 'ERR', '-Tail', '3');          exits = @(0, 1) },
    @{ label = '§3 bgi-strategy.ps1 -List';                    script = 'bgi-strategy.ps1';        args = @('-List');                               exits = @(0, 1, 2) },
    @{ label = '§3 bgi-group.ps1 -List';                       script = 'bgi-group.ps1';           args = @('-List');                               exits = @(0, 1, 2) },
    @{ label = '§3 bgi-focus-game.ps1 -NoFocus';               script = 'bgi-focus-game.ps1';      args = @('-NoFocus');                            exits = @(0, 1, 2) },
    @{ label = '§3 bgi-fetch-route.ps1 -Material 星螺（不下载）'; script = 'bgi-fetch-route.ps1';    args = @('-Material', '星螺');                    exits = @(0, 1, 2) }
)

$results = @()
$bad = 0
foreach ($c in $cases) {
    $path = Join-Path $SkillDir $c.script
    if (-not (Test-Path -LiteralPath $path)) {
        $results += [ordered]@{ label = $c.label; ok = $false; reason = '脚本不存在' }
        $bad++
        continue
    }
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $path @($c.args) 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
    $text = ($out -join "`n")
    $binding = ($text -match 'A parameter cannot be found' -or $text -match 'NamedParameterNotFound' -or $text -match 'MissingMandatoryParameter')
    $exitOk = $c.exits -contains $code
    $ok = (-not $binding) -and $exitOk
    if (-not $ok) { $bad++ }
    $results += [ordered]@{
        label = $c.label; ok = $ok; exit = $code; expectedExits = $c.exits
        bindingError = $binding
        reason = if ($binding) { '参数绑定错误（文档与脚本漂移）' } elseif (-not $exitOk) { "退出码 $code 不在 $($c.exits -join '/')" } else { '' }
    }
}

if ($Json) {
    ([ordered]@{ total = $cases.Count; failed = $bad; results = $results } | ConvertTo-Json -Depth 6)
} else {
    "=== skill 文档 ↔ 脚本 一致性走查（$($cases.Count) 条）==="
    foreach ($r in $results) {
        $mark = if ($r.ok) { '✓' } else { '✗' }
        "  $mark exit=$($r.exit)  $($r.label)$(if ($r.reason) { '   → ' + $r.reason })"
    }
    ""
    if ($bad -eq 0) { "结论：文档里示范的调用全部可跑通 ✓" } else { "结论：有 $bad 条不一致 ✗" }
}

if ($bad -eq 0) { exit 0 } else { exit 1 }
