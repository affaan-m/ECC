/**
 * Database type definitions for Supabase.
 *
 * This is a minimal stub so imports resolve before `supabase gen types`
 * produces the full schema. Run `pnpm db:types` to regenerate.
 */
export type Database = {
  public: {
    Tables: Record<string, unknown>
    Views: Record<string, unknown>
    Functions: Record<string, unknown>
    Enums: Record<string, unknown>
  }
}

/** Convenience alias for a typed Supabase client */
export type TypedSupabaseClient = import('@supabase/supabase-js').SupabaseClient<Database>
