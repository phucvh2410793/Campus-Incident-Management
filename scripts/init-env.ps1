$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $projectRoot '.env'
if (Test-Path -LiteralPath $destination) {
    Write-Host '.env already exists; no changes made.'
    exit 0
}
function New-RandomHex {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}
$content = Get-Content -Raw -LiteralPath (Join-Path $projectRoot '.env.example')
$content = $content.Replace('POSTGRES_PASSWORD=replace-with-random-hex', "POSTGRES_PASSWORD=$(New-RandomHex)")
$content = $content.Replace('N8N_ENCRYPTION_KEY=replace-with-random-hex', "N8N_ENCRYPTION_KEY=$(New-RandomHex)")
[IO.File]::WriteAllText($destination, $content, [Text.UTF8Encoding]::new($false))
Write-Host 'Created local .env with random credentials. Keep it outside Git.'
