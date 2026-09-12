param(
  [ValidateSet("spawn", "snapshot", "identity")]
  [string]$Action = "spawn",
  [string]$RequestFile = "",
  [string]$StatusFile = "",
  [string]$CloseFlag = "",
  [string]$ExitFile = "",
  [string]$JobFile = "",
  [switch]$Capture = $false,
  [int]$ProcessId = 0
)

$ErrorActionPreference = "Stop"

function Write-Status([string]$json) {
  if (-not $StatusFile) { return }
  $tmp = "$StatusFile.tmp"
  [System.IO.File]::WriteAllText($tmp, $json)
  Move-Item -LiteralPath $tmp -Destination $StatusFile -Force
}

function Write-JsonFile([string]$file, [string]$json) {
  if (-not $file) { return }
  $tmp = "$file.tmp"
  [System.IO.File]::WriteAllText($tmp, $json)
  Move-Item -LiteralPath $tmp -Destination $file -Force
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
using System.Threading;

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

    public const int JobObjectBasicAccountingInformation = 1;
    public const int JobObjectExtendedLimitInformation = 9;
    public const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    public const uint CREATE_SUSPENDED = 0x00000004;
    public const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    public const uint CREATE_BREAKAWAY_FROM_JOB = 0x01000000;
    public const uint CREATE_NO_WINDOW = 0x08000000;
    public const uint STILL_ACTIVE = 259;
    public const uint WAIT_OBJECT_0 = 0;
    public const uint TH32CS_SNAPPROCESS = 0x00000002;
    public const uint HANDLE_FLAG_INHERIT = 0x00000001;
    public const int STARTF_USESHOWWINDOW = 1;
    public const int STARTF_USESTDHANDLES = 0x00000100;
    public const int STD_INPUT_HANDLE = -10;
    public const int STD_OUTPUT_HANDLE = -11;
    public const int STD_ERROR_HANDLE = -12;

    [StructLayout(LayoutKind.Sequential)]
    public struct SECURITY_ATTRIBUTES {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)]
        public bool bInheritHandle;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION {
        public Int64 TotalUserTime;
        public Int64 TotalKernelTime;
        public Int64 ThisPeriodTotalUserTime;
        public Int64 ThisPeriodTotalKernelTime;
        public UInt32 TotalPageFaultCount;
        public UInt32 TotalProcesses;
        public UInt32 ActiveProcesses;
        public UInt32 TotalTerminatedProcesses;
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
    public static extern uint ResumeThread(IntPtr hThread);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool QueryInformationJobObject(
        IntPtr hJob, int JobObjectInfoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength, out uint lpReturnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CreatePipe(
        out IntPtr hReadPipe, out IntPtr hWritePipe, ref SECURITY_ATTRIBUTES lpPipeAttributes, uint nSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool SetHandleInformation(IntPtr hObject, uint dwMask, uint dwFlags);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool ReadFile(
        IntPtr hFile, byte[] lpBuffer, uint nNumberOfBytesToRead, out uint lpNumberOfBytesRead, IntPtr lpOverlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool WriteFile(
        IntPtr hFile, byte[] lpBuffer, uint nNumberOfBytesToWrite, out uint lpNumberOfBytesWritten, IntPtr lpOverlapped);

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
        return LaunchProcess(applicationName, commandLine, cwd, env, breakaway, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, false);
    }

    public static LaunchResult LaunchCaptured(
        string applicationName, string commandLine, string cwd, IntPtr env, bool breakaway,
        IntPtr hStdInput, IntPtr hStdOutput, IntPtr hStdError) {
        return LaunchProcess(applicationName, commandLine, cwd, env, breakaway, hStdInput, hStdOutput, hStdError, true);
    }

    public static LaunchResult LaunchProcess(
        string applicationName, string commandLine, string cwd, IntPtr env, bool breakaway,
        IntPtr hStdInput, IntPtr hStdOutput, IntPtr hStdError, bool inheritHandles) {
        var si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        si.dwFlags = STARTF_USESHOWWINDOW;
        si.wShowWindow = 0;
        if (inheritHandles) {
            si.dwFlags |= STARTF_USESTDHANDLES;
            si.hStdInput = hStdInput;
            si.hStdOutput = hStdOutput;
            si.hStdError = hStdError;
        }
        var pi = new PROCESS_INFORMATION();
        uint flags = CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED;
        if (breakaway) {
            flags |= CREATE_BREAKAWAY_FROM_JOB;
        }
        var sb = new StringBuilder(commandLine);
        bool ok = CreateProcessW(
            applicationName, sb, IntPtr.Zero, IntPtr.Zero, inheritHandles, flags, env, cwd, ref si, out pi);
        var result = new LaunchResult();
        result.Ok = ok;
        result.Error = ok ? 0 : Marshal.GetLastWin32Error();
        result.Pid = pi.dwProcessId;
        result.ProcessHandle = pi.hProcess;
        result.ThreadHandle = pi.hThread;
        return result;
    }

    public static bool CreateStdPipes(
        out IntPtr stdinRead, out IntPtr stdinWrite,
        out IntPtr stdoutRead, out IntPtr stdoutWrite,
        out IntPtr stderrRead, out IntPtr stderrWrite,
        out int error) {
        stdinRead = stdinWrite = stdoutRead = stdoutWrite = stderrRead = stderrWrite = IntPtr.Zero;
        var sa = new SECURITY_ATTRIBUTES();
        sa.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
        sa.bInheritHandle = true;
        if (!CreatePipe(out stdinRead, out stdinWrite, ref sa, 0)) {
            error = Marshal.GetLastWin32Error();
            return false;
        }
        if (!SetHandleInformation(stdinWrite, HANDLE_FLAG_INHERIT, 0)) {
            error = Marshal.GetLastWin32Error();
            return false;
        }
        if (!CreatePipe(out stdoutRead, out stdoutWrite, ref sa, 0)) {
            error = Marshal.GetLastWin32Error();
            return false;
        }
        if (!SetHandleInformation(stdoutRead, HANDLE_FLAG_INHERIT, 0)) {
            error = Marshal.GetLastWin32Error();
            return false;
        }
        if (!CreatePipe(out stderrRead, out stderrWrite, ref sa, 0)) {
            error = Marshal.GetLastWin32Error();
            return false;
        }
        if (!SetHandleInformation(stderrRead, HANDLE_FLAG_INHERIT, 0)) {
            error = Marshal.GetLastWin32Error();
            return false;
        }
        error = 0;
        return true;
    }

    public static bool QueryActiveProcesses(IntPtr job, out uint active, out int error) {
        active = 0;
        var info = new JOBOBJECT_BASIC_ACCOUNTING_INFORMATION();
        int length = Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
        IntPtr ptr = Marshal.AllocHGlobal(length);
        try {
            uint returned;
            bool ok = QueryInformationJobObject(job, JobObjectBasicAccountingInformation, ptr, (uint)length, out returned);
            error = ok ? 0 : Marshal.GetLastWin32Error();
            if (!ok) {
                return false;
            }
            info = (JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)Marshal.PtrToStructure(ptr, typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
            active = info.ActiveProcesses;
            return true;
        } finally {
            Marshal.FreeHGlobal(ptr);
        }
    }

    public static Thread StartCopy(IntPtr src, IntPtr dst, bool closeDstOnEof) {
        var thread = new Thread(() => CopyPipe(src, dst, closeDstOnEof));
        thread.IsBackground = true;
        thread.Start();
        return thread;
    }

    public static void CopyPipe(IntPtr src, IntPtr dst, bool closeDstOnEof) {
        var buffer = new byte[8192];
        try {
            while (true) {
                uint read;
                if (!ReadFile(src, buffer, (uint)buffer.Length, out read, IntPtr.Zero) || read == 0) {
                    break;
                }
                int offset = 0;
                uint remaining = read;
                while (remaining > 0) {
                    var chunk = new byte[remaining];
                    Buffer.BlockCopy(buffer, offset, chunk, 0, (int)remaining);
                    uint written;
                    if (!WriteFile(dst, chunk, remaining, out written, IntPtr.Zero) || written == 0) {
                        return;
                    }
                    offset += (int)written;
                    remaining -= written;
                }
            }
        } finally {
            if (closeDstOnEof && dst != IntPtr.Zero) {
                CloseHandle(dst);
            }
        }
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
if ($Capture -and (-not $ExitFile -or -not $JobFile)) {
  throw "captured spawn requires ExitFile and JobFile"
}

$ProgressPreference = "SilentlyContinue"
$job = [IntPtr]::Zero
$hProcess = [IntPtr]::Zero
$hThread = [IntPtr]::Zero
$envPtr = [IntPtr]::Zero
$stdinRead = [IntPtr]::Zero
$stdinWrite = [IntPtr]::Zero
$stdoutRead = [IntPtr]::Zero
$stdoutWrite = [IntPtr]::Zero
$stderrRead = [IntPtr]::Zero
$stderrWrite = [IntPtr]::Zero
$stdinCopy = $null
$stdoutCopy = $null
$stderrCopy = $null
$stdinWriteOwnedByCopy = $false

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

  if ($Capture) {
    $pipeErr = 0
    $pipesOk = [WorkforceJobNative]::CreateStdPipes(
      [ref]$stdinRead, [ref]$stdinWrite,
      [ref]$stdoutRead, [ref]$stdoutWrite,
      [ref]$stderrRead, [ref]$stderrWrite,
      [ref]$pipeErr)
    if (-not $pipesOk) {
      Write-Status ((@{ ok = $false; stage = "CreateStdPipes"; win32 = $pipeErr }) | ConvertTo-Json -Compress)
      exit 1
    }
    $launch = [WorkforceJobNative]::LaunchCaptured($app, $commandLine, $cwd, $envPtr, $true, $stdinRead, $stdoutWrite, $stderrWrite)
    if (-not $launch.Ok) {
      $launch = [WorkforceJobNative]::LaunchCaptured($app, $commandLine, $cwd, $envPtr, $false, $stdinRead, $stdoutWrite, $stderrWrite)
    }
  } else {
    $launch = [WorkforceJobNative]::LaunchSuspended($app, $commandLine, $cwd, $envPtr, $true)
    if (-not $launch.Ok) {
      $launch = [WorkforceJobNative]::LaunchSuspended($app, $commandLine, $cwd, $envPtr, $false)
    }
  }
  if (-not $launch.Ok) {
    Write-Status ((@{ ok = $false; stage = "CreateProcessW"; win32 = $launch.Error }) | ConvertTo-Json -Compress)
    exit 1
  }

  $hProcess = $launch.ProcessHandle
  $hThread = $launch.ThreadHandle

  if ($Capture) {
    [void][WorkforceJobNative]::CloseHandle($stdinRead)
    $stdinRead = [IntPtr]::Zero
    [void][WorkforceJobNative]::CloseHandle($stdoutWrite)
    $stdoutWrite = [IntPtr]::Zero
    [void][WorkforceJobNative]::CloseHandle($stderrWrite)
    $stderrWrite = [IntPtr]::Zero
    $hStdIn = [WorkforceJobNative]::GetStdHandle(-10)
    $hStdOut = [WorkforceJobNative]::GetStdHandle(-11)
    $hStdErr = [WorkforceJobNative]::GetStdHandle(-12)
    $stdinCopy = [WorkforceJobNative]::StartCopy($hStdIn, $stdinWrite, $true)
    $stdinWriteOwnedByCopy = $true
    $stdoutCopy = [WorkforceJobNative]::StartCopy($stdoutRead, $hStdOut, $false)
    $stderrCopy = [WorkforceJobNative]::StartCopy($stderrRead, $hStdErr, $false)
  }

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

  if ($Capture) {
    Write-JsonFile $JobFile ((@{ activeProcesses = 1; jobClosed = $false }) | ConvertTo-Json -Compress)
    $jobClosed = $false
    $rootExited = $false
    while ($true) {
      if ((-not $jobClosed) -and (Test-Path -LiteralPath $CloseFlag)) {
        [void][WorkforceJobNative]::CloseHandle($job)
        $job = [IntPtr]::Zero
        $jobClosed = $true
        Write-JsonFile $JobFile ((@{ activeProcesses = 0; jobClosed = $true }) | ConvertTo-Json -Compress)
      }
      $waited = [WorkforceJobNative]::WaitForSingleObject($hProcess, 50)
      if ($waited -eq 0) {
        $rootExited = $true
      }
      if ($jobClosed) {
        if (-not $rootExited) {
          [void][WorkforceJobNative]::WaitForSingleObject($hProcess, 60000)
          $rootExited = $true
        }
        break
      }
      $active = [uint32]0
      $qerr = 0
      $qok = [WorkforceJobNative]::QueryActiveProcesses($job, [ref]$active, [ref]$qerr)
      if (-not $qok) {
        Write-JsonFile $ExitFile ((@{ ok = $false; stage = "QueryInformationJobObject"; win32 = $qerr }) | ConvertTo-Json -Compress)
        exit 1
      }
      Write-JsonFile $JobFile ((@{ activeProcesses = [int64]$active; jobClosed = $false }) | ConvertTo-Json -Compress)
      if ($rootExited -and $active -eq 0) {
        break
      }
    }

    $exitCode = [uint32]0
    $gotExit = [WorkforceJobNative]::GetExitCodeProcess($hProcess, [ref]$exitCode)
    if ((-not $gotExit) -or ($exitCode -eq [WorkforceJobNative]::STILL_ACTIVE)) {
      Write-JsonFile $ExitFile ((@{
        ok = $false
        stage = "GetExitCodeProcess"
        stillActive = ($exitCode -eq [WorkforceJobNative]::STILL_ACTIVE)
      }) | ConvertTo-Json -Compress)
      exit 1
    }
    if ($stdoutCopy) { [void]$stdoutCopy.Join() }
    if ($stderrCopy) { [void]$stderrCopy.Join() }
    if ($stdinCopy) { [void]$stdinCopy.Join(1000) }
    if (-not $jobClosed) {
      Write-JsonFile $JobFile ((@{ activeProcesses = 0; jobClosed = $false }) | ConvertTo-Json -Compress)
    }
    Write-JsonFile $ExitFile ((@{
      ok = $true
      exitCode = [int64]$exitCode
      activeProcesses = 0
      jobClosed = [bool]$jobClosed
    }) | ConvertTo-Json -Compress)
  } else {
    $stdinStream = [Console]::OpenStandardInput()
    $buf = New-Object byte[] 1
    $readOp = $stdinStream.BeginRead($buf, 0, 1, $null, $null)

    while ($true) {
      if (Test-Path -LiteralPath $CloseFlag) { break }
      if ($readOp.IsCompleted) { break }
      $waited = [WorkforceJobNative]::WaitForSingleObject($hProcess, 50)
      if ($waited -eq 0) { break }
    }
  }
} catch {
  try {
    Write-Status ((@{ ok = $false; stage = "trap"; error = $_.ToString() }) | ConvertTo-Json -Compress)
  } catch {}
  if ($Capture -and $ExitFile) {
    try {
      Write-JsonFile $ExitFile ((@{ ok = $false; stage = "trap"; error = $_.ToString() }) | ConvertTo-Json -Compress)
    } catch {}
  }
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
  if ((-not $stdinWriteOwnedByCopy) -and ($stdinWrite -ne [IntPtr]::Zero)) {
    [void][WorkforceJobNative]::CloseHandle($stdinWrite)
    $stdinWrite = [IntPtr]::Zero
  }
  foreach ($handle in @($stdinRead, $stdoutRead, $stdoutWrite, $stderrRead, $stderrWrite)) {
    if ($handle -ne [IntPtr]::Zero) {
      [void][WorkforceJobNative]::CloseHandle($handle)
    }
  }
  if ($envPtr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($envPtr)
    $envPtr = [IntPtr]::Zero
  }
}
