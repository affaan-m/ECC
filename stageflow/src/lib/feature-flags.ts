/**
 * Feature flags for phased rollout.
 *
 * All flags default to `false` unless the corresponding environment variable
 * is set to the string "true". Use `NEXT_PUBLIC_` prefix so flags are
 * available in both server and client components.
 *
 * Phase 1 features (core) are always enabled.
 */
export const FLAGS = {
  /** Phase 2: Running order / scheduling module */
  PHASE_2_RUNNING_ORDER: process.env.NEXT_PUBLIC_FLAG_RUNNING_ORDER === 'true',

  /** Phase 3: Judging and scoring module */
  PHASE_3_JUDGING: process.env.NEXT_PUBLIC_FLAG_JUDGING === 'true',

  /** Phase 3: Ticketing and box-office module */
  PHASE_3_TICKETING: process.env.NEXT_PUBLIC_FLAG_TICKETING === 'true',

  /** Phase 3: Livestream integration module */
  PHASE_3_LIVESTREAM: process.env.NEXT_PUBLIC_FLAG_LIVESTREAM === 'true',

  /** Phase 3: Media sales / photo-video marketplace */
  PHASE_3_MEDIA_SALES: process.env.NEXT_PUBLIC_FLAG_MEDIA_SALES === 'true',
} as const

export type FeatureFlag = keyof typeof FLAGS

/**
 * Check if a specific feature flag is enabled.
 */
export function isEnabled(flag: FeatureFlag): boolean {
  return FLAGS[flag]
}
