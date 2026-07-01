# bin/memex-core.ps1
# Canonical wrapper for future use. 
# The main logic currently resides in the root memex-core.ps1 until the full cleanup phase.

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$targetPath = Join-Path -Path $scriptDir -ChildPath "..\memex-core.ps1"

# Forward all arguments exactly as received without printing to stdout (to avoid breaking MCP stdio)
& $targetPath @args
exit $LASTEXITCODE
