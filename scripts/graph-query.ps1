$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
Set-Location $Root

$nodeArgs = @("query") + $args
node --experimental-strip-types src/graph-cli.ts @nodeArgs
