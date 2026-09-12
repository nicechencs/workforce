import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

import { CredentialBrokerError, type SecretStore } from "./secret-store.js";
import type { CapabilityRecord, EnforcementStatus } from "./types.js";
import { CONSTRAINT } from "./types.js";

export type OsSecretBackend = "macos-keychain" | "windows-credential-manager" | "libsecret";

export interface OsSecretStoreProbe {
  status: EnforcementStatus;
  backend?: OsSecretBackend;
  reason?: string;
}

export interface OsSecretStoreOptions {
  probe?: OsSecretStoreProbe;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

const SERVICE = "workforce";
const ACCOUNT = /^[A-Za-z0-9._:@-]{1,256}$/;
const PROBE_TIMEOUT_MS = 2_000;
const OP_TIMEOUT_MS = 8_000;
const NOT_FOUND_EXIT = 2;

let cachedProbe: OsSecretStoreProbe | undefined;

/**
 * Detect an OS credential backend without writing secrets.
 * Linux libsecret is only enforceable when a D-Bus session exists; a store
 * attempt without a session hangs waiting for a keyring prompt.
 */
export function probeOsSecretStore(
  input: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    refresh?: boolean;
  } = {},
): OsSecretStoreProbe {
  const custom = input.platform !== undefined || input.env !== undefined;
  if (!custom && cachedProbe !== undefined && input.refresh !== true) {
    return cachedProbe;
  }
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  const probe = detectBackend(platform, env);
  if (!custom) {
    cachedProbe = probe;
  }
  return probe;
}

export function probeCredentialCapabilities(
  input?: Parameters<typeof probeOsSecretStore>[0],
): readonly CapabilityRecord[] {
  const os = probeOsSecretStore(input);
  const injectStatus: EnforcementStatus =
    os.status === "enforceable" ? "enforceable" : "unsupported";
  return [
    { name: CONSTRAINT.credentialOsStore, status: os.status, owner: "T07" },
    { name: CONSTRAINT.credentialCopyEnv, status: "unsupported", owner: "T07" },
    { name: CONSTRAINT.credentialCopyAuthJson, status: "unsupported", owner: "T07" },
    { name: CONSTRAINT.credentialMinimalInject, status: injectStatus, owner: "T07" },
  ];
}

export function createOsSecretStore(options: OsSecretStoreOptions = {}): OsSecretStore {
  return new OsSecretStore(options);
}

/** Production SecretStore. Never copies `process.env`. Fail-closed when unprobed. */
export class OsSecretStore implements SecretStore {
  private readonly probe: OsSecretStoreProbe;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: OsSecretStoreOptions = {}) {
    this.env = options.env ?? process.env;
    this.probe =
      options.probe ??
      probeOsSecretStore({
        platform: options.platform ?? process.platform,
        env: this.env,
      });
  }

  get capability(): OsSecretStoreProbe {
    return this.probe;
  }

  async get(externalSecretId: string): Promise<string | undefined> {
    assertAccount(externalSecretId);
    this.assertUsable("get");
    const result = await this.run("get", externalSecretId);
    if (result.notFound) {
      return undefined;
    }
    return result.stdout;
  }

  async put(externalSecretId: string, secret: string): Promise<void> {
    assertAccount(externalSecretId);
    this.assertUsable("put");
    if (secret.length === 0) {
      throw new CredentialBrokerError("invalid_request", "secret must be non-empty");
    }
    await this.run("put", externalSecretId, secret);
  }

  async delete(externalSecretId: string): Promise<void> {
    assertAccount(externalSecretId);
    this.assertUsable("delete");
    await this.run("delete", externalSecretId);
  }

  private assertUsable(operation: string): void {
    if (this.probe.status === "enforceable" && this.probe.backend !== undefined) {
      return;
    }
    throw new CredentialBrokerError(
      "unsupported_capability",
      `OS credential store cannot ${operation}: ${this.probe.reason ?? this.probe.status}`,
    );
  }

  private async run(
    action: "get" | "put" | "delete",
    account: string,
    secret?: string,
  ): Promise<{ stdout: string; notFound: boolean }> {
    const backend = this.probe.backend;
    if (backend === undefined) {
      throw new CredentialBrokerError(
        "unsupported_capability",
        "OS credential store backend is not available",
      );
    }
    try {
      if (backend === "macos-keychain") {
        return await runMacos(action, account, secret);
      }
      if (backend === "windows-credential-manager") {
        return await runWindows(action, account, secret, this.env);
      }
      return await runLibsecret(action, account, secret, this.env);
    } catch (error) {
      if (error instanceof CredentialBrokerError) {
        throw error;
      }
      throw new CredentialBrokerError(
        "unsupported_capability",
        `OS credential store ${action} failed without exposing secret material`,
      );
    }
  }
}

