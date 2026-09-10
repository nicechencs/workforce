param(
  [string]$ProcessIds = ""
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class SpikeProcSnap {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
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

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern bool Process32First(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern bool Process32Next(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    private const uint TH32CS_SNAPPROCESS = 0x00000002;
    private static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

    public static List<object> Snapshot() {
        var list = new List<object>();
        IntPtr snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snap == INVALID_HANDLE_VALUE) {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        try {
            var pe = new PROCESSENTRY32();
            pe.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
            if (!Process32First(snap, ref pe)) {
                return list;
            }
            do {
                list.Add(new {
                    pid = (int)pe.th32ProcessID,
                    parentPid = (int)pe.th32ParentProcessID,
                    name = pe.szExeFile
                });
            } while (Process32Next(snap, ref pe));
        } finally {
            CloseHandle(snap);
        }
        return list;
    }
}
"@

$all = [SpikeProcSnap]::Snapshot()
$idList = @()
if ($ProcessIds) {
  $idList = @($ProcessIds.Split(',') | Where-Object { $_ } | ForEach-Object { [int]$_ })
}
if ($idList.Count -gt 0) {
  $wanted = New-Object 'System.Collections.Generic.HashSet[int]'
  foreach ($p in $idList) { [void]$wanted.Add($p) }
  $all = $all | Where-Object { $wanted.Contains([int]$_.pid) -or $wanted.Contains([int]$_.parentPid) }
}

$all | ConvertTo-Json -Compress -Depth 4
