// The interaction log — PHASE_2_PLAN.md §4 gate evidence. Pure.
//
// Every tap the gate is judged on, with a time. Held in memory for the session and never persisted:
// it is a measurement aid for the gate run, not behaviour kept on the phone (§7, TR-52's spirit).
// Release builds do not log to logcat, so it is read from the gate panel.

/** Enough for a whole gate run; the oldest entries are dropped beyond it. */
export const INTERACTION_LOG_LIMIT = 2000;

export type InteractionKind =
  | 'confirmYes'
  | 'confirmNo'
  | 'wrong'
  | 'neither'
  | 'chipPick'
  | 'notInListStart'
  | 'notInListSaved'
  | 'notInListMismatch'
  | 'notInListFailed'
  | 'rejectClosed'
  | 'torchOn'
  | 'torchOff';

export interface Interaction {
  readonly atMs: number;
  readonly kind: InteractionKind;
  /** The products the tap was about, as the card showed them. Empty for the torch. */
  readonly productIds: readonly string[];
}

export function appendInteraction(
  log: readonly Interaction[],
  interaction: Interaction,
  limit: number = INTERACTION_LOG_LIMIT,
): Interaction[] {
  return [...log.slice(-(limit - 1)), interaction];
}

/** How many of each kind, in first-seen order. */
export function countInteractions(log: readonly Interaction[]): [InteractionKind, number][] {
  const counts = new Map<InteractionKind, number>();
  for (const { kind } of log) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return [...counts];
}