function detectBackend(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): OsSecretStoreProbe {
  if (platform === "darwin") {
    const security =
      whichSync("security", env) ??
      (existsSync("/usr/bin/security") ? "/usr/bin/security" : undefined);
    if (security === undefined) {
      return { status: "unsupported", reason: "macos-keychain:security_cli_missing" };
    }
    return { status: "enforceable", backend: "macos-keychain" };
  }
  if (platform === "win32") {
    const powershell = whichSync("powershell.exe", env) ?? whichSync("powershell", env);
    if (powershell === undefined) {
      return { status: "unsupported", reason: "windows-credential-manager:powershell_missing" };
    }
    return { status: "enforceable", backend: "windows-credential-manager" };
  }
  if (platform === "linux") {
    if (!hasDbusSession(env)) {
      return { status: "unsupported", reason: "libsecret:no_dbus_session" };
    }
    if (whichSync("secret-tool", env) !== undefined || libsecretPythonAvailable(env)) {
      return { status: "enforceable", backend: "libsecret" };
    }
    return { status: "unsupported", reason: "libsecret:cli_and_gi_missing" };
  }
  return { status: "unsupported", reason: `os_secret_store:untested_platform:${platform}` };
}

function hasDbusSession(env: NodeJS.ProcessEnv): boolean {
  const address = env.DBUS_SESSION_BUS_ADDRESS;
  if (typeof address === "string" && address.length > 0) {
    return true;
  }
  const runtime = env.XDG_RUNTIME_DIR;
  return typeof runtime === "string" && runtime.length > 0 && existsSync(join(runtime, "bus"));
}

function libsecretPythonAvailable(env: NodeJS.ProcessEnv): boolean {
  const python = whichSync("python3", env);
  if (python === undefined) {
    return false;
  }
  try {
    execFileSync(
      python,
      ["-c", "import gi; gi.require_version('Secret','1'); from gi.repository import Secret"],
      { env, timeout: PROBE_TIMEOUT_MS, stdio: ["ignore", "ignore", "ignore"] },
    );
    return true;
  } catch {
    return false;
  }
}

async function runMacos(
  action: "get" | "put" | "delete",
  account: string,
  secret?: string,
): Promise<{ stdout: string; notFound: boolean }> {
  const bin = whichSync("security", process.env) ?? "/usr/bin/security";
  if (action === "get") {
    const result = await execCli(
      bin,
      ["find-generic-password", "-s", SERVICE, "-a", account, "-w"],
      {
        allowExit: [NOT_FOUND_EXIT, 44],
      },
    );
    if (result.exitCode === NOT_FOUND_EXIT || result.exitCode === 44) {
      return { stdout: "", notFound: true };
    }
    return { stdout: result.stdout.replace(/\n$/u, ""), notFound: false };
  }
  if (action === "delete") {
    await execCli(bin, ["delete-generic-password", "-s", SERVICE, "-a", account], {
      allowExit: [NOT_FOUND_EXIT, 44],
    });
    return { stdout: "", notFound: false };
  }
  if (secret === undefined) {
    throw new CredentialBrokerError("invalid_request", "secret must be non-empty");
  }
  await execCli(bin, ["add-generic-password", "-U", "-s", SERVICE, "-a", account, "-w", secret], {
    hideArgs: true,
  });
  return { stdout: "", notFound: false };
}

