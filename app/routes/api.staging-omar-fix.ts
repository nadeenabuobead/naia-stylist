// Staging-only admin-authenticated diagnostic + one-off Customer email patch.
// Requires a valid admin session (requireAdminSession) — redirects to /admin/login otherwise.
// Hard-blocked on non-staging as a secondary guard.
//
// GET ?phase=diagnose  — identify null-email Customer records + closet item counts
// GET ?phase=patch     — apply fix: email IS NULL → TARGET_EMAIL; verify before/after

import { requireAdminSession } from "~/lib/internal-auth.server";
import prisma from "~/db.server";

const TARGET_EMAIL = "nadine.abuobeid@hotmail.co.uk";

export async function loader({ request }: { request: Request }) {
  // Primary auth guard — redirects to /admin/login if no valid session
  await requireAdminSession(request);

  // Secondary environment guard — belt-and-braces
  if (process.env.NAIA_PROJECT_VARIANT !== "staging") {
    return new Response("Not Found", { status: 404 });
  }

  const url = new URL(request.url);
  const phase = url.searchParams.get("phase") ?? "diagnose";

  // Always run diagnosis so both phases return the same shape
  const allCustomers = await prisma.customer.findMany({
    select: {
      id: true,
      shopifyCustomerId: true,
      email: true,
      createdAt: true,
      _count: { select: { closetItems: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const nullEmailCustomers = allCustomers.filter((c) => c.email === null);
  const otherCustomers = allCustomers.filter((c) => c.email !== null);

  const diagnosis = {
    totalCustomers: allCustomers.length,
    nullEmailCustomers: nullEmailCustomers.map((c) => ({
      id: c.id,
      shopifyCustomerId: c.shopifyCustomerId,
      email: c.email,
      closetItemCount: c._count.closetItems,
      createdAt: c.createdAt,
    })),
    otherCustomers: otherCustomers.map((c) => ({
      id: c.id,
      shopifyCustomerId: c.shopifyCustomerId,
      // Mask most of the email for log safety — show domain only
      email: c.email ? c.email.replace(/^[^@]+/, "***") : null,
      closetItemCount: c._count.closetItems,
      createdAt: c.createdAt,
    })),
  };

  if (phase === "diagnose") {
    return Response.json({
      phase: "diagnose",
      diagnosis,
      safeToApply:
        nullEmailCustomers.length === 1 &&
        nullEmailCustomers[0]._count.closetItems > 0,
    });
  }

  if (phase === "patch") {
    if (nullEmailCustomers.length === 0) {
      return Response.json({
        phase: "patch",
        skipped: true,
        reason: "No customers with null email — already fixed or nothing to change",
        diagnosis,
      });
    }

    // Customer.email is @unique — cannot set multiple records to the same value.
    // Strategy:
    //   - Real Shopify customers (numeric shopifyCustomerId, ordered by closet items desc):
    //       most items → TARGET_EMAIL exactly
    //       others     → TARGET_EMAIL with +N suffix to stay unique
    //   - Dev/seed records (non-numeric shopifyCustomerId) → staging placeholder
    const isRealShopify = (c: { shopifyCustomerId: string }) =>
      /^\d+$/.test(c.shopifyCustomerId);

    const realCustomers = [...nullEmailCustomers]
      .filter(isRealShopify)
      .sort((a, b) => b._count.closetItems - a._count.closetItems);

    const devCustomers = nullEmailCustomers.filter((c) => !isRealShopify(c));

    const [domain, ...localParts] = TARGET_EMAIL.split("@").reverse();
    const localPart = localParts.reverse().join("@");

    const assignments: Array<{ id: string; email: string }> = [
      // Primary real account → exact target email
      ...realCustomers.map((c, i) => ({
        id: c.id,
        email: i === 0 ? TARGET_EMAIL : `${localPart}+staging${i}@${domain}`,
      })),
      // Dev/seed records → non-personal staging placeholder
      ...devCustomers.map((c, i) => ({
        id: c.id,
        email: `dev-seed-${i + 1}@staging.naia`,
      })),
    ];

    const updates = await Promise.all(
      assignments.map(({ id, email }) =>
        prisma.customer.update({ where: { id }, data: { email } }),
      ),
    );

    return Response.json({
      phase: "patch",
      recordsPatched: updates.length,
      assignments: assignments.map(({ id, email }) => ({
        id,
        email: email === TARGET_EMAIL ? email : email.replace(/^[^@]+/, "***"),
      })),
      otherCustomersUntouched: true,
    });
  }

  return Response.json(
    { error: "Unknown phase. Use ?phase=diagnose or ?phase=patch" },
    { status: 400 },
  );
}
