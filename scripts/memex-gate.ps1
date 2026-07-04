#Requires -Version 7.0
<#
.SYNOPSIS
  Thin validation cockpit for coding agents working in Memex Core.

.DESCRIPTION
  Captures all command output under .agent-handoff/ for traceable agent handoffs.
  Does not modify src/, tests/, or package.json.

.EXAMPLE
  pwsh ./scripts/memex-gate.ps1 doctor
  pwsh ./scripts/memex-gate.ps1 gate0
  pwsh ./scripts/memex-gate.ps1 agentpack
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('doctor', 'gate0', 'gate1', 'gateperf', 'agentpack', 'clean')]
  [string]$Command = 'doctor'
)

$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$HandoffDir = Join-Path $Root '.agent-handoff'
$ManifestPath = Join-Path $HandoffDir 'manifest.json'
$SessionStamp = Get-Date -Format 'yyyyMMdd-HHmmss'

Set-Location $Root

function Ensure-HandoffDir {
  if (-not (Test-Path -LiteralPath $HandoffDir)) {
    New-Item -ItemType Directory -Path $HandoffDir -Force | Out-Null
  }
}

function Get-SessionLogPath([string]$Name) {
  Join-Path $HandoffDir "$Name-$SessionStamp.log"
}

function Get-LatestLogPath([string]$Name) {
  Join-Path $HandoffDir "latest-$Name.log"
}

function Write-LatestLog {
  param(
    [string]$Name,
    [string]$SessionLogPath
  )
  if (-not (Test-Path -LiteralPath $SessionLogPath)) { return }
  Copy-Item -LiteralPath $SessionLogPath -Destination (Get-LatestLogPath $Name) -Force
}

function Write-LogLine {
  param(
    [string]$Message,
    [string]$LogPath
  )
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  Write-Host $line
  Add-Content -LiteralPath $LogPath -Value $line -Encoding utf8
}

function Invoke-LoggedStep {
  param(
    [string]$StepName,
    [string]$LogPath,
    [scriptblock]$Action
  )

  Write-LogLine "BEGIN $StepName" $LogPath
  $output = & $Action 2>&1
  $exitCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }

  foreach ($line in @($output)) {
    $text = if ($null -eq $line) { '' } else { $line.ToString() }
    Add-Content -LiteralPath $LogPath -Value $text -Encoding utf8
    Write-Host $text
  }

  Write-LogLine "END $StepName (exit=$exitCode)" $LogPath
  return [ordered]@{
    name     = $StepName
    exitCode = $exitCode
    ok       = ($exitCode -eq 0)
  }
}

function Read-Manifest {
  if (-not (Test-Path -LiteralPath $ManifestPath)) {
    return [ordered]@{
      version = 1
      runs    = @()
    }
  }
  return Get-Content -LiteralPath $ManifestPath -Raw -Encoding utf8 | ConvertFrom-Json
}

function Write-ManifestEntry {
  param(
    [string]$Name,
    [string]$LogPath,
    [bool]$Ok,
    [array]$Steps = @()
  )

  $manifest = Read-Manifest
  $git = Get-GitMeta
  $entry = [ordered]@{
    command   = $Name
    timestamp = (Get-Date).ToUniversalTime().ToString('o')
    log       = (Resolve-Path -LiteralPath $LogPath).Path
    ok        = $Ok
    steps     = $Steps
    branch    = $git.branch
    commit    = $git.commit
  }

  $runs = @($manifest.runs) + @([pscustomobject]$entry)
  if ($runs.Count -gt 30) {
    $runs = $runs[-30..-1]
  }

  $payload = [ordered]@{
    version = 1
    runs    = $runs
  }

  $payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ManifestPath -Encoding utf8
}