async function runWindows(
  action: "get" | "put" | "delete",
  account: string,
  secret: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; notFound: boolean }> {
  const powershell = whichSync("powershell.exe", env) ?? whichSync("powershell", env);
  if (powershell === undefined) {
    throw new CredentialBrokerError(
      "unsupported_capability",
      "windows-credential-manager:powershell_missing",
    );
  }
  const execOptions: {
    env: NodeJS.ProcessEnv;
    allowExit: readonly number[];
    input?: string;
  } = {
    env: {
      ...env,
      WORKFORCE_CRED_ACTION: action,
      WORKFORCE_CRED_TARGET: `Workforce/${account}`,
    },
    allowExit: [NOT_FOUND_EXIT],
  };
  if (action === "put") {
    if (secret === undefined) {
      throw new CredentialBrokerError("invalid_request", "secret must be non-empty");
    }
    execOptions.input = secret;
  }
  const result = await execCli(
    powershell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      WINDOWS_CRED_COMMAND,
    ],
    execOptions,
  );
  if (result.exitCode === NOT_FOUND_EXIT) {
    return { stdout: "", notFound: true };
  }
  return { stdout: result.stdout, notFound: false };
}

async function runLibsecret(
  action: "get" | "put" | "delete",
  account: string,
  secret: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; notFound: boolean }> {
  const secretTool = whichSync("secret-tool", env);
  if (secretTool !== undefined) {
    if (action === "get") {
      const result = await execCli(secretTool, ["lookup", "service", SERVICE, "account", account], {
        env,
        allowExit: [NOT_FOUND_EXIT, 1],
      });
      if (result.exitCode !== 0) {
        return { stdout: "", notFound: true };
      }
      return { stdout: result.stdout, notFound: false };
    }
    if (action === "delete") {
      await execCli(secretTool, ["clear", "service", SERVICE, "account", account], {
        env,
        allowExit: [NOT_FOUND_EXIT, 1],
      });
      return { stdout: "", notFound: false };
    }
    if (secret === undefined) {
      throw new CredentialBrokerError("invalid_request", "secret must be non-empty");
    }
    await execCli(
      secretTool,
      ["store", "--label=Workforce", "service", SERVICE, "account", account],
      { env, input: secret },
    );
    return { stdout: "", notFound: false };
  }
  const python = whichSync("python3", env);
  if (python === undefined) {
    throw new CredentialBrokerError("unsupported_capability", "libsecret:cli_and_gi_missing");
  }
  const pythonOptions: {
    env: NodeJS.ProcessEnv;
    allowExit: readonly number[];
    input?: string;
  } = {
    env,
    allowExit: [NOT_FOUND_EXIT],
  };
  if (action === "put") {
    if (secret === undefined) {
      throw new CredentialBrokerError("invalid_request", "secret must be non-empty");
    }
    pythonOptions.input = secret;
  }
  const result = await execCli(python, ["-c", LIBSECRET_PYTHON, action, account], pythonOptions);
  if (result.exitCode === NOT_FOUND_EXIT) {
    return { stdout: "", notFound: true };
  }
  return { stdout: result.stdout, notFound: false };
}

function assertAccount(externalSecretId: string): void {
  if (!ACCOUNT.test(externalSecretId)) {
    throw new CredentialBrokerError(
      "invalid_request",
      "external_secret_id is not a valid OS account",
    );
  }
}

