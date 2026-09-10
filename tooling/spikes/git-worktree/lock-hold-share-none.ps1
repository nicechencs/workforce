param(
  [Parameter(Mandatory = $true)]
  [string]$FilePath
)
# FileShare.None: typical native Windows lock (IDE/AV/office). Node fs.open uses FILE_SHARE_DELETE and does not block unlink.
$script:hold = [System.IO.File]::Open(
  $FilePath,
  [System.IO.FileMode]::Open,
  [System.IO.FileAccess]::ReadWrite,
  [System.IO.FileShare]::None
)
[Console]::Out.WriteLine("LOCKED pid=$PID share=None file=$FilePath")
[Console]::Out.Flush()
while ($true) {
  Start-Sleep -Seconds 60
}
