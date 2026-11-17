// app/routes/admin.migration-status.tsx
//
// 2026-11-17 — read-only migration-status diagnostic.
//
// Vercel's "Sensitive" env-var protection blocks even the project owner
// from pulling DATABASE_URL/NAIA_DATABASE_URL locally via the CLI, so the
// only way to genuinely verify what's applied against the real staging
// database (rather than inferring it from a build log or an env-var's
// absence) is a query that runs where the credential already lives: inside
// a deployed request.
//
// GET only, no action — this route can never write anything. The one query
// it runs is a SELECT against Prisma's own `_prisma_migrations` bookkeeping
// table, which Prisma itself creates and maintains; nothing here touches
// application data or runs `migrate deploy`.
//
// URL: /admin/migration-status?name=<migration_directory_name>
export async function loader({ request }: import("react-router").LoaderFunctionArgs) {
  const { requireAdminSession } = await import("~/lib/internal-auth.server");
  const session = await requireAdminSession(request);
  if (session.identity.role !== "owner") {
    throw new Response("Forbidden", { status: 403 });
  }

  const { default: prisma } = await import("~/db.server");
  const url = new URL(request.url);
  const name = url.searchParams.get("name") ?? "20261117000000_withdrawal_request";

  const rows = await prisma.$queryRaw<
    { migration_name: string; finished_at: Date | null; applied_steps_count: number }[]
  >`SELECT migration_name, finished_at, applied_steps_count
    FROM "_prisma_migrations"
    WHERE migration_name = ${name}`;

  const recent = await prisma.$queryRaw<
    { migration_name: string; finished_at: Date | null }[]
  >`SELECT migration_name, finished_at
    FROM "_prisma_migrations"
    ORDER BY started_at DESC
    LIMIT 10`;

  return Response.json({
    checked: name,
    applied: rows.length > 0 && rows[0].finished_at != null,
    detail: rows[0] ?? null,
    mostRecentMigrations: recent,
  });
}
