// scripts/query-all-shopify-media.ts
// Phase 4A3 — Re-query ALL Shopify media for all 11 NADINE products.
// Fetches every MediaImage per product (up to 20), including component photos.
// Outputs JSON to stdout for piping into the contact sheet generator.
// SECURITY: Never prints accessToken or any credential value.

import { PrismaClient } from "@prisma/client";

const NADINE_TITLES: Record<string, string> = {
  "double-top":           "Becoming Alive",
  "collar-shirt":         "Becoming Real",
  "cropped-top":          "Becoming Fragmented",
  "asymmetrical-pants":   "Becoming Grounded",
  "straight-pants":       "Becoming Unfiltered",
  "suede-skirt":          "Becoming Rooted",
  "trench-coat":          "Becoming Seen",
  "kimono-jacket":        "Becoming Whole",
  "leather-suede-jacket": "Becoming Clear",
  "midi-dress":           "Becoming Her",
  "dress-set":            "Becoming Defined",
};

const V8_HANDLES = Object.keys(NADINE_TITLES);

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL } },
    log: [],
  });

  try {
    const sessionWithToken = await prisma.session.findFirst({
      where: { isOnline: false },
      orderBy: [{ expires: "desc" }],
      select: { shop: true, expires: true, accessToken: true },
    });

    if (!sessionWithToken?.accessToken) {
      process.stderr.write("HOLD — no offline session token found\n");
      process.exit(1);
    }

    const now = new Date();
    const expired = sessionWithToken.expires ? sessionWithToken.expires < now : false;
    if (expired) {
      process.stderr.write(`HOLD — session expired at ${sessionWithToken.expires!.toISOString()}\n`);
      process.exit(1);
    }

    process.stderr.write(`Session VALID. Shop: ${sessionWithToken.shop}\n`);
    process.stderr.write(`Querying all media...\n`);

    // Query ALL media per product — up to 20 images each
    const QUERY = `{
      products(first: 50) {
        edges {
          node {
            id
            title
            handle
            status
            media(first: 20) {
              edges {
                node {
                  id
                  mediaContentType
                  status
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
            }
          }
        }
      }
    }`;

    const apiVersion = "2024-04";
    const endpoint = `https://${sessionWithToken.shop}/admin/api/${apiVersion}/graphql.json`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": sessionWithToken.accessToken,
      },
      body: JSON.stringify({ query: QUERY }),
    });

    process.stderr.write(`HTTP ${response.status} ${response.statusText}\n`);

    if (!response.ok) {
      process.stderr.write(`HOLD — HTTP ${response.status}\n`);
      process.exit(1);
    }

    type MediaNode = {
      id: string;
      mediaContentType: string;
      status: string;
      image?: { url: string; width: number; height: number; altText: string | null };
    };
    type ProductNode = {
      id: string;
      title: string;
      handle: string;
      status: string;
      media: { edges: Array<{ node: MediaNode }> };
    };
    const json = await response.json() as {
      data?: { products?: { edges: Array<{ node: ProductNode }> } };
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) {
      process.stderr.write(`GraphQL errors: ${json.errors.map(e => e.message).join("; ")}\n`);
      process.exit(1);
    }

    const shopifyProducts = json.data?.products?.edges ?? [];
    const nadineTitlesLower = Object.values(NADINE_TITLES).map(t => t.toLowerCase());

    // Match each V8 handle to its Shopify product by title
    const results = V8_HANDLES.map(v8Handle => {
      const nadineTitle = NADINE_TITLES[v8Handle];
      const match = shopifyProducts.find(
        ({ node }) => node.title.trim().toLowerCase() === nadineTitle.toLowerCase()
      );
      if (!match) {
        return { v8Handle, nadineTitle, matched: false, product: null, images: [] };
      }
      const p = match.node;
      const images = p.media.edges
        .filter(m => m.node.mediaContentType === "IMAGE" && m.node.image?.url)
        .map(m => ({
          mediaGid: m.node.id,
          status: m.node.status,
          url: m.node.image!.url,
          width: m.node.image!.width,
          height: m.node.image!.height,
          altText: m.node.image!.altText ?? null,
        }));
      return {
        v8Handle,
        nadineTitle,
        matched: true,
        product: {
          gid: p.id,
          title: p.title,
          handle: p.handle,
          status: p.status,
        },
        images,
      };
    });

    // Also list any Shopify products not matched to V8
    const unmatchedShopify = shopifyProducts
      .filter(({ node }) => !nadineTitlesLower.includes(node.title.trim().toLowerCase()))
      .map(({ node }) => ({ title: node.title, handle: node.handle, gid: node.id }));

    // Summary to stderr
    process.stderr.write(`\nResults:\n`);
    for (const r of results) {
      const imgCount = r.images.length;
      process.stderr.write(`  ${r.v8Handle.padEnd(24)} ${r.matched ? "MATCHED" : "UNMATCHED"} — ${imgCount} image(s)\n`);
      for (const img of r.images) {
        process.stderr.write(`    [${img.altText ?? "(no alt)"}] ${img.width}×${img.height} ${img.mediaGid}\n`);
      }
    }
    if (unmatchedShopify.length) {
      process.stderr.write(`\nUnmatched Shopify products: ${unmatchedShopify.map(u => u.title).join(", ")}\n`);
    }

    // Output full JSON to stdout for the HTML generator
    process.stdout.write(JSON.stringify({ results, unmatchedShopify }, null, 2));

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
