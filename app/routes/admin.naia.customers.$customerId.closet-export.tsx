// app/routes/admin.naia.customers.$customerId.closet-export.tsx
//
// Read-only Closet export for ONE customer, as JSON.
//
// Why it exists: re-reviewing occasionFit.active across a whole Closet needs the stored
// values in one place. StyleMe's [nAia-*] diagnostics cannot supply them — they explain a
// single engine run, log intentionPotentials filtered to that run's own intention, and
// carry no customer identifier at all. Reading ~45 admin garment pages per Closet is the
// alternative. So this exports exactly what is stored, for the customer being viewed.
//
// Auth:    requireAdminSession in the loader. The parent admin.tsx also requires it — belt
//          and braces, matching admin.naia.phase3c-export.tsx.
// Safety:  GET only. No action export, so a POST cannot reach it. Zero writes, zero engine
//          or session dependency, no diagnostics involvement.
// Scope:   the :customerId in the path and nothing else. Items are fetched with
//          `where: { customerId }`, so one customer's export can never contain another's.
// Fidelity: occasionFit and intentionPotentials are returned WHOLE. No key filtering, no
//          renaming, no inference, no deduplication — two garments sharing a display name
//          stay two objects, distinguished by itemId.
//
// URL: /admin/naia/customers/:customerId/closet-export        → JSON download

import type { LoaderFunctionArgs } from "react-router";
import { requireAdminSession } from "~/lib/internal-auth.server";
import prisma from "../db.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdminSession(request);

  const customerId = params.customerId;
  if (!customerId) {
    return new Response("Missing customerId", { status: 400 });
  }

  // Customer metadata first, so the file proves whose Closet it is. A 404 here also means
  // a bad id can never silently produce an empty-but-plausible export.
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, shopifyCustomerId: true, email: true, firstName: true, lastName: true },
  });
  if (!customer) {
    return new Response("Customer not found", { status: 404 });
  }

  const items = await prisma.closetItem.findMany({
    where: { customerId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      category: true,
      subcategory: true,
      occasions: true,
      createdAt: true,
      styleMeProfile: {
        select: { profileStatus: true, dressRegister: true, occasionFit: true, intentionPotentials: true },
      },
    },
  });

  const payload = {
    exportedAt: new Date().toISOString(),
    customer: {
      customerId: customer.id,
      shopifyCustomerId: customer.shopifyCustomerId ?? null,
      email: customer.email ?? null,
      firstName: customer.firstName ?? null,
      lastName: customer.lastName ?? null,
    },
    itemCount: items.length,
    items: items.map((i: (typeof items)[number]) => ({
      customerId: customer.id,
      shopifyCustomerId: customer.shopifyCustomerId ?? null,
      itemId: i.id,
      itemName: i.name ?? null,
      category: i.category,
      subcategory: i.subcategory ?? null,
      occasions: i.occasions,
      // Stored exactly as held. profileStatus is included because occasionFit and
      // intentionPotentials are only authoritative for StyleMe when the profile is
      // approved — without it an unapproved draft reads as live truth.
      profileStatus: i.styleMeProfile?.profileStatus ?? null,
      dressRegister: i.styleMeProfile?.dressRegister ?? null,
      occasionFit: i.styleMeProfile?.occasionFit ?? null,
      intentionPotentials: i.styleMeProfile?.intentionPotentials ?? null,
      createdAt: i.createdAt.toISOString(),
    })),
  };

  const slug = (customer.firstName ?? customer.id).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="closet-export-${slug}-${customer.id}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