function whichSync(bin: string, env: NodeJS.ProcessEnv): string | undefined {
  if (bin.includes("/") || bin.includes("\\")) {
    return existsSync(bin) ? bin : undefined;
  }
  const pathVar = env.PATH ?? "";
  const extensions =
    process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of pathVar.split(delimiter)) {
    if (dir.length === 0) {
      continue;
    }
    for (const ext of extensions) {
      const suffix = ext.length === 0 || bin.toLowerCase().endsWith(ext.toLowerCase()) ? "" : ext;
      const candidate = join(dir, `${bin}${suffix}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

async function execCli(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    input?: string;
    allowExit?: readonly number[];
    hideArgs?: boolean;
  } = {},
): Promise<{ stdout: string; exitCode: number }> {
  const spawnOptions: { timeout: number; env?: NodeJS.ProcessEnv; input?: string } = {
    timeout: OP_TIMEOUT_MS,
  };
  if (options.env !== undefined) {
    spawnOptions.env = options.env;
  }
  if (options.input !== undefined) {
    spawnOptions.input = options.input;
  }
  const result = await spawnUtf8(command, args, spawnOptions);
  if (result.exitCode === 0 || options.allowExit?.includes(result.exitCode) === true) {
    return { stdout: result.stdout, exitCode: result.exitCode };
  }
  throw new CredentialBrokerError(
    "unsupported_capability",
    options.hideArgs === true
      ? "OS credential store command failed"
      : `OS credential store command failed: ${command}`,
  );
}

function spawnUtf8(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; input?: string; timeout: number },
): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, options.timeout);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.resume();
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, exitCode: code ?? 1 });
    });
    if (options.input !== undefined) {
      child.stdin.end(options.input, "utf8");
    } else {
      child.stdin.end();
    }
  });
}

const LIBSECRET_PYTHON = `
import sys
import gi
gi.require_version("Secret", "1")
from gi.repository import Secret

schema = Secret.Schema.new(
    "org.workforce.credential",
    Secret.SchemaFlags.NONE,
    {
        "service": Secret.SchemaAttributeType.STRING,
        "account": Secret.SchemaAttributeType.STRING,
    },
)
action, account = sys.argv[1], sys.argv[2]
attrs = {"service": "workforce", "account": account}
if action == "get":
    value = Secret.password_lookup_sync(schema, attrs, None)
    if value is None:
        sys.exit(2)
    sys.stdout.write(value)
elif action == "put":
    secret = sys.stdin.read()
    if not secret:
        sys.exit(3)
    ok = Secret.password_store_sync(
        schema, attrs, Secret.COLLECTION_DEFAULT, "Workforce", secret, None
    )
    sys.exit(0 if ok else 1)
elif action == "delete":
    Secret.password_clear_sync(schema, attrs, None)
else:
    sys.exit(3)
`.trim();

const WINDOWS_CRED_COMMAND = `
$ErrorActionPreference = 'Stop'
$action = $env:WORKFORCE_CRED_ACTION
$target = $env:WORKFORCE_CRED_TARGET
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WorkforceCred {
  public const uint GENERIC = 1;
  public const uint LOCAL_MACHINE = 2;
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredWrite(ref CREDENTIAL credential, uint flags);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredRead(string target, uint type, uint reserved, out IntPtr credential);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredDelete(string target, uint type, uint reserved);
  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr cred);
}
"@
if ($action -eq 'get') {
  $ptr = [IntPtr]::Zero
  if (-not [WorkforceCred]::CredRead($target, [WorkforceCred]::GENERIC, 0, [ref]$ptr)) {
    exit 2
  }
  try {
    $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][WorkforceCred+CREDENTIAL])
    $bytes = New-Object byte[] $cred.CredentialBlobSize
    [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
    $text = [Text.Encoding]::Unicode.GetString($bytes).Trim([char]0)
    [Console]::Out.Write($text)
  } finally {
    [WorkforceCred]::CredFree($ptr)
  }
} elseif ($action -eq 'put') {
  $secret = [Console]::In.ReadToEnd()
  $bytes = [Text.Encoding]::Unicode.GetBytes($secret)
  $blob = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  try {
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)
    $cred = New-Object WorkforceCred+CREDENTIAL
    $cred.Type = [WorkforceCred]::GENERIC
    $cred.TargetName = $target
    $cred.UserName = 'Workforce'
    $cred.CredentialBlobSize = $bytes.Length
    $cred.CredentialBlob = $blob
    $cred.Persist = [WorkforceCred]::LOCAL_MACHINE
    if (-not [WorkforceCred]::CredWrite([ref]$cred, 0)) { exit 1 }
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($blob)
  }
} elseif ($action -eq 'delete') {
  [void][WorkforceCred]::CredDelete($target, [WorkforceCred]::GENERIC, 0)
} else { exit 3 }
`.trim();
