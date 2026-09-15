// Staging-only: diagnose + patch Omar's Customer record (email = null → correct value).
// Hard-blocked on non-staging. No persistent attack surface: narrow action, staging only.
// GET ?phase=diagnose  — show all customers, their email states, closet item counts
// GET ?phase=patch     — apply fix (null email → TARGET_EMAIL) and verify

import prisma from "~/db.server";

const TARGET_EMAIL = "nadine.abuobeid@hotmail.co.uk";

export async function loader({ request }: { request: Request }) {
  if (process.env.NAIA_PROJECT_VARIANT !== "staging") {
    return new Response("Not Found", { status: 404 });
  }

  const url = new URL(request.url);
  const phase = url.searchParams.get("phase") ?? "diagnose";

  // Always collect diagnosis data
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
      email: c.email,
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
    const before = nullEmailCustomers.length;
    if (before === 0) {
      return Response.json({
        phase: "patch",
        skipped: true,
        reason: "No customers with null email — nothing to change",
        diagnosis,
      });
    }

    const result = await prisma.customer.updateMany({
      where: { email: null },
      data: { email: TARGET_EMAIL },
    });

    // Verify: find the now-patched record(s)
    const afterPatch = await prisma.customer.findMany({
      where: { email: TARGET_EMAIL },
      select: {
        id: true,
        shopifyCustomerId: true,
        email: true,
        _count: { select: { closetItems: true } },
      },
    });

    // Confirm other customers are untouched
    const saraRecord = await prisma.customer.findFirst({
      where: { email: { not: null, not: TARGET_EMAIL } },
      select: { id: true, email: true },
    });

    return Response.json({
      phase: "patch",
      targetEmail: TARGET_EMAIL,
      recordsPatched: result.count,
      beforeNullCount: before,
      afterPatch,
      otherCustomersUntouched:
        otherCustomers.length === (saraRecord ? 1 : 0) ||
        otherCustomers.every((c) => c.email !== null),
      diagnosis,
    });
  }

  return Response.json(
    { error: "Unknown phase. Use ?phase=diagnose or ?phase=patch" },
    { status: 400 },
  );
}
