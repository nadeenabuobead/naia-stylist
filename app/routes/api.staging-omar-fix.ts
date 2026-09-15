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

    const result = await prisma.customer.updateMany({
      where: { email: null },
      data: { email: TARGET_EMAIL },
    });

    // Verify the patch
    const afterPatch = await prisma.customer.findMany({
      where: { email: TARGET_EMAIL },
      select: {
        id: true,
        shopifyCustomerId: true,
        email: true,
        _count: { select: { closetItems: true } },
      },
    });

    // Confirm non-null-email customers are untouched (count must not change)
    const otherCustomersAfter = await prisma.customer.count({
      where: { email: { not: null, not: TARGET_EMAIL } },
    });

    return Response.json({
      phase: "patch",
      targetEmail: TARGET_EMAIL,
      recordsPatched: result.count,
      beforeNullCount: nullEmailCustomers.length,
      afterPatch,
      otherCustomersUntouched: otherCustomersAfter === otherCustomers.length,
      otherCustomerCountBefore: otherCustomers.length,
      otherCustomerCountAfter: otherCustomersAfter,
      diagnosis,
    });
  }

  return Response.json(
    { error: "Unknown phase. Use ?phase=diagnose or ?phase=patch" },
    { status: 400 },
  );
}
