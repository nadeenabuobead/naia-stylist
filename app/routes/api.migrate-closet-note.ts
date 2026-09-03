// app/routes/api.migrate-closet-note.ts
// ONE-TIME migration endpoint for 20260904000000_closet_customer_note.
// Applies: ALTER TABLE "ClosetItem" ADD COLUMN IF NOT EXISTS "customerNote" TEXT
//
// Protected by STAGING_FIX_SECRET via x-fix-secret header.
// Safe to call more than once (IF NOT EXISTS).
// REMOVE THIS FILE after confirming customerNote column on staging.

import { data, type ActionFunctionArgs } from "react-router";
import prisma from "~/db.server";

export async function loader() {
  return data({ error: "Method not allowed" }, { status: 405 });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  const fixSecret = request.headers.get("x-fix-secret");
  if (!process.env.STAGING_FIX_SECRET || fixSecret !== process.env.STAGING_FIX_SECRET) {
    return data({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await prisma.$executeRaw`ALTER TABLE "ClosetItem" ADD COLUMN IF NOT EXISTS "customerNote" TEXT`;

    const cols = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'ClosetItem' AND column_name = 'customerNote'
    `;

    return data({ ok: true, applied: true, column: cols[0] ?? null });
  } catch (err) {
    return data({ ok: false, error: String(err) }, { status: 500 });
  }
}
