param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$CloseFlag,
  [Parameter(Mandatory = $true)][string]$StatusFile
)

$ErrorActionPreference = "Stop"

function Write-Status([string]$json) {
  Set-Content -Path $StatusFile -Value $json -Encoding utf8
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class SpikeJobObject {
    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        public Int64 PerProcessUserTimeLimit;
        public Int64 PerJobUserTimeLimit;
        public UInt32 LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public UInt32 ActiveProcessLimit;
        public Int64 Affinity;
        public UInt32 PriorityClass;
        public UInt32 SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct IO_COUNTERS {
        public UInt64 ReadOperationCount;
        public UInt64 WriteOperationCount;
        public UInt64 OtherOperationCount;
        public UInt64 ReadTransferCount;
        public UInt64 WriteTransferCount;
        public UInt64 OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool SetInformationJobObject(
        IntPtr hJob, int JobObjectInfoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);

    public const int JobObjectExtendedLimitInformation = 9;
    public const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    public const uint PROCESS_TERMINATE = 0x0001;
    public const uint PROCESS_SET_QUOTA = 0x0100;
    public const uint PROCESS_SYNCHRONIZE = 0x00100000;

    public static bool EnableKillOnJobClose(IntPtr job, out int error) {
        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr ptr = Marshal.AllocHGlobal(length);
        try {
            Marshal.StructureToPtr(info, ptr, false);
            bool ok = SetInformationJobObject(job, JobObjectExtendedLimitInformation, ptr, (uint)length);
            error = ok ? 0 : Marshal.GetLastWin32Error();
            return ok;
        } finally {
            Marshal.FreeHGlobal(ptr);
        }
    }
}
"@

$job = [IntPtr]::Zero
$procHandle = [IntPtr]::Zero

try {
  $job = [SpikeJobObject]::CreateJobObject([IntPtr]::Zero, $null)
  if ($job -eq [IntPtr]::Zero) {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Status (@{ ok = $false; stage = "CreateJobObject"; win32 = $err } | ConvertTo-Json -Compress)
    exit 1
  }

  $setErr = 0
  $setOk = [SpikeJobObject]::EnableKillOnJobClose($job, [ref]$setErr)
  if (-not $setOk) {
    Write-Status (@{ ok = $false; stage = "SetInformationJobObject"; win32 = $setErr } | ConvertTo-Json -Compress)
    exit 1
  }

  $access = [SpikeJobObject]::PROCESS_TERMINATE -bor [SpikeJobObject]::PROCESS_SET_QUOTA -bor [SpikeJobObject]::PROCESS_SYNCHRONIZE
  $procHandle = [SpikeJobObject]::OpenProcess($access, $false, $ProcessId)
  if ($procHandle -eq [IntPtr]::Zero) {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Status (@{ ok = $false; stage = "OpenProcess"; win32 = $err; pid = $ProcessId } | ConvertTo-Json -Compress)
    exit 1
  }

  $assigned = [SpikeJobObject]::AssignProcessToJobObject($job, $procHandle)
  if (-not $assigned) {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Status (@{
      ok = $false
      stage = "AssignProcessToJobObject"
      win32 = $err
      pid = $ProcessId
      note = "Often ERROR_ACCESS_DENIED (5) if the process is already in a non-nested job (Windows Terminal / IDE / Job Object)."
    } | ConvertTo-Json -Compress)
    exit 1
  }

  Write-Status (@{ ok = $true; stage = "assigned"; pid = $ProcessId } | ConvertTo-Json -Compress)
  Write-Output "assigned pid=$ProcessId"

  $deadline = (Get-Date).AddSeconds(40)
  while (-not (Test-Path -LiteralPath $CloseFlag)) {
    if ((Get-Date) -gt $deadline) {
      Write-Status (@{ ok = $false; stage = "wait-close-flag"; timeout = $true } | ConvertTo-Json -Compress)
      exit 1
    }
    Start-Sleep -Milliseconds 50
  }

  Write-Output "closing job handle (KILL_ON_JOB_CLOSE)"
} finally {
  if ($procHandle -ne [IntPtr]::Zero) {
    [void][SpikeJobObject]::CloseHandle($procHandle)
  }
  if ($job -ne [IntPtr]::Zero) {
    [void][SpikeJobObject]::CloseHandle($job)
  }
}

Write-Status (@{ ok = $true; stage = "closed"; pid = $ProcessId } | ConvertTo-Json -Compress)
Write-Output "job closed"