function Test-CliOnPath([string]$Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-CliVersion([string]$Name) {
  if (-not (Test-CliOnPath $Name)) { return $null }
  try {
    $job = Start-Job -ScriptBlock {
      param($Exe)
      (& $Exe --version 2>&1 | Select-Object -First 1 | Out-String).Trim()
    } -ArgumentList $Name
    if (-not (Wait-Job -Job $job -Timeout 8)) {
      Stop-Job -Job $job -Force -ErrorAction SilentlyContinue
      Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
      return 'present (version timeout)'
    }
    $value = Receive-Job -Job $job
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($value)) { return 'present' }
    return $value
  } catch {
    return 'present'
  }
}

function Format-LastRunCell($run, [string]$Field = 'timestamp') {
  if (-not $run -or @($run).Count -eq 0) { return '—' }
  $item = @($run)[0]
  if ($Field -eq 'timestamp') {
    if (-not $item.timestamp) { return '—' }
    return $item.timestamp
  }
  if ($Field -eq 'ok') {
    if ($null -eq $item.ok) { return '—' }
    return [string]$item.ok
  }
  if ($Field -eq 'log') {
    if (-not $item.log) { return '—' }
    $rel = $item.log
    if ($rel.StartsWith($Root)) {
      $rel = $rel.Substring($Root.Length).TrimStart('\', '/')
    }
    return $rel
  }
  return '—'
}

function Get-GitMeta {
  $branch = 'unknown'
  $commit = 'unknown'
  try {
    $branch = (git -C $Root rev-parse --abbrev-ref HEAD 2>$null)
    if (-not $branch) { $branch = 'unknown' }
    $commit = (git -C $Root rev-parse --short HEAD 2>$null)
    if (-not $commit) { $commit = 'unknown' }
  } catch {
    # git optional — do not block gates on VCS
  }
  return @{ branch = $branch; commit = $commit }
}

function Invoke-Doctor {
  Ensure-HandoffDir
  $logPath = Get-SessionLogPath 'doctor'
  New-Item -ItemType File -Path $logPath -Force | Out-Null

  $checks = [ordered]@{}
  $failures = @()

  $nodeVersion = Get-CliVersion 'node'
  $npmVersion = Get-CliVersion 'npm'
  $pwshVersion = $PSVersionTable.PSVersion.ToString()

  $checks.node = $nodeVersion
  $checks.npm = $npmVersion
  $checks.pwsh = $pwshVersion
  $checks.root = $Root

  if (-not (Test-CliOnPath 'node')) { $failures += 'node missing from PATH' }
  if (-not (Test-CliOnPath 'npm')) { $failures += 'npm missing from PATH' }

  $requiredPaths = @(
    'package.json',
    'src',
    'tests',
    'scripts/memex-gate.ps1',
    'AGENTS.md',
    'docs/AGENT_GATES.md'
  )

  $checks.files = @{}
  foreach ($rel in $requiredPaths) {
    $full = Join-Path $Root $rel
    $exists = Test-Path -LiteralPath $full
    $checks.files[$rel] = $exists
    if (-not $exists) { $failures += "missing: $rel" }
  }

  $nodeModules = Test-Path -LiteralPath (Join-Path $Root 'node_modules')
  $checks.node_modules = $nodeModules
  if (-not $nodeModules) { $failures += 'node_modules missing — run npm install' }

  $pkg = Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw -Encoding utf8 | ConvertFrom-Json
  $checks.package_version = $pkg.version
  $checks.scripts = [ordered]@{
    check = [bool]($pkg.scripts.check)
    test  = [bool]($pkg.scripts.test)
    bench = [bool]($pkg.scripts.bench)
  }

  foreach ($script in @('check', 'test', 'bench')) {
    if (-not $pkg.scripts.$script) { $failures += "package.json missing script: $script" }
  }

  $report = [ordered]@{
    command  = 'doctor'
    ok       = ($failures.Count -eq 0)
    checks   = $checks
    failures = $failures
  }
  if (-not $nodeModules) {
    $report.suggested_action = 'Run npm install'
  }

  $json = $report | ConvertTo-Json -Depth 6
  Set-Content -LiteralPath $logPath -Value $json -Encoding utf8
  Write-LatestLog -Name 'doctor' -SessionLogPath $logPath
  Write-Host $json

  Write-ManifestEntry -Name 'doctor' -LogPath $logPath -Ok $report.ok
  if (-not $report.ok) { exit 1 }
}

function Invoke-NpmGate {
  param(
    [string]$GateName,
    [string[]]$NpmSteps
  )

  Ensure-HandoffDir
  $logPath = Get-SessionLogPath $GateName
  New-Item -ItemType File -Path $logPath -Force | Out-Null

  Write-LogLine "memex-gate $GateName starting in $Root" $logPath

  $steps = @()
  $allOk = $true

  foreach ($npmScript in $NpmSteps) {
    $step = Invoke-LoggedStep -StepName "npm run $npmScript" -LogPath $logPath -Action {
      npm run $npmScript
    }
    $steps += $step
    if (-not $step.ok) { $allOk = $false }
  }

  Write-LogLine "memex-gate $GateName finished ok=$allOk" $logPath
  Write-LatestLog -Name $GateName -SessionLogPath $logPath
  Write-ManifestEntry -Name $GateName -LogPath $logPath -Ok $allOk -Steps $steps

  if (-not $allOk) { exit 1 }
}

function Invoke-AgentPack {
  Ensure-HandoffDir

  $logPath = Get-SessionLogPath 'agentpack'
  New-Item -ItemType File -Path $logPath -Force | Out-Null
  Write-LogLine 'building agent handoff pack' $logPath

  $pkg = Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw -Encoding utf8 | ConvertFrom-Json
  $git = Get-GitMeta
  $branch = $git.branch
  $shortCommit = $git.commit
  $commit = $shortCommit
  try {
    $full = (git -C $Root rev-parse HEAD 2>$null)
    if ($full) { $commit = $full }
  } catch { }

  $manifest = Read-Manifest
  $lastDoctor = @($manifest.runs | Where-Object { $_.command -eq 'doctor' } | Select-Object -Last 1)
  $lastGate0 = @($manifest.runs | Where-Object { $_.command -eq 'gate0' } | Select-Object -Last 1)
  $lastGate1 = @($manifest.runs | Where-Object { $_.command -eq 'gate1' } | Select-Object -Last 1)
  $lastGatePerf = @($manifest.runs | Where-Object { $_.command -eq 'gateperf' } | Select-Object -Last 1)

  $statusPath = Join-Path $HandoffDir 'memex_status.md'
  $promptPath = Join-Path $HandoffDir 'agent_prompt.md'

  $status = @"
# Memex Core — Agent Status

Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') (local)
Package: memex-core v$($pkg.version)
Branch: $branch
Commit: $shortCommit

## Validation cockpit

| Gate | Last run (UTC) | OK | Log |
|------|----------------|----|-----|
| doctor | $(Format-LastRunCell $lastDoctor 'timestamp') | $(Format-LastRunCell $lastDoctor 'ok') | $(Format-LastRunCell $lastDoctor 'log') |
| gate0 | $(Format-LastRunCell $lastGate0 'timestamp') | $(Format-LastRunCell $lastGate0 'ok') | $(Format-LastRunCell $lastGate0 'log') |
| gate1 | $(Format-LastRunCell $lastGate1 'timestamp') | $(Format-LastRunCell $lastGate1 'ok') | $(Format-LastRunCell $lastGate1 'log') |
| gateperf | $(Format-LastRunCell $lastGatePerf 'timestamp') | $(Format-LastRunCell $lastGatePerf 'ok') | $(Format-LastRunCell $lastGatePerf 'log') |

## Recommended agent loop

1. ``pwsh ./scripts/memex-gate.ps1 doctor``
2. ``pwsh ./scripts/memex-gate.ps1 gate0`` — baseline before intervention
3. Implement in ``src/`` or ``tests/`` only when scoped
4. ``pwsh ./scripts/memex-gate.ps1 gate1`` — validation after intervention
5. ``pwsh ./scripts/memex-gate.ps1 agentpack`` before handoff

## Constraints (do not violate)

- Do not add ProofLoop Python
- Do not modify ``package.json`` unless absolutely required
- Prefer ``npm run check`` + ``npm test`` before claiming done
- All gate logs live under ``.agent-handoff/``

## Repo map

- ``src/`` — TypeScript source (MCP server, vault, fabric, intake)
- ``tests/`` — Node test runner suites
- ``scripts/`` — PowerShell operator tooling including ``memex-gate.ps1``
- ``docs/`` — Architecture and agent gate documentation
"@

  $prompt = @"
# Memex Core — Agent Prompt

You are a coding agent working in **memex-core** (local MCP memory fabric, v$($pkg.version)).

## Working directory

``$Root``

## Current snapshot

- Branch: ``$branch``
- Commit: ``$commit``

## Before you change code

1. Read ``AGENTS.md`` and ``docs/AGENT_GATES.md``.
2. Run ``pwsh ./scripts/memex-gate.ps1 doctor``.
3. Stay within the user-scoped task; avoid drive-by refactors.

## Before you hand off

1. ``pwsh ./scripts/memex-gate.ps1 gate1`` — post-intervention validation (`check` + `test`).
2. ``pwsh ./scripts/memex-gate.ps1 agentpack``
3. Leave ``.agent-handoff/memex_status.md`` and logs for the next agent.

## Hard rules

- **Never** commit secrets (``.env``, tokens, handles).
- **Never** write to ``Vault/Human/`` — agent writes belong in ``Vault/Agent/`` only.
- **Do not** merge or depend on PR #10 unless explicitly instructed.
- **Do not** add ProofLoop Python to this repo.

## Primary validation commands

``````powershell
npm run check   # syntax check across src modules
npm test        # full test suite
npm run bench   # read-path performance (gateperf)
``````

## Useful references

- ``README.md`` — product positioning and quick start
- ``docs/PERSONAL_MEMORY_FABRIC_BLUEPRINT.md`` — architecture gates
- ``docs/MCP_STATELESS_MIGRATION.md`` — MCP transport model
"@

  Set-Content -LiteralPath $statusPath -Value $status -Encoding utf8
  Set-Content -LiteralPath $promptPath -Value $prompt -Encoding utf8

  Write-LogLine "wrote $statusPath" $logPath
  Write-LogLine "wrote $promptPath" $logPath

  Write-LatestLog -Name 'agentpack' -SessionLogPath $logPath
  Write-ManifestEntry -Name 'agentpack' -LogPath $logPath -Ok $true
  Write-Host "agentpack: $statusPath"
  Write-Host "agentpack: $promptPath"
}

function Invoke-Clean {
  Ensure-HandoffDir
  $logPath = Get-SessionLogPath 'clean'
  New-Item -ItemType File -Path $logPath -Force | Out-Null

  $patterns = @('*.log', 'manifest.json', 'memex_status.md', 'agent_prompt.md')
  $removed = @()

  foreach ($pattern in $patterns) {
    Get-ChildItem -LiteralPath $HandoffDir -Filter $pattern -File -ErrorAction SilentlyContinue |
      ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Force
        $removed += $_.Name
      }
  }

  $summary = [ordered]@{
    command = 'clean'
    removed = $removed
    ok      = $true
  }

  $json = $summary | ConvertTo-Json -Depth 4
  Set-Content -LiteralPath $logPath -Value $json -Encoding utf8
  Write-Host $json
}

switch ($Command) {
  'doctor' { Invoke-Doctor }
  'gate0' { Invoke-NpmGate -GateName 'gate0' -NpmSteps @('check', 'test') }
  'gate1' { Invoke-NpmGate -GateName 'gate1' -NpmSteps @('check', 'test') }
  'gateperf' { Invoke-NpmGate -GateName 'gateperf' -NpmSteps @('bench') }
  'agentpack' { Invoke-AgentPack }
  'clean' { Invoke-Clean }
}
