/**
 * Session Aliases Library for Claude Code.
 * Manages named aliases for session files, stored in $ECC_AGENT_DATA_HOME/session-aliases.json (default ~/.claude).
 */

/** Internal alias storage entry */
export interface AliasEntry {
  sessionPath: string;
  createdAt: string;
  updatedAt?: string;
  title: string | null;
}

/** Alias data structure stored on disk */
export interface AliasStore {
  version: string;
  aliases: Record<string, AliasEntry>;
  metadata: {
    totalCount: number;
    lastUpdated: string;
  };
}

/** Resolved alias information returned by resolveAlias */
export interface ResolvedAlias {
  alias: string;
  sessionPath: string;
  createdAt: string;
  title: string | null;
}

/** Alias entry returned by listAliases */
export interface AliasListItem {
  name: string;
  sessionPath: string;
  createdAt: string;
  updatedAt?: string;
  title: string | null;
}

/** Result from mutation operations (set, delete, rename, update, cleanup) */
export interface AliasResult {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface SetAliasResult extends AliasResult {
  isNew?: boolean;
  alias?: string;
  sessionPath?: string;
  title?: string | null;
}

export interface DeleteAliasResult extends AliasResult {
  alias?: string;
  deletedSessionPath?: string;
}

export interface RenameAliasResult extends AliasResult {
  oldAlias?: string;
  newAlias?: string;
  sessionPath?: string;
}

export interface CleanupResult {
  totalChecked: number;
  removed: number;
  removedAliases: Array<{ name: string; sessionPath: string }>;
  error?: string;
}

export interface ListAliasesOptions {
  /** Filter aliases by name or title (partial match, case-insensitive) */
  search?: string | null;
  /** Maximum number of aliases to return */
  limit?: number | null;
}

/** Get the path to the aliases JSON file */
export function getAliasesPath(): string;

/** Load all aliases from disk. Returns default structure if file doesn't exist. */
export function loadAliases(): AliasStore;

/**
 * Save aliases to disk with atomic write (temp file + rename).
 * Creates backup before writing; restores on failure.
 */
export function saveAliases(aliases: AliasStore): boolean;

/**
 * Resolve an alias name to its session data.
 * @returns Alias data, or null if not found or invalid name
 */
export function resolveAlias(alias: string): ResolvedAlias | null;

/**
 * Create or update an alias for a session.
 * Alias names must be alphanumeric with dashes/underscores.
 * Reserved names (list, help, remove, delete, create, set) are rejected.
 */
export function setAlias(alias: string, sessionPath: string, title?: string | null): SetAliasResult;

/**
 * List all aliases, optionally filtered and limited.
 * Results are sorted by updated time (newest first).
 */
export function listAliases(options?: ListAliasesOptions): AliasListItem[];

/** Delete an alias by name */
export function deleteAlias(alias: string): DeleteAliasResult;

/**
 * Rename an alias. Fails if old alias doesn't exist or new alias already exists.
 * New alias name must be alphanumeric with dashes/underscores.
 */
export function renameAlias(oldAlias: string, newAlias: string): RenameAliasResult;

/**
 * Resolve an alias or pass through a session path.
 * First tries to resolve as alias; if not found, returns the input as-is.
 */
export function resolveSessionAlias(aliasOrId: string): string;

/** Update the title of an existing alias. Pass null to clear. */
export function updateAliasTitle(alias: string, title: string | null): AliasResult;

/** Get all aliases that point to a specific session path */
export function getAliasesForSession(sessionPath: string): Array<{ name: string; createdAt: string; title: string | null }>;

/**
 * Remove aliases whose sessions no longer exist.
 * @param sessionExists - Function that returns true if a session path is valid
 */
export function cleanupAliases(sessionExists: (sessionPath: string) => boolean): CleanupResult;
