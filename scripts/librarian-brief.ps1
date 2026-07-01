param (
    [string]$Task = "General status request",
    [int]$TokenBudget = 1000,
    [string]$Namespace = "global"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$rootDir = (Resolve-Path "$scriptDir\..").ProviderPath

cd $rootDir

node --experimental-strip-types src/librarian-cli.ts -Task "$Task" -TokenBudget "$TokenBudget" -Namespace "$Namespace"
