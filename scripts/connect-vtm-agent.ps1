param(
  [Parameter(Mandatory)][string]$CredentialFile,
  [Parameter(Mandatory)][ValidateSet('juergen','natalie','mika','artur')][string]$Role,
  [Parameter(Mandatory)][string]$Destination
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Die Zugangssicherung benötigt Windows DPAPI.' }
$credential = Get-Content -LiteralPath $CredentialFile -Raw | ConvertFrom-Json
if ($credential.actor -ne $Role -or $credential.endpoint -ne 'https://sharepoint.versicherungstech-magazin.de/api/betrieb/mcp') { throw 'Rolle oder Zieladresse stimmt nicht überein.' }
if (([DateTimeOffset]$credential.expires_at) -le [DateTimeOffset]::UtcNow) { throw 'Zugang ist abgelaufen.' }
if ($credential.token -notmatch '^[A-Za-z0-9_-]{43}$') { throw 'Ungültiger Zugang.' }
$secret = ConvertTo-SecureString -String $credential.token -AsPlainText -Force
$record = @{ actor=$Role; endpoint=$credential.endpoint; expires_at=$credential.expires_at; protected_token=ConvertFrom-SecureString -SecureString $secret }
$folder = Split-Path -Parent ([IO.Path]::GetFullPath($Destination))
[IO.Directory]::CreateDirectory($folder) | Out-Null
if (Test-Path -LiteralPath $Destination) { throw 'Zieldatei existiert bereits. Bestehenden Zugang bewusst sichern oder ersetzen.' }
$record | ConvertTo-Json | Set-Content -LiteralPath $Destination -Encoding utf8
$credential.token = $null
# Only the just-imported plaintext download is removed; the encrypted destination remains.
Remove-Item -LiteralPath $CredentialFile
Write-Output "Zugang für $Role lokal verschlüsselt gespeichert. Verbindung noch nicht geprüft."

