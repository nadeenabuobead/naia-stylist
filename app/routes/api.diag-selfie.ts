// TEMPORARY DIAGNOSTIC ENDPOINT — DELETE AFTER USE
// Returns current selfie/model DB state + Cloudinary asset existence for diagnosis.
// Blocked in production; requires STAGING_SEED_SECRET query param.

import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { verifyCloudinaryAsset } from "../lib/cloudinary-admin.server";

export async function loader({ request }: LoaderFunctionArgs) {
  if (process.env.VERCEL_ENV === "production") {
    return new Response("Not Found", { status: 404 });
  }

  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  if (!process.env.STAGING_SEED_SECRET || secret !== process.env.STAGING_SEED_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  const shop = url.searchParams.get("shop") ?? "naia-test-store.myshopify.com";

  const customers = await prisma.customer.findMany({
    where: { shop },
    select: {
      id: true,
      shopifyCustomerId: true,
      selfieAnalysis: {
        select: {
          photoPublicId: true,
          photoFormat: true,
          photoDeletedAt: true,
          analysisStatus: true,
          updatedAt: true,
        },
      },
      naiaModel: {
        select: {
          facePublicId: true,
          faceFormat: true,
          deliveryType: true,
          updatedAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const results = await Promise.all(
    customers.map(async (c) => {
      const sa = c.selfieAnalysis;
      const nm = c.naiaModel;

      const saPublicId = sa?.photoPublicId ?? null;
      const nmPublicId = nm?.facePublicId ?? null;
      const nmDeliveryType = nm?.deliveryType ?? "private";

      const [saCheck, nmCheck] = await Promise.all([
        saPublicId ? verifyCloudinaryAsset(saPublicId, "private") : Promise.resolve(null),
        nmPublicId ? verifyCloudinaryAsset(nmPublicId, nmDeliveryType) : Promise.resolve(null),
      ]);

      const selfieExists = saPublicId !== null && saCheck?.ok === true;
      const faceExists   = nmPublicId !== null && nmCheck?.ok === true;
      const sharedId     = saPublicId !== null && nmPublicId !== null && saPublicId === nmPublicId;

      return {
        customerId: c.id,
        shopifyCustomerId: c.shopifyCustomerId,
        selfieAnalysis: sa
          ? {
              photoPublicId:  saPublicId,
              photoFormat:    sa.photoFormat,
              photoDeletedAt: sa.photoDeletedAt?.toISOString() ?? null,
              analysisStatus: sa.analysisStatus,
              updatedAt:      sa.updatedAt.toISOString(),
              cloudinaryExists: saPublicId ? selfieExists : null,
              cloudinaryError:  saPublicId && !saCheck?.ok ? (saCheck as { errorCode?: string })?.errorCode : null,
            }
          : null,
        naiaModel: nm
          ? {
              facePublicId:    nmPublicId,
              faceFormat:      nm.faceFormat,
              deliveryType:    nmDeliveryType,
              updatedAt:       nm.updatedAt.toISOString(),
              cloudinaryExists: nmPublicId ? faceExists : null,
              cloudinaryError:  nmPublicId && !nmCheck?.ok ? (nmCheck as { errorCode?: string })?.errorCode : null,
            }
          : null,
        flags: {
          sharedPublicId:        sharedId,
          selfiePhotoBroken:     saPublicId !== null && !selfieExists,
          naiaModelPhotoBroken:  nmPublicId !== null && !faceExists,
          danglingNaiaReference: nmPublicId !== null && !faceExists && saPublicId === null,
          doubleOwnership:       sharedId,
        },
      };
    }),
  );

  return new Response(JSON.stringify({ ok: true, shop, customers: results }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
