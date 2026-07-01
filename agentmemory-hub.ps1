# agentmemory-hub.ps1
# Legacy wrapper to maintain compatibility with existing Claude Desktop configurations.
# This ensures that existing MCP clients do not break during the migration to Memex Core.

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$targetPath = Join-Path -Path $scriptDir -ChildPath "memex-core.ps1"

# Forward all arguments exactly as received without printing to stdout (to avoid breaking MCP stdio)
& $targetPath @args
exit $LASTEXITCODE
