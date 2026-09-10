param(
  [ValidateSet("spawn", "snapshot", "identity")]
  [string]$Action = "spawn",
  [string]$RequestFile = "",
  [string]$StatusFile = "",
  [string]$CloseFlag = "",
  [int]$ProcessId = 0
)

$ErrorActionPreference = "Stop"

function Write-Status([string]$json) {
  if (-not $StatusFile) { return }
  $tmp = "$StatusFile.tmp"
  [System.IO.File]::WriteAllText($tmp, $json)
  Move-Item -LiteralPath $tmp -Destination $StatusFile -Force
}

if ($Action -eq "identity") {
  if ($ProcessId -le 0) { throw "ProcessId required" }
  $gp = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($gp -and $gp.StartTime) {
    Write-Output ("win32:{0}:{1}" -f $gp.Id, $gp.StartTime.ToUniversalTime().ToString("o"))
    exit 0
  }
  exit 2
}

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class WorkforceJobNative {
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

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO {
        public int cb;
        public IntPtr lpReserved;
        public IntPtr lpDesktop;
        public IntPtr lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct PROCESSENTRY32 {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    public struct LaunchResult {
        public bool Ok;
        public int Error;
        public int Pid;
        public IntPtr ProcessHandle;
        public IntPtr ThreadHandle;
    }

    public struct ProcRow {
        public int Pid;
        public int ParentPid;
        public string Name;
    }

    public const int JobObjectExtendedLimitInformation = 9;
    public const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    public const uint CREATE_SUSPENDED = 0x00000004;
    public const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    public const uint CREATE_BREAKAWAY_FROM_JOB = 0x01000000;
    public const uint CREATE_NO_WINDOW = 0x08000000;
    public const uint STILL_ACTIVE = 259;
    public const uint WAIT_OBJECT_0 = 0;
    public const uint TH32CS_SNAPPROCESS = 0x00000002;

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
    public static extern uint ResumeThread(IntPtr hThread);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GetProcessTimes(
        IntPtr hProcess, out long lpCreationTime, out long lpExitTime, out long lpKernelTime, out long lpUserTime);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CreateProcessW(
        string lpApplicationName,
        StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32First(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32Next(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

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

    public static LaunchResult LaunchSuspended(string applicationName, string commandLine, string cwd, IntPtr env, bool breakaway) {
        var si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        si.dwFlags = 1;
        si.wShowWindow = 0;
        var pi = new PROCESS_INFORMATION();
        uint flags = CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED;
        if (breakaway) {
            flags |= CREATE_BREAKAWAY_FROM_JOB;
        }
        var sb = new StringBuilder(commandLine);
        bool ok = CreateProcessW(
            applicationName, sb, IntPtr.Zero, IntPtr.Zero, false, flags, env, cwd, ref si, out pi);
        var result = new LaunchResult();
        result.Ok = ok;
        result.Error = ok ? 0 : Marshal.GetLastWin32Error();
        result.Pid = pi.dwProcessId;
        result.ProcessHandle = pi.hProcess;
        result.ThreadHandle = pi.hThread;
        return result;
    }

    public static ProcRow[] Snapshot() {
        var list = new List<ProcRow>();
        IntPtr snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snap == new IntPtr(-1)) {
            return list.ToArray();
        }
        try {
            var pe = new PROCESSENTRY32();
            pe.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
            if (!Process32First(snap, ref pe)) {
                return list.ToArray();
            }
            do {
                var row = new ProcRow();
                row.Pid = (int)pe.th32ProcessID;
                row.ParentPid = (int)pe.th32ParentProcessID;
                row.Name = pe.szExeFile;
                list.Add(row);
            } while (Process32Next(snap, ref pe));
        } finally {
            CloseHandle(snap);
        }
        return list.ToArray();
    }

    public static int[] DescendantsOf(int root) {
        ProcRow[] all = Snapshot();
        var byParent = new Dictionary<int, List<int>>();
        foreach (var row in all) {
            List<int> kids;
            if (!byParent.TryGetValue(row.ParentPid, out kids)) {
                kids = new List<int>();
                byParent[row.ParentPid] = kids;
            }
            kids.Add(row.Pid);
        }
        var result = new List<int>();
        var q = new Queue<int>();
        var seen = new HashSet<int>();
        q.Enqueue(root);
        seen.Add(root);
        while (q.Count > 0) {
            int cur = q.Dequeue();
            List<int> kids;
            if (!byParent.TryGetValue(cur, out kids)) {
                continue;
            }
            foreach (int child in kids) {
                if (seen.Add(child)) {
                    result.Add(child);
                    q.Enqueue(child);
                }
            }
        }
        return result.ToArray();
    }
}
"@

if ($Action -eq "snapshot") {
  if ($ProcessId -le 0) { throw "ProcessId required" }
  $ids = [WorkforceJobNative]::DescendantsOf($ProcessId)
  $rows = New-Object System.Collections.Generic.List[object]
  foreach ($childPid in $ids) {
    $gp = Get-Process -Id $childPid -ErrorAction SilentlyContinue
    if ($gp -and $gp.StartTime) {
      $rows.Add(@{
        pid = [int]$childPid
        startIdentity = "win32:${childPid}:$($gp.StartTime.ToUniversalTime().ToString('o'))"
      })
    }
  }
  if ($rows.Count -eq 0) {
    Write-Output "[]"
  } elseif ($rows.Count -eq 1) {
    Write-Output ("[" + ($rows[0] | ConvertTo-Json -Compress -Depth 5) + "]")
  } else {
    Write-Output ($rows | ConvertTo-Json -Compress -Depth 5)
  }
  exit 0
}

if (-not $RequestFile -or -not $StatusFile -or -not $CloseFlag) {
  throw "spawn requires RequestFile, StatusFile, and CloseFlag"
}

$job = [IntPtr]::Zero
$hProcess = [IntPtr]::Zero
$hThread = [IntPtr]::Zero
$envPtr = [IntPtr]::Zero

try {
  $raw = [System.IO.File]::ReadAllText($RequestFile)
  $req = $raw | ConvertFrom-Json
  $commandLine = [string]$req.commandLine
  $cwd = [string]$req.cwd
  $app = $null
  if ($req.PSObject.Properties.Name -contains "applicationName" -and $req.applicationName) {
    $app = [string]$req.applicationName
  }
  $envMap = @{}
  if ($req.env) {
    foreach ($prop in $req.env.PSObject.Properties) {
      $envMap[$prop.Name] = [string]$prop.Value
    }
  }

  $sb = New-Object System.Text.StringBuilder
  foreach ($key in ($envMap.Keys | Sort-Object)) {
    [void]$sb.Append([string]$key)
    [void]$sb.Append("=")
    [void]$sb.Append([string]$envMap[$key])
    [void]$sb.Append([char]0)
  }
  [void]$sb.Append([char]0)
  $bytes = [System.Text.Encoding]::Unicode.GetBytes($sb.ToString())
  $envPtr = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $envPtr, $bytes.Length)

  $job = [WorkforceJobNative]::CreateJobObject([IntPtr]::Zero, $null)
  if ($job -eq [IntPtr]::Zero) {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Status ((@{ ok = $false; stage = "CreateJobObject"; win32 = $err }) | ConvertTo-Json -Compress)
    exit 1
  }

  $setErr = 0
  $setOk = [WorkforceJobNative]::EnableKillOnJobClose($job, [ref]$setErr)
  if (-not $setOk) {
    Write-Status ((@{ ok = $false; stage = "SetInformationJobObject"; win32 = $setErr }) | ConvertTo-Json -Compress)
    exit 1
  }

  $launch = [WorkforceJobNative]::LaunchSuspended($app, $commandLine, $cwd, $envPtr, $true)
  if (-not $launch.Ok) {
    $launch = [WorkforceJobNative]::LaunchSuspended($app, $commandLine, $cwd, $envPtr, $false)
  }
  if (-not $launch.Ok) {
    Write-Status ((@{ ok = $false; stage = "CreateProcessW"; win32 = $launch.Error }) | ConvertTo-Json -Compress)
    exit 1
  }

  $hProcess = $launch.ProcessHandle
  $hThread = $launch.ThreadHandle

  $assigned = [WorkforceJobNative]::AssignProcessToJobObject($job, $hProcess)
  if (-not $assigned) {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    [void][WorkforceJobNative]::TerminateProcess($hProcess, 1)
    Write-Status ((@{
      ok = $false
      stage = "AssignProcessToJobObject"
      win32 = $err
      pid = $launch.Pid
    }) | ConvertTo-Json -Compress)
    exit 1
  }

  $prev = [WorkforceJobNative]::ResumeThread($hThread)
  if ($prev -eq [uint32]::MaxValue) {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    [void][WorkforceJobNative]::TerminateProcess($hProcess, 1)
    Write-Status ((@{ ok = $false; stage = "ResumeThread"; win32 = $err }) | ConvertTo-Json -Compress)
    exit 1
  }

  $identity = $null
  for ($i = 0; $i -lt 40; $i++) {
    $gp = Get-Process -Id $launch.Pid -ErrorAction SilentlyContinue
    if ($gp -and $gp.StartTime) {
      $identity = "win32:$($launch.Pid):$($gp.StartTime.ToUniversalTime().ToString('o'))"
      break
    }
    Start-Sleep -Milliseconds 25
  }
  if (-not $identity) {
    [void][WorkforceJobNative]::TerminateProcess($hProcess, 1)
    Write-Status ((@{ ok = $false; stage = "Get-Process.StartTime"; pid = $launch.Pid }) | ConvertTo-Json -Compress)
    exit 1
  }

  Write-Status ((@{ ok = $true; pid = [int]$launch.Pid; startIdentity = $identity }) | ConvertTo-Json -Compress)

  $stdinStream = [Console]::OpenStandardInput()
  $buf = New-Object byte[] 1
  $readOp = $stdinStream.BeginRead($buf, 0, 1, $null, $null)

  while ($true) {
    if (Test-Path -LiteralPath $CloseFlag) { break }
    if ($readOp.IsCompleted) { break }
    $waited = [WorkforceJobNative]::WaitForSingleObject($hProcess, 50)
    if ($waited -eq 0) { break }
  }
} catch {
  try {
    Write-Status ((@{ ok = $false; stage = "trap"; error = $_.ToString() }) | ConvertTo-Json -Compress)
  } catch {}
  throw
} finally {
  if ($hThread -ne [IntPtr]::Zero) {
    [void][WorkforceJobNative]::CloseHandle($hThread)
    $hThread = [IntPtr]::Zero
  }
  if ($hProcess -ne [IntPtr]::Zero) {
    [void][WorkforceJobNative]::CloseHandle($hProcess)
    $hProcess = [IntPtr]::Zero
  }
  if ($job -ne [IntPtr]::Zero) {
    [void][WorkforceJobNative]::CloseHandle($job)
    $job = [IntPtr]::Zero
  }
  if ($envPtr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($envPtr)
    $envPtr = [IntPtr]::Zero
  }
}
