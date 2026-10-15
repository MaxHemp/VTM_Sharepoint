param(
  [Parameter(Mandatory)][string]$CredentialPath,
  [Parameter(Mandatory)][string]$Action,
  [string]$ArgumentsFile
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Dieser Client benötigt Windows DPAPI.' }
$credential = Get-Content -LiteralPath $CredentialPath -Raw | ConvertFrom-Json
if ($credential.actor -notin @('juergen','natalie','mika','artur') -or $credential.endpoint -ne 'https://sharepoint.versicherungstech-magazin.de/api/betrieb/mcp') { throw 'Ungültige Zugangskonfiguration.' }
if (([DateTimeOffset]$credential.expires_at) -le [DateTimeOffset]::UtcNow) { throw 'Zugang abgelaufen; beim Inhaber erneuern lassen.' }
$arguments = if ($ArgumentsFile) { Get-Content -LiteralPath $ArgumentsFile -Raw | ConvertFrom-Json -AsHashtable } else { @{} }
if ($arguments -isnot [System.Collections.IDictionary]) { throw 'Argumente müssen ein JSON-Objekt sein.' }
$leaseDirectory = Join-Path (Split-Path -Parent $CredentialPath) 'leases'
$leasedActions = @('renew_lease','submit_result','report_blocker')
$leasePath = $null
if ($Action -in (@('claim_job') + $leasedActions)) {
  if ($arguments.id -notmatch '^[0-9a-f-]{36}$') { throw 'Ungültige Auftrags-ID.' }
  $leasePath = Join-Path $leaseDirectory ($arguments.id + '.json')
  if ($Action -in $leasedActions) {
    if ($arguments.Contains('lease_token')) { throw 'Reservierungsschlüssel nicht in Argumentdateien ablegen.' }
    $lease = Get-Content -LiteralPath $leasePath -Raw | ConvertFrom-Json
    $arguments.lease_token = [Net.NetworkCredential]::new('', (ConvertTo-SecureString $lease.protected_lease)).Password
  }
}
$secret = ConvertTo-SecureString $credential.protected_token
$token = [Net.NetworkCredential]::new('', $secret).Password
$payload = @{jsonrpc='2.0';id=[Guid]::NewGuid().ToString();method='tools/call';params=@{name=$Action;arguments=$arguments}} | ConvertTo-Json -Depth 30 -Compress
try {
  # No automatic retry: an unknown outcome must be reconciled using the same request_key.
  $reply = Invoke-RestMethod -Uri $credential.endpoint -Method Post -ContentType 'application/json' -Headers @{Authorization="Bearer $token";'MCP-Protocol-Version'='2025-11-25'} -Body ([Text.Encoding]::UTF8.GetBytes($payload)) -TimeoutSec 30 -MaximumRedirection 0
} catch { throw 'Portalaufruf fehlgeschlagen. Keine automatische Wiederholung; Auftrag neu lesen und denselben request_key verwenden.' }
finally { $token=$null; $payload=$null; $arguments.Remove('lease_token') | Out-Null }
if ($reply.error) { throw "Portal-Protokollfehler: $($reply.error.code)" }
if ($reply.result.isError) {
  $failure = $reply.result.content[0].text | ConvertFrom-Json
  throw "Portalfehler $($failure.code): $($failure.message)"
}
$result = $reply.result.content[0].text | ConvertFrom-Json -AsHashtable
if ($result -is [System.Collections.IDictionary] -and $result.Contains('lease_token')) {
  if (-not $leasePath) { throw 'Unerwarteter Reservierungsschlüssel; Ausgabe unterdrückt.' }
  [IO.Directory]::CreateDirectory($leaseDirectory) | Out-Null
  @{protected_lease=ConvertFrom-SecureString (ConvertTo-SecureString $result.lease_token -AsPlainText -Force)} | ConvertTo-Json | Set-Content -LiteralPath $leasePath -Encoding utf8
  $result.Remove('lease_token') | Out-Null
  $result.lease_saved_locally = $true
}
$reply = $null
$result | ConvertTo-Json -Depth 30

