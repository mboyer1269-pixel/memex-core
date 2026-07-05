param(
  [Parameter(Position=0)]
  [ValidateSet('help', 'doctor', 'start', 'stop', 'status', 'smoke', 'validate-clients', 'open', 'repair', 'governance', 'governance-check', 'namespace-list', 'memory-policy', 'graph-init', 'graph-add-entity', 'graph-add-relation', 'graph-query', 'graph-context-pack', 'graph-export', 'expose', 'worker-start')]
  [string]$Command = 'help',

  [switch]$CreateEnv,
  [switch]$InstallStartupTask,
  [switch]$DryRun,
  [switch]$Json,
  
  [Parameter(ValueFromRemainingArguments=$true)]
  [String[]]$ExtraArgs
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSCommandPath
$UserHome = $env:USERPROFILE
$EnvFile = Join-Path $UserHome ".agentmemory\.env"

function Show-Help {
  Write-Output "AgentMemory Hub CLI Operator (v0.5.0)"
  Write-Output ""
  Write-Output "Usage: pwsh ./agentmemory-hub.ps1 <command> [options]"
  Write-Output ""
  Write-Output "Commands:"
  Write-Output "  help             Show this help message"
  Write-Output "  doctor           Run diagnostic checks (outputs JSON)"
  Write-Output "  start            Start the hub process locally"
  Write-Output "  stop             Stop the hub process"
  Write-Output "  status           Check service availability"
  Write-Output "  smoke            Run basic read/write smoke tests"
  Write-Output "  validate-clients Validate client MCP configurations"
  Write-Output "  open             Open the viewer in the default browser"
  Write-Output "  repair           Repair local environment (idempotent)"
  Write-Output "  expose           Start the SSE Gateway for mobile/remote access"
  Write-Output "  worker-start     Start the Background Worker for memory consolidation"
  Write-Output ""
  Write-Output "Governance Commands (v0.4):"
  Write-Output "  governance       View the full memory governance config"
  Write-Output "  governance-check Verify the governance rules"
  Write-Output "  namespace-list   List the allowed memory namespaces"
  Write-Output "  memory-policy    View the memory retention policy"
  Write-Output ""
  Write-Output "Graph Sidecar Commands (v0.5):"
  Write-Output "  graph-init           Initialize the graph database"
  Write-Output "  graph-add-entity     Add an entity to the graph"
  Write-Output "  graph-add-relation   Add a relation to the graph"
  Write-Output "  graph-query          Query entities and relations"
  Write-Output "  graph-context-pack   Build a context pack for an entity"
  Write-Output "  graph-export         Export the graph to JSON"
  Write-Output ""
  Write-Output "Options for 'repair':"
  Write-Output "  -CreateEnv           Create a minimal local-only .env if missing"
  Write-Output "  -InstallStartupTask  Install or reinstall the Windows Scheduled Task"
  Write-Output "  -DryRun              Report what would be done without modifying"
  Write-Output "  -Json                Output repair summary as JSON"
}

function Invoke-Script($ScriptName, $ArgsToPass) {
  $path = Join-Path $Root "scripts\$ScriptName.ps1"
  if (-not (Test-Path -LiteralPath $path)) {
    Write-Error "Script not found: $path"
    exit 1
  }
  if ($null -ne $ArgsToPass -and $ArgsToPass.Count -gt 0) {
    & $path @ArgsToPass
  } else {
    & $path
  }
}

function Test-HubHealth {
  try {
    $res = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:4311/hub/health" -TimeoutSec 3 -ErrorAction SilentlyContinue
    return $res.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Invoke-Repair {
  $report = [ordered]@{
    envState = "ok"
    taskState = "skipped"
    hubState = "ok"
    actions = @()
    error = $null
  }

  # 1. Check .env
  if (-not (Test-Path -LiteralPath $EnvFile)) {
    if ($CreateEnv) {
      $report.envState = "created"
      $msg = "Creating minimal .env at $EnvFile"
      if (-not $DryRun) {
        $envDir = Split-Path -Parent $EnvFile
        if (-not (Test-Path -LiteralPath $envDir)) { New-Item -ItemType Directory -Path $envDir -Force | Out-Null }
        $envContent = @"
HUB_BIND_HOST=127.0.0.1
HUB_API_PORT=4311
HUB_VIEWER_PORT=4313
UPSTREAM_REST_PORT=3111
UPSTREAM_VIEWER_PORT=3113
# AGENTMEMORY_SECRET intentionally omitted for local-only setup
"@
        Set-Content -Path $EnvFile -Value $envContent -Encoding utf8
      }
      $report.actions += $msg
    } else {
      $report.envState = "missing"
      $report.error = "Missing .env file. Use -CreateEnv to generate a minimal local-only config."
      if ($Json) { $report | ConvertTo-Json -Depth 4; exit 1 }
      Write-Error $report.error
      exit 1
    }
  }

  # 2. Check Task
  if ($InstallStartupTask) {
    $report.taskState = "reinstalled"
    $msg = "Installing startup task"
    if (-not $DryRun) {
      $path = Join-Path $Root "scripts\install-startup-task.ps1"
      & $path | Out-Null
    }
    $report.actions += $msg
  }

  # 3. Check Hub Health
  $healthy = Test-HubHealth
  if (-not $healthy) {
    $report.hubState = "restarted"
    $msg = "Hub is down, starting hub via start.ps1"
    if (-not $DryRun) {
      $path = Join-Path $Root "scripts\start.ps1"
      & $path | Out-Null
      # Wait a moment to ensure it comes up
      Start-Sleep -Seconds 5
      if (-not (Test-HubHealth)) {
        $report.hubState = "failed_to_start"
        $report.error = "Hub failed to start."
      }
    }
    $report.actions += $msg
  }

  if ($Json) {
    $report | ConvertTo-Json -Depth 4
    if ($report.error) { exit 1 }
  } else {
    Write-Output "Repair Report:"
    Write-Output "  Environment: $($report.envState)"
    Write-Output "  Startup Task: $($report.taskState)"
    Write-Output "  Hub Status: $($report.hubState)"
    if ($report.actions.Count -gt 0) {
      Write-Output "Actions Taken:"
      foreach ($a in $report.actions) { Write-Output "  - $a" }
    } else {
      Write-Output "No repair actions were necessary."
    }
    if ($report.error) {
      Write-Error $report.error
      exit 1
    }
  }
}

switch ($Command) {
  'help' { Show-Help; exit 0 }
  'doctor' { & (Join-Path $Root "scripts\memex-gate.ps1") doctor; exit $LASTEXITCODE }
  'start' { Invoke-Script "start"; exit 0 }
  'stop' { Invoke-Script "stop"; exit 0 }
  'status' { Invoke-Script "status"; exit 0 }
  'smoke' { Invoke-Script "smoke"; exit 0 }
  'validate-clients' { Invoke-Script "validate-clients"; exit 0 }
  'governance' { Invoke-Script "governance"; exit 0 }
  'governance-check' { Invoke-Script "governance-check"; exit 0 }
  'namespace-list' { Invoke-Script "namespace-list"; exit 0 }
  'memory-policy' { Invoke-Script "memory-policy"; exit 0 }
  'graph-init' { Invoke-Script "graph-init" $ExtraArgs; exit 0 }
  'graph-add-entity' { Invoke-Script "graph-add-entity" $ExtraArgs; exit 0 }
  'graph-add-relation' { Invoke-Script "graph-add-relation" $ExtraArgs; exit 0 }
  'graph-query' { Invoke-Script "graph-query" $ExtraArgs; exit 0 }
  'graph-context-pack' { Invoke-Script "graph-context-pack" $ExtraArgs; exit 0 }
  'graph-export' { Invoke-Script "graph-export" $ExtraArgs; exit 0 }
  'expose' { 
    Write-Output "Starting MCP Gateway on SSE..."
    node --experimental-strip-types ./src/mcp/gateway.ts
    exit 0 
  }
  'worker-start' { 
    Write-Output "Starting Background Worker..."
    node --experimental-strip-types ./src/ai/worker.ts
    exit 0 
  }
  'open' {
    Write-Output "Opening Viewer at http://127.0.0.1:4313"
    Start-Process "http://127.0.0.1:4313"
    exit 0
  }
  'repair' { Invoke-Repair; exit 0 }
}
