$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$testFolder = Join-Path $repo ('work/client-check-' + [Guid]::NewGuid())
[IO.Directory]::CreateDirectory($testFolder) | Out-Null
$download = Join-Path $testFolder 'download.json'
$access = Join-Path $testFolder 'access.json'
$inputFile = Join-Path $testFolder 'arguments.json'
$fakeToken = 'x' * 43
$endpoint = 'https://sharepoint.versicherungstech-magazin.de/api/betrieb/mcp'
@{actor='artur';endpoint=$endpoint;token=$fakeToken;expires_at=[DateTimeOffset]::UtcNow.AddDays(1).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $download
& (Join-Path $repo 'scripts/connect-vtm-agent.ps1') -CredentialFile $download -Role artur -Destination $access | Out-Null
if (Test-Path -LiteralPath $download) { throw 'Klartextdownload wurde nicht entfernt.' }
if ((Get-Content -LiteralPath $access -Raw).Contains($fakeToken)) { throw 'Unverschlüsselter Token gespeichert.' }
$capture = @{response=@(); requests=[System.Collections.Generic.List[object]]::new()}

${function:Invoke-RestMethod} = {
  param($Uri,$Method,$ContentType,$Headers,$Body,$TimeoutSec,$MaximumRedirection)
  if ($Uri -ne $endpoint -or $Headers.Authorization -ne "Bearer $fakeToken" -or $MaximumRedirection -ne 0) { throw 'Unzulässiger Transport.' }
  $capture.requests.Add(([Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json -AsHashtable))
  return @{result=@{content=@(@{type='text';text=ConvertTo-Json -InputObject $capture.response -Depth 20 -Compress});isError=$false}}
}.GetNewClosure()
$jobId = [Guid]::NewGuid().ToString()
$capture.response = @{id=$jobId;version=2;lease_token='test-only-lease'}
@{id=$jobId;version=1;request_key='claim-stable-key'} | ConvertTo-Json | Set-Content -LiteralPath $inputFile
$output = & (Join-Path $repo 'scripts/invoke-vtm-agent.ps1') -CredentialPath $access -Action claim_job -ArgumentsFile $inputFile
if ($output.Contains('test-only-lease') -or $output.Contains($fakeToken)) { throw 'Geheimnis in Ausgabe.' }
if ($capture.requests[-1].params.arguments.request_key -ne 'claim-stable-key') { throw 'Wiederholungsschlüssel verändert.' }
$capture.response = @{id=$jobId;version=3;state='submitted'}
@{id=$jobId;version=2;request_key='submit-stable-key';result='Fiktives Ergebnis'} | ConvertTo-Json | Set-Content -LiteralPath $inputFile
& (Join-Path $repo 'scripts/invoke-vtm-agent.ps1') -CredentialPath $access -Action submit_result -ArgumentsFile $inputFile | Out-Null
if ($capture.requests[-1].params.arguments.lease_token -ne 'test-only-lease') { throw 'Lokale Reservierung nicht übernommen.' }
$before = $capture.requests.Count
$tampered = Get-Content -LiteralPath $access -Raw | ConvertFrom-Json
$tampered.endpoint = 'https://example.org/steal'
$tampered | ConvertTo-Json | Set-Content -LiteralPath $access
$rejected = $false
try { & (Join-Path $repo 'scripts/invoke-vtm-agent.ps1') -CredentialPath $access -Action list_jobs | Out-Null } catch { $rejected=$true }
if (-not $rejected -or $capture.requests.Count -ne $before) { throw 'Fremde Adresse nicht vor Transport blockiert.' }
Remove-Item -LiteralPath $access,$inputFile,(Join-Path $testFolder "leases/$jobId.json")
Write-Output 'Bestanden: DPAPI-Import, Klartextbereinigung, Geheimnisschutz der Ausgabe, stabiler Wiederholungsschlüssel, verschlüsselte Reservierung und Zielbindung. Nur fiktive Zugangsdaten, kein Netzwerk.'

