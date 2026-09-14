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
  /** Wrong? on a quote. */
  | 'wrong'
  /** Wrong? on chips; logged as `neither` before ADR-022. */
  | 'wrongChip'
  | 'chipPick'
  | 'notInListStart'
  | 'notInListSaved'
  | 'notInListMismatch'
  | 'notInListFailed'
  | 'rejectClosed'
  /** P2-4, SR-07: a likely product or a search result picked on the reject sheet. */
  | 'correctStart'
  | 'correctSaved'
  | 'correctMismatch'
  | 'correctFailed'
  /** P2-4, SR-06: the editor opened, a change saved, or a save that changed nothing. */
  | 'priceEditOpen'
  | 'priceSaved'
  | 'priceUnchanged'
  /** P2-4, SR-08, SR-32. undoLapsed: the 10 s passed without Undo. restore: from the trash. */
  | 'delete'
  | 'undo'
  | 'undoLapsed'
  | 'restore'
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
