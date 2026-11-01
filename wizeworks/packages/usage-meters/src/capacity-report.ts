import type { MeterReading } from './allowance';

/** A tenant's standing against every meter. */
export interface CapacityReport {
  meters: MeterReading[];
  /**
   * When the stocks and the flow were measured, or `null` if this tenant has
   * never been snapshotted.
   *
   * Null is NOT "zero" and NOT "today". A surface must say "not measured yet"
   * rather than draw an empty bar — a tenant provisioned this afternoon has no
   * row, and four bars at zero would tell them they have used nothing when the
   * truth is that nobody has looked.
   */
  measuredAt: Date | null;
  /** Whether this brand publishes ceilings at all. `none` → every meter reads
   *  `unmetered`, which is a deliberate state and not a failure. */
  allowanceSource: 'configured' | 'none';
  /** Meter names in the brand's capacity config that could not be read. Non-empty
   *  means somebody's configuration is wrong — surface it, do not swallow it. */
  rejected: string[];
}
