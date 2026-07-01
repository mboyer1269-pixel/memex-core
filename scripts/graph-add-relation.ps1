$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
Set-Location $Root

$nodeArgs = @("add-relation") + $args
node --experimental-strip-types src/graph-cli.ts @nodeArgs
