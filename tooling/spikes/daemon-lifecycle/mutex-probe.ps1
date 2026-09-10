param(
  [Parameter(Mandatory = $true)][string]$Name,
  [int]$HoldSeconds = 8
)

$created = $false
$mutex = New-Object System.Threading.Mutex($true, $Name, [ref]$created)
if (-not $created) {
  Write-Output "BUSY"
  exit 2
}
Write-Output "HELD"
try {
  Start-Sleep -Seconds $HoldSeconds
}
finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
Write-Output "RELEASED"
exit 0
