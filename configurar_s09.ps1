param(
  [Parameter(Mandatory=$true)][string]$EnvPath,
  [Parameter(Mandatory=$true)][string]$BillingBaseUrl,
  [string]$TokenPath = ''
)

$resolvedEnv = [IO.Path]::GetFullPath($EnvPath)
if (-not $TokenPath) { $TokenPath = Join-Path $PSScriptRoot 'cliente-propio.env' }
$tokenLine = (Get-Content -Raw -LiteralPath $TokenPath).Trim()
if (-not $tokenLine.StartsWith('BILLING_TOKEN=')) { throw 'Archivo de token inválido.' }
$values = @{
  BILLING_BASE_URL = $BillingBaseUrl.TrimEnd('/')
  BILLING_TOKEN = $tokenLine.Substring('BILLING_TOKEN='.Length)
  BILLING_TIMEOUT_SECONDS = '15'
}
$lines = if (Test-Path -LiteralPath $resolvedEnv) { @(Get-Content -LiteralPath $resolvedEnv) } else { @() }
foreach ($key in $values.Keys) {
  $replacement = $key + '=' + $values[$key]
  $found = $false
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match ('^' + [regex]::Escape($key) + '=')) {
      $lines[$index] = $replacement
      $found = $true
    }
  }
  if (-not $found) { $lines += $replacement }
}
[IO.File]::WriteAllLines($resolvedEnv, $lines, (New-Object Text.UTF8Encoding($false)))
Write-Output 'S09 configurado sin mostrar el token.'
