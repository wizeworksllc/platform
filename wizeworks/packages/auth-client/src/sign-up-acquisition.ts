import type { AttributionSnapshot } from '@wizeworksllc/attribution';

/** Where a new account came from, recorded once at sign-up. */
export interface SignUpAcquisition {
  /** Denormalized from first-touch — the acquisition model for L-PLAT (docs/80 §9). */
  channel: string | null;
  source: string | null;
  campaign: string | null;
  /** Full snapshots retained for later model recompute (docs/80 §8.3). */
  firstTouch: AttributionSnapshot | null;
  lastTouch: AttributionSnapshot | null;
}
