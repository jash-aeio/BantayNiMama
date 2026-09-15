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
  /** P2-5, SR-10: the pinned grid opened or closed, and a tile tapped (on a grid lock or the pinned grid). */
  | 'gridOpen'
  | 'gridClose'
  | 'tilePick'
  | 'torchOn'
  | 'torchOff'
  /**
   * P2-6, SR-25: the enrollment panel opened from *+ Add product*, an Unknown card's *Add*, the
   * *n of 5* banner, or by the first-run flow itself. Gate B2 needs one from an Unknown card.
   */
  | 'addFromButton'
  | 'addFromUnknown'
  | 'addFromBanner'
  | 'addFromFirstRun'
  /**
   * SR-25's split, added after gate B2 attempt 2 missed 30 s with no way to tell where the time went:
   * a photo added to the draft, and the first keystroke in the form for this product.
   */
  | 'enrollPhoto'
  | 'enrollTyping'
  /** A product committed; productIds holds its new id. */
  | 'enrollSaved'
  /** The panel closed, by *Back to scanning*, *Finish later* or *Try scanning it*. */
  | 'enrollClosed'
  /** P2-6, SR-44: *Finish later* (the dismissal saved in app_meta), and *Try scanning it* after the first product. */
  | 'finishLater'
  | 'tryScanning'
  /** P2-6, SR-42: a language picked on the first-run screen. */
  | 'introLanguage'
  /** P2-6, SR-43: the intro opened at its camera step, because a previous process reached it and died. */
  | 'introResumedAtCamera'
  /**
   * P2-6, SR-43, gate B1: the OS prompt asked, and what came back. `cameraBlocked` is a status that
   * can no longer be asked for ("don't ask again", or restricted). `cameraOpenSettings` is the
   * recovery screen's button, and `cameraGranted` is logged when the grant is first seen, including
   * on return from system settings.
   */
  | 'cameraAsk'
  | 'cameraGranted'
  | 'cameraDenied'
  | 'cameraBlocked'
  | 'cameraOpenSettings';

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

/** P2-6: where an enrollment was opened from. */
export type AddSource = 'button' | 'unknown' | 'banner' | 'firstRun';

const ADD_SOURCES: Partial<Record<InteractionKind, AddSource>> = {
  addFromButton: 'button',
  addFromUnknown: 'unknown',
  addFromBanner: 'banner',
  addFromFirstRun: 'firstRun',
};

export interface EnrollmentTime {
  readonly productId: string;
  readonly startMs: number;
  readonly savedMs: number;
  readonly ms: number;
  /** Where the panel was opened, or `continued` for a product saved after another without closing it. */
  readonly source: AddSource | 'continued';
  /** Photos added during the episode, including any later removed or discarded. */
  readonly photos: number;
  /** Offsets from `startMs`, or null when none was logged. */
  readonly firstPhotoMs: number | null;
  readonly lastPhotoMs: number | null;
  readonly firstKeyMs: number | null;
}

/**
 * SR-25: time from *Add* to saved, per product, from the log, with where inside it the time went.
 *
 * - **An add opens an episode.** A second add while one is open keeps the earlier start: the panel
 *   was already open.
 * - **A save closes it with a time.** The panel stays open after a save, so the save also starts the
 *   next episode, timed from that moment.
 * - **Closing the panel ends an episode with no time.** An abandoned add is not an enrollment.
 * - **A save with no open episode is left out** rather than guessed, for example when the log was
 *   trimmed past its Add.
 * - **Photos and the first keystroke count only inside an open episode.** *Start over* keeps the
 *   episode, because the clock is still running on the same product.
 */
export function enrollmentTimes(log: readonly Interaction[]): EnrollmentTime[] {
  interface Episode {
    startMs: number;
    source: AddSource | 'continued';
    photos: number;
    firstPhotoAt: number | null;
    lastPhotoAt: number | null;
    firstKeyAt: number | null;
  }
  const begin = (startMs: number, source: AddSource | 'continued'): Episode => ({
    startMs,
    source,
    photos: 0,
    firstPhotoAt: null,
    lastPhotoAt: null,
    firstKeyAt: null,
  });

  const times: EnrollmentTime[] = [];
  let open: Episode | null = null;
  for (const entry of log) {
    const source = ADD_SOURCES[entry.kind];
    if (source !== undefined) {
      open ??= begin(entry.atMs, source);
    } else if (entry.kind === 'enrollPhoto') {
      if (open !== null) {
        open.photos += 1;
        open.firstPhotoAt ??= entry.atMs;
        open.lastPhotoAt = entry.atMs;
      }
    } else if (entry.kind === 'enrollTyping') {
      if (open !== null) open.firstKeyAt ??= entry.atMs;
    } else if (entry.kind === 'enrollSaved') {
      const productId = entry.productIds[0];
      if (open !== null && productId !== undefined) {
        const offset = (at: number | null) => (at === null ? null : at - open!.startMs);
        times.push({
          productId,
          startMs: open.startMs,
          savedMs: entry.atMs,
          ms: entry.atMs - open.startMs,
          source: open.source,
          photos: open.photos,
          firstPhotoMs: offset(open.firstPhotoAt),
          lastPhotoMs: offset(open.lastPhotoAt),
          firstKeyMs: offset(open.firstKeyAt),
        });
      }
      open = begin(entry.atMs, 'continued');
    } else if (entry.kind === 'enrollClosed') {
      open = null;
    }
  }
  return times;
}
