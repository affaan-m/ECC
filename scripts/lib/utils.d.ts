/**
 * Cross-platform utility functions for Claude Code hooks and scripts.
 * Works on Windows, macOS, and Linux.
 */

import type { ExecSyncOptions } from 'child_process';

// Platform detection
export const isWindows: boolean;
export const isMacOS: boolean;
export const isLinux: boolean;

// --- Directories ---

/** Get the user's home directory (cross-platform) */
export function getHomeDir(): string;

/**
 * ECC agent data root for memory persistence and related state.
 * Defaults to ~/.claude; override with ECC_AGENT_DATA_HOME (e.g. ~/.cursor/ecc).
 */
export function getAgentDataHome(): string;

/** Get the agent data directory (alias of getAgentDataHome) */
export function getClaudeDir(): string;

/** Get the canonical ECC sessions directory ($ECC_AGENT_DATA_HOME/session-data) */
export function getSessionsDir(): string;

/** Get the legacy sessions directory ($ECC_AGENT_DATA_HOME/sessions) */
export function getLegacySessionsDir(): string;

/** Get session directories to search, with canonical storage first and legacy fallback second */
export function getSessionSearchDirs(): string[];

/** Get the learned skills directory ($ECC_AGENT_DATA_HOME/skills/learned) */
export function getLearnedSkillsDir(): string;

/** Get the temp directory (cross-platform) */
export function getTempDir(): string;

/**
 * Ensure a directory exists, creating it recursively if needed.
 * Handles EEXIST race conditions from concurrent creation.
 * @throws If directory cannot be created (e.g., permission denied)
 */
export function ensureDir(dirPath: string): string;

// --- Date/Time ---

/** Get current date in YYYY-MM-DD format */
export function getDateString(): string;

/** Get current time in HH:MM format */
export function getTimeString(): string;

/** Get current datetime in YYYY-MM-DD HH:MM:SS format */
export function getDateTimeString(): string;

// --- Session/Project ---

/**
 * Sanitize a string for use as a session filename segment.
 * Replaces invalid characters, strips leading dots, and returns null when
 * nothing meaningful remains. Non-ASCII names are hashed for stability.
 */
export function sanitizeSessionId(raw: string | null | undefined): string | null;

/**
 * Get short session ID from CLAUDE_SESSION_ID environment variable.
 * Returns last 8 characters, falls back to a sanitized project name then the provided fallback.
 */
export function getSessionIdShort(fallback?: string): string;

/** Get the git repository name from the current working directory */
export function getGitRepoName(): string | null;

/** Get project name from git repo or current directory basename */
export function getProjectName(): string | null;

// --- File operations ---

export interface FileMatch {
  /** Absolute path to the matching file */
  path: string;
  /** Modification time in milliseconds since epoch */
  mtime: number;
}

export interface FindFilesOptions {
  /** Maximum age in days. Only files modified within this many days are returned. */
  maxAge?: number | null;
  /** Whether to search subdirectories recursively */
  recursive?: boolean;
}

/**
 * Find files matching a glob-like pattern in a directory.
 * Supports `*` (any chars), `?` (single char), and `.` (literal dot).
 * Results are sorted by modification time (newest first).
 */
export function findFiles(dir: string, pattern: string, options?: FindFilesOptions): FileMatch[];

/**
 * Read a text file safely. Returns null if the file doesn't exist or can't be read.
 */
export function readFile(filePath: string): string | null;

/** Write a text file, creating parent directories if needed */
export function writeFile(filePath: string, content: string): void;

/** Append to a text file, creating parent directories if needed */
export function appendFile(filePath: string, content: string): void;

export interface ReplaceInFileOptions {
  /**
   * When true and search is a string, replaces ALL occurrences (uses String.replaceAll).
   * Ignored for RegExp patterns — use the `g` flag instead.
   */
  all?: boolean;
}

/**
 * Replace text in a file (cross-platform sed alternative).
 * @returns true if the file was found and updated, false if file not found
 */
export function replaceInFile(filePath: string, search: string | RegExp, replace: string, options?: ReplaceInFileOptions): boolean;

/**
 * Count occurrences of a pattern in a file.
 * The global flag is enforced automatically for correct counting.
 */
export function countInFile(filePath: string, pattern: string | RegExp): number;

export interface GrepMatch {
  /** 1-based line number */
  lineNumber: number;
  /** Full content of the matching line */
  content: string;
}

/** Search for a pattern in a file and return matching lines with line numbers */
export function grepFile(filePath: string, pattern: string | RegExp): GrepMatch[];

// --- Hook I/O ---

export interface ReadStdinJsonOptions {
  /**
   * Timeout in milliseconds. Prevents hooks from hanging indefinitely
   * if stdin never closes. Default: 5000
   */
  timeoutMs?: number;
  /**
   * Maximum stdin data size in bytes. Prevents unbounded memory growth.
   * Default: 1048576 (1MB)
   */
  maxSize?: number;
}

/**
 * Read JSON from stdin (for hook input).
 * Returns an empty object if stdin is empty, times out, or contains invalid JSON.
 * Never rejects — safe to use without try-catch in hooks.
 */
export function readStdinJson(options?: ReadStdinJsonOptions): Promise<Record<string, unknown>>;

/** Log a message to stderr (visible to user in Claude Code terminal) */
export function log(message: string): void;

/** Output data to stdout (returned to Claude's context) */
export function output(data: string | Record<string, unknown>): void;

// --- System ---

/**
 * Check if a command exists in PATH.
 * Only allows alphanumeric, dash, underscore, and dot characters.
 * WARNING: Spawns a child process (where.exe on Windows, which on Unix).
 */
export function commandExists(cmd: string): boolean;

export interface CommandResult {
  success: boolean;
  /** Trimmed stdout on success, stderr or error message on failure */
  output: string;
}

/**
 * Run a shell command and return the output.
 * SECURITY: Only use with trusted, hardcoded commands.
 * Never pass user-controlled input directly.
 */
export function runCommand(cmd: string, options?: ExecSyncOptions): CommandResult;

/** Check if the current directory is inside a git repository */
export function isGitRepo(): boolean;

/**
 * Get git modified files (staged + unstaged), optionally filtered by regex patterns.
 * Invalid regex patterns are silently skipped.
 */
export function getGitModifiedFiles(patterns?: string[]): string[];
