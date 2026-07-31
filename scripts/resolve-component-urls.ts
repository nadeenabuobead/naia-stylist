// scripts/resolve-component-urls.ts
// Phase 4A5 — Resolve CDN URLs for two component media GIDs that have resolvedUrl=null.
// Targets: double-top/chiffon-overlay and double-top/full-layered-top.
// Prints only CDN URLs to stdout. Never prints the access token or credentials.

import { PrismaClient } from "@prisma/client";

// These GIDs are already in the media map — we're resolving their CDN URLs only.
const TARGET_GIDS: Record<string, string> = {
  "double-top/chiffon-overlay":  "gid://shopify/MediaImage/52802485518468",
  "double-top/full-layered-top": "gid://shopify/MediaImage/51812553162884",
};

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL } },
    log: [],
  });

  try {
    const session = await prisma.session.findFirst({
      where: { isOnline: false },
      orderBy: [{ expires: "desc" }],
      select: { shop: true, expires: true, accessToken: true },
    });

    if (!session?.accessToken) {
      process.stderr.write("HOLD — no offline session token found\n");
      process.exit(1);
    }

    const now = new Date();
    const expired = session.expires ? session.expires < now : false;
    if (expired) {
      process.stderr.write(`HOLD — session expired at ${session.expires!.toISOString()}\n`);
      process.exit(1);
    }

    process.stderr.write(`Session valid. Shop: ${session.shop}\n`);

    const gidList = Object.values(TARGET_GIDS);

    const QUERY = `
      query resolveMediaNodes($ids: [ID!]!) {
        nodes(ids: $ids) {
          id
          ... on MediaImage {
            image {
              url
              width
              height
              altText
            }
          }
        }
      }
    `;

    const apiVersion = "2024-04";
    const endpoint = `https://${session.shop}/admin/api/${apiVersion}/graphql.json`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken,
      },
      body: JSON.stringify({ query: QUERY, variables: { ids: gidList } }),
    });

    process.stderr.write(`HTTP ${response.status} ${response.statusText}\n`);

    if (!response.ok) {
      process.stderr.write(`HOLD — HTTP ${response.status}\n`);
      process.exit(1);
    }

    type ImageNode = {
      id: string;
      image?: { url: string; width: number; height: number; altText: string | null };
    };
    const json = await response.json() as {
      data?: { nodes: Array<ImageNode | null> };
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) {
      process.stderr.write(`GraphQL errors: ${json.errors.map((e) => e.message).join("; ")}\n`);
      process.exit(1);
    }

    const nodes = json.data?.nodes ?? [];
    const results: Record<string, { url: string; width: number; height: number; altText: string | null } | null> = {};

    for (const [componentHandle, gid] of Object.entries(TARGET_GIDS)) {
      const node = nodes.find((n) => n?.id === gid);
      results[componentHandle] = node?.image ?? null;
    }

    process.stderr.write("\nResolved URLs:\n");
    for (const [handle, img] of Object.entries(results)) {
      if (img) {
        process.stderr.write(`  ${handle}: ${img.width}×${img.height}  alt="${img.altText ?? ""}"\n`);
        // CDN URL printed to stdout — not a credential
        process.stdout.write(`${handle}: ${img.url}\n`);
      } else {
        process.stderr.write(`  ${handle}: NOT FOUND\n`);
        process.stdout.write(`${handle}: NOT_FOUND\n`);
      }
    }

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
