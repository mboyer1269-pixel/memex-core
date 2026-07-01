$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
Set-Location $Root

$nodeArgs = @("add-entity") + $args
node --experimental-strip-types src/graph-cli.ts @nodeArgs
