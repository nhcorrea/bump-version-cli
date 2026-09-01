import { spawnSync } from "node:child_process";

export function resolveCommandInvocation(command, args = [], runtime = {}) {
  const platform = runtime.platform ?? process.platform;

  if (platform === "win32" && /\.cmd$/i.test(command)) {
    return {
      command:
        runtime.commandShell ??
        process.env.ComSpec ??
        process.env.COMSPEC ??
        "cmd.exe",
      args: ["/d", "/c", command, ...args],
      usesCommandShell: true,
    };
  }

  return {
    command,
    args: [...args],
    usesCommandShell: false,
  };
}

export function spawnCommandSync(command, args = [], options = {}) {
  const invocation = resolveCommandInvocation(command, args);
  const spawnOptions = invocation.usesCommandShell
    ? { windowsHide: true, ...options }
    : options;

  return spawnSync(invocation.command, invocation.args, spawnOptions);
}

export function describeSpawnFailure(result) {
  const details = [
    result.error?.message,
    typeof result.stderr === "string" ? result.stderr.trim() : undefined,
    typeof result.stdout === "string" ? result.stdout.trim() : undefined,
  ].filter(Boolean);

  return (
    details.join("\n") ||
    `status=${String(result.status)}, signal=${String(result.signal)}`
  );
}
