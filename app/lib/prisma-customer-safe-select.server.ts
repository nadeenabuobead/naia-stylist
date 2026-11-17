// app/lib/prisma-customer-safe-select.server.ts
//
// STOPGAP, not a permanent pattern — delete this file and every import of
// it once the migration adding Customer.termsAcceptedAt/termsAcceptedVersion
// (feat(legal): Terms-acceptance mechanism + checkout consent checkboxes
// (W1), schema change in 45cb0e4/5502204) is confirmed applied to every
// database this code actually runs against.
//
// Root cause, confirmed via this Preview's own runtime logs (not guessed):
// every ordinary, unscoped prisma.customer.{findUnique,create,update}()
// call implicitly selects every column the GENERATED Prisma client knows
// about — including these two brand-new ones — regardless of whether the
// caller ever reads them. When the actual database hasn't had the
// corresponding migration applied yet, the column genuinely doesn't exist
// in the table, and Prisma throws PrismaClientKnownRequestError ("The
// column `Customer.termsAcceptedAt` does not exist in the current
// database") at the DATABASE level, before the query result ever reaches
// application code — this broke the Clerk sign-in callback (and would
// break every other ordinary Customer lookup) on this Preview, for EVERY
// customer, not something specific to one identity or one route.
//
// This omits exactly the two known-affected columns from the call sites
// in the live, already-authenticated-request path (identity-linking.server.ts,
// clerk-session.server.ts) — it does not attempt a codebase-wide sweep,
// since the actual fix is applying the pending migration, not permanently
// avoiding these two columns everywhere. Omitting (not an explicit
// column-by-column select) means every OTHER existing field keeps flowing
// through unchanged, and the Customer model's own normal fields are never
// re-typed out of sync here.
export const CUSTOMER_PENDING_MIGRATION_OMIT = {
  termsAcceptedAt: true,
  termsAcceptedVersion: true,
} as const;
