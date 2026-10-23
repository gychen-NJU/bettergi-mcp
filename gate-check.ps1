# gate-check.ps1 —— 一次跑完 bettergi-mcp 的全部验收（单测 + 自检 + 冒烟 + skill 脚本 + 不变量）
# 用法：powershell -NoProfile -File gate-check.ps1 [-BetterGiRoot <BetterGI 安装根>]
param(
    [string]$BetterGiRoot = $(if ($env:BETTERGI_ROOT) { $env:BETTERGI_ROOT } else { 'D:\software\BetterGI' })
)
$ErrorActionPreference = 'Continue'
$d = $PSScriptRoot
$S = if ($env:BETTERGI_SKILL_DIR) { $env:BETTERGI_SKILL_DIR } else { "$env:USERPROFILE\.agents\skills\bettergi-control\scripts" }
$mjs = Join-Path $d 'bettergi-mcp.mjs'
$fails = 0

Write-Output '########## bettergi-mcp 验收 ##########'

# 1) MCP 语法
node --check $mjs 2>$null
if ($LASTEXITCODE -eq 0) { Write-Output '  MCP 语法        : ✓' } else { Write-Output '  MCP 语法        : ✗'; $fails++ }
$leftover = (Select-String -Path $mjs -SimpleMatch -Pattern '), pre)' -ErrorAction SilentlyContinue | Measure-Object).Count
Write-Output "  残留 pre 引用   : $leftover （应 0）"
if ($leftover -ne 0) { $fails++ }

# 2) run-gate 纯函数单测
Write-Output ''
Write-Output '--- run-gate 纯函数单测 ---'
$g = node (Join-Path $d 'test-gate.mjs') 2>&1
$g | Select-Object -Last 2 | ForEach-Object { Write-Output "  $_" }
if ($LASTEXITCODE -ne 0) { Write-Output '  test-gate       : ✗'; $fails++ } else { Write-Output '  test-gate       : ✓' }

# 3) MCP 自检（只读 + live）
Write-Output ''
Write-Output '--- MCP 自检 ---'
$a = node (Join-Path $d 'selftest.mjs') --quiet 2>&1
$code = $LASTEXITCODE
$a | Select-String -Pattern '结果：|覆盖率' | ForEach-Object { Write-Output "  $($_.Line)" }
if ($code -ne 0) { Write-Output '  selftest        : ✗'; $fails++ } else { Write-Output '  selftest        : ✓' }

$b = node (Join-Path $d 'selftest.mjs') --quiet --live 2>&1
$code2 = $LASTEXITCODE
$b | Select-String -Pattern '结果：' | ForEach-Object { Write-Output "  $($_.Line)" }
if ($code2 -ne 0) { Write-Output '  selftest --live : ✗'; $fails++ } else { Write-Output '  selftest --live : ✓' }

# 3b) bgi_set_config 真实写入往返（惰性字段，跑完自动还原）
Write-Output ''
Write-Output '--- bgi_set_config 往返 ---'
# 注意：PowerShell 变量名**大小写不敏感**，这里不能用 $s（会覆盖上面的 $S = skill 脚本目录）
$cfgOut = node (Join-Path $d 'test-setconfig.mjs') 2>&1
$code3 = $LASTEXITCODE
$cfgOut | Select-String -Pattern '结果：' | ForEach-Object { Write-Output "  $($_.Line)" }
if ($code3 -ne 0) {
    Write-Output '  test-setconfig  : ✗'
    $cfgOut | Select-Object -Last 8 | ForEach-Object { Write-Output "    $_" }
    $fails++
} else { Write-Output '  test-setconfig  : ✓' }
# 3c) 一条龙「建配置 / 接配置组 / 改顺序」集成测试（临时配置，跑完自动删除）
Write-Output ''
Write-Output '--- 一条龙接线集成 ---'
$odOut = node (Join-Path $d 'test-onedragon.mjs') 2>&1
$code4 = $LASTEXITCODE
$odOut | Select-String -Pattern '结果：' | ForEach-Object { Write-Output "  $($_.Line)" }
if ($code4 -ne 0) {
    Write-Output '  test-onedragon  : ✗'
    $odOut | Select-Object -Last 10 | ForEach-Object { Write-Output "    $_" }
    $fails++
} else { Write-Output '  test-onedragon  : ✓' }
# 3d) skill 文档 ↔ 脚本 一致性走查（照文档逐条跑，防参数漂移）
Write-Output ''
Write-Output '--- skill 文档一致性走查 ---'
$pbOut = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $d 'test-skill-playbook.ps1') 2>&1 | ForEach-Object { "$_" }
$code5 = $LASTEXITCODE
$pbOut | Select-String -Pattern '^结论' | ForEach-Object { Write-Output "  $($_.Line)" }
if ($code5 -ne 0) {
    Write-Output '  playbook 走查   : ✗'
    $pbOut | Select-String -Pattern '✗' | Select-Object -First 6 | ForEach-Object { Write-Output "    $($_.Line.Trim())" }
    $fails++
} else { Write-Output '  playbook 走查   : ✓' }

