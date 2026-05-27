#!/usr/bin/env tsx
/**
 * Generates TypeScript types from the local Supabase schema.
 * Usage: pnpm db:types
 */
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const OUTPUT_PATH = resolve(import.meta.dirname, '../src/lib/supabase/types.ts')

try {
  console.log('Generating TypeScript types from Supabase schema...')

  const types = execSync(
    'pnpm supabase gen types typescript --local --schema public',
    { encoding: 'utf-8', cwd: resolve(import.meta.dirname, '..') },
  )

  writeFileSync(OUTPUT_PATH, types)
  console.log(`Types written to ${OUTPUT_PATH}`)
} catch (error) {
  console.error('Failed to generate types:', error)
  console.error('Make sure Supabase is running: pnpm supabase start')
  process.exit(1)
}
