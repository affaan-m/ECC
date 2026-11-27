/**
 * Package Manager Detection and Selection.
 * Supports: npm, pnpm, yarn, bun.
 */

/** Supported package manager names */
export type PackageManagerName = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** Configuration for a single package manager */
export interface PackageManagerConfig {
  name: PackageManagerName;
  /** Lock file name (e.g., "package-lock.json", "pnpm-lock.yaml") */
  lockFile: string;
  /** Install command (e.g., "npm install") */
  installCmd: string;
  /** Run script command prefix (e.g., "npm run", "pnpm") */
  runCmd: string;
  /** Execute binary command (e.g., "npx", "pnpm dlx") */
  execCmd: string;
  /** Test command (e.g., "npm test") */
  testCmd: string;
  /** Build command (e.g., "npm run build") */
  buildCmd: string;
  /** Dev server command (e.g., "npm run dev") */
  devCmd: string;
}

/** How the package manager was detected */
export type DetectionSource =
  | 'environment'
  | 'project-config'
  | 'package.json'
  | 'lock-file'
  | 'global-config'
  | 'default';

/** Result from getPackageManager() */
export interface PackageManagerResult {
  name: PackageManagerName;
  config: PackageManagerConfig;
  source: DetectionSource;
}

/** Map of all supported package managers keyed by name */
export const PACKAGE_MANAGERS: Record<PackageManagerName, PackageManagerConfig>;

/** Priority order for lock file detection */
export const DETECTION_PRIORITY: PackageManagerName[];

/** Check whether a value is a supported package manager name */
export function isSupportedPackageManager(name: unknown): name is PackageManagerName;

export interface GetPackageManagerOptions {
  /** Project directory to detect from (default: process.cwd()) */
  projectDir?: string;
}

/**
 * Get the package manager to use for the current project.
 *
 * Detection priority:
 * 1. CLAUDE_PACKAGE_MANAGER environment variable
 * 2. Project-specific config (.claude/package-manager.json)
 * 3. package.json `packageManager` field
 * 4. Lock file detection
 * 5. Global user preference (~/.claude/package-manager.json)
 * 6. Default to npm (no child processes spawned)
 */
export function getPackageManager(options?: GetPackageManagerOptions): PackageManagerResult;

/**
 * Set the user's globally preferred package manager.
 * Saves to ~/.claude/package-manager.json.
 * @throws If pmName is not a known package manager or if save fails
 */
export function setPreferredPackageManager(pmName: PackageManagerName): { packageManager: string; setAt: string };

/**
 * Set a project-specific preferred package manager.
 * Saves to <projectDir>/.claude/package-manager.json.
 * @throws If pmName is not a known package manager
 */
export function setProjectPackageManager(pmName: PackageManagerName, projectDir?: string): { packageManager: string; setAt: string };

/**
 * Get package managers installed on the system.
 * WARNING: Spawns child processes for each PM check.
 * Do NOT call during session startup hooks.
 */
export function getAvailablePackageManagers(): PackageManagerName[];

/** Detect package manager from lock file in the given directory */
export function detectFromLockFile(projectDir?: string): PackageManagerName | null;

/** Detect package manager from package.json `packageManager` field */
export function detectFromPackageJson(projectDir?: string): PackageManagerName | null;

/**
 * Get the full command string to run a script.
 * @param script - Script name: "install", "test", "build", "dev", or custom
 */
export function getRunCommand(script: string, options?: GetPackageManagerOptions): string;

/**
 * Get the full command string to execute a package binary.
 * @param binary - Binary name (e.g., "prettier", "eslint")
 * @param args - Arguments to pass to the binary
 */
export function getExecCommand(binary: string, args?: string, options?: GetPackageManagerOptions): string;

/**
 * Get a message prompting the user to configure their package manager.
 * Does NOT spawn child processes.
 */
export function getSelectionPrompt(): string;

/**
 * Generate a regex pattern string that matches commands for all package managers.
 * @param action - Action like "dev", "install", "test", "build", or custom
 * @returns Parenthesized alternation regex string, e.g., "(npm run dev|pnpm( run)? dev|...)"
 */
export function getCommandPattern(action: string): string;