# 4) 冒烟
Write-Output ''
Write-Output '--- 冒烟 ---'
node (Join-Path $d 'test-client.mjs') *> $null
if ($LASTEXITCODE -eq 0) { Write-Output '  只读 5 项       : ✓' } else { Write-Output '  只读 5 项       : ✗'; $fails++ }
node (Join-Path $d 'test-client.mjs') --live *> $null
if ($LASTEXITCODE -eq 0) { Write-Output '  live 7 项       : ✓' } else { Write-Output '  live 7 项       : ✗'; $fails++ }

# 5) skill 脚本 BOM + 语法
Write-Output ''
Write-Output '--- skill 脚本 ---'
$bad = 0
$files = Get-ChildItem $S -Filter *.ps1
foreach ($f in $files) {
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)[0..2]
    $tokens = $null; $errs = $null
    [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$tokens, [ref]$errs) | Out-Null
    $isBom = ($bytes[0] -eq 239 -and $bytes[1] -eq 187)
    if (-not $isBom -or @($errs).Count -gt 0) { $bad++; Write-Output "  ✗ $($f.Name)  BOM=$isBom 语法错误=$(@($errs).Count)" }
}
Write-Output "  $($files.Count) 个脚本，问题 $bad"
if ($bad -ne 0) { $fails++ }

# 5b) BetterGI 根目录下的运维脚本（包装器 / 按需执行器 / 一次性安装器）同样要 BOM + 语法干净
Write-Output ''
Write-Output '--- BetterGI 根目录运维脚本 ---'
$bad2 = 0
$rootScripts = @(Get-ChildItem $BetterGiRoot -Filter '_*.ps1' -File -ErrorAction SilentlyContinue)
foreach ($f in $rootScripts) {
    $bytes2 = [System.IO.File]::ReadAllBytes($f.FullName)[0..2]
    $tk = $null; $er = $null
    [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$tk, [ref]$er) | Out-Null
    $isBom2 = ($bytes2[0] -eq 239 -and $bytes2[1] -eq 187)
    if (-not $isBom2 -or @($er).Count -gt 0) { $bad2++; Write-Output "  ✗ $($f.Name)  BOM=$isBom2 语法错误=$(@($er).Count)" }
}
Write-Output "  $($rootScripts.Count) 个脚本，问题 $bad2"
if ($bad2 -ne 0) { $fails++ }

# 6) 不变量（没有 BetterGI 安装时整段跳过，不判失败）
Write-Output ''
Write-Output '--- 关键状态（不变量） ---'
$oneDragonConfig = Join-Path $BetterGiRoot 'User\OneDragon\日常.json'
if (-not (Test-Path -LiteralPath $BetterGiRoot)) {
    Write-Output "  BetterGI 根不存在（$BetterGiRoot），跳过不变量"
} elseif (-not (Test-Path -LiteralPath $oneDragonConfig)) {
    Write-Output "  未找到一条龙配置（$oneDragonConfig），跳过不变量"
} else {
    $od = Get-Content $oneDragonConfig -Raw -Encoding UTF8 | ConvertFrom-Json
    Write-Output "  一条龙任务数    : $($od.TaskOrder.Count)"
    $groups = (Get-ChildItem (Join-Path $BetterGiRoot 'User\ScriptGroup') -File -ErrorAction SilentlyContinue | ForEach-Object { $_.BaseName }) -join ', '
    Write-Output "  配置组          : $groups"
    $png = Get-ChildItem (Join-Path $BetterGiRoot 'User\JsScript') -Recurse -Include *.png -ErrorAction SilentlyContinue |
        Where-Object { ([System.IO.File]::ReadAllBytes($_.FullName)[0..3] -join ',') -eq '137,80,78,71' }
    Write-Output "  JS 图片合法数   : $($png.Count)"
}

Write-Output ''
if ($fails -eq 0) { Write-Output '结论：全部通过 ✓'; exit 0 } else { Write-Output "结论：有 $fails 项失败 ✗"; exit 1 }
