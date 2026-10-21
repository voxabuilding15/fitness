export interface Migration {
  version: number;
  name: string;
  /** Plain SQL, executed inside the single upgrade transaction. Schema only; never seed data. */
  sql: string;
  /**
   * Set ONLY for a migration that intentionally deletes existing rows. Without it the runner rolls the whole upgrade back
   * if any existing table ends up with fewer rows than before (this also catches silent foreign-key cascades).
   */
  allowRowLoss?: boolean;
}
