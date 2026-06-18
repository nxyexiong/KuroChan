/**
 * copilot-cli-shim.cjs — preloaded into the spawned Copilot CLI via
 * NODE_OPTIONS=--require (only when KuroChan runs under Electron).
 *
 * The @github/copilot-sdk spawns the CLI with spawn(process.execPath, [cli.js]).
 * Inside Electron we set ELECTRON_RUN_AS_NODE=1 so Electron runs the CLI as
 * Node — but Electron still leaves process.versions.electron defined while
 * NOT setting process.defaultApp. The CLI uses commander, which then parses
 * argv in "electron" mode and (because defaultApp is falsy) slices argv from
 * index 1, mistaking the CLI script path for a positional argument
 * ("error: too many arguments. Expected 0 arguments but got 1").
 *
 * Forcing process.defaultApp = true makes commander slice argv from index 2,
 * exactly as it would under plain Node.
 */
try {
  if (process.versions && process.versions.electron && !process.defaultApp) {
    Object.defineProperty(process, 'defaultApp', { value: true, configurable: true });
  }
} catch {
  /* best-effort; ignore */
}
