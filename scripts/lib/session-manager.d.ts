/**
 * Session Manager Library for Claude Code.
 * Provides CRUD operations for session files stored as markdown in
 * ~/.claude/session-data/ with legacy read compatibility for ~/.claude/sessions/.
 */

/** Parsed metadata from a session filename */
export interface SessionFilenameMeta {
  /** Original filename */
  filename: string;
  /** Short ID extracted from filename, or "no-id" for old format */
  shortId: string;
  /** Date string in YYYY-MM-DD format */
  date: string;
  /** Parsed Date object from the date string */
  datetime: Date;
}

/** Metadata parsed from session markdown content */
export interface SessionMetadata {
  title: string | null;
  date: string | null;
  started: string | null;
  lastUpdated: string | null;
  completed: string[];
  inProgress: string[];
  notes: string;
  context: string;
}

/** Statistics computed from session content */
export interface SessionStats {
  totalItems: number;
  completedItems: number;
  inProgressItems: number;
  lineCount: number;
  hasNotes: boolean;
  hasContext: boolean;
}

/** A session object returned by getAllSessions and getSessionById */
export interface Session extends SessionFilenameMeta {
  /** Full filesystem path to the session file */
  sessionPath: string;
  /** Whether the file has any content */
  hasContent?: boolean;
  /** File size in bytes */
  size: number;
  /** Last modification time */
  modifiedTime: Date;
  /** File creation time (falls back to ctime on Linux) */
  createdTime: Date;
  /** Session markdown content (only when includeContent=true) */
  content?: string | null;
  /** Parsed metadata (only when includeContent=true) */
  metadata?: SessionMetadata;
  /** Session statistics (only when includeContent=true) */
  stats?: SessionStats;
}

/** Pagination result from getAllSessions */
export interface SessionListResult {
  sessions: Session[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface GetAllSessionsOptions {
  /** Maximum number of sessions to return (default: 50) */
  limit?: number;
  /** Number of sessions to skip (default: 0) */
  offset?: number;
  /** Filter by date in YYYY-MM-DD format */
  date?: string | null;
  /** Search in short ID */
  search?: string | null;
}

export interface GetSessionByIdOptions {
  /**
   * auto (default) ranks exact IDs and filename/date aliases before prefixes;
   * modification time breaks ties. id prefers exact short IDs and also accepts
   * ID prefixes and legacy date aliases. filename accepts full filenames or
   * filenames without .tmp only.
   */
  matchBy?: 'auto' | 'id' | 'filename';
}

/**
 * Parse a session filename to extract date and short ID.
 * @returns Parsed metadata, or null if the filename doesn't match the expected pattern
 */
export function parseSessionFilename(filename: string): SessionFilenameMeta | null;

/** Get the full filesystem path for a session filename */
export function getSessionPath(filename: string): string;

/**
 * Read session markdown content from disk.
 * @returns Content string, or null if the file doesn't exist
 */
export function getSessionContent(sessionPath: string): string | null;

/** Parse session metadata from markdown content */
export function parseSessionMetadata(content: string | null): SessionMetadata;

/**
 * Calculate statistics for a session.
 * Accepts either a file path (absolute, ending in .tmp) or pre-read content string.
 * Supports both Unix (/path/to/session.tmp) and Windows (C:\path\to\session.tmp) paths.
 */
export function getSessionStats(sessionPathOrContent: string): SessionStats;

/** Get the title from a session file, or "Untitled Session" if none */
export function getSessionTitle(sessionPath: string): string;

/** Get human-readable file size (e.g., "1.2 KB") */
export function getSessionSize(sessionPath: string): string;

/** Get all sessions with optional filtering and pagination */
export function getAllSessions(options?: GetAllSessionsOptions): SessionListResult;

/**
 * Find a session by short ID or filename.
 * Use matchBy to disambiguate an extensionless filename and another short ID.
 * @param sessionId - Short ID prefix, full filename, filename without .tmp, or legacy date alias
 * @param includeContent - Whether to read and parse the session content
 * @param options - Restrict the lookup type; invalid options return null
 */
export function getSessionById(sessionId: string, includeContent?: boolean, options?: GetSessionByIdOptions): Session | null;

/** Write markdown content to a session file */
export function writeSessionContent(sessionPath: string, content: string): boolean;

/** Append content to an existing session file */
export function appendSessionContent(sessionPath: string, content: string): boolean;

/** Delete a session file */
export function deleteSession(sessionPath: string): boolean;

/** Check if a session file exists and is a regular file */
export function sessionExists(sessionPath: string): boolean;
