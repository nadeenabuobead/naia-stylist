import { getAllCatalogProducts } from "../lib/ai/naia-catalog";

export async function loader() {
  const products = getAllCatalogProducts().map(p => ({
    handle: p.handle,
    title: p.parsed.identity.verifiedTitle,
    category: p.parsed.identity.itemType,
    url: p.parsed.identity.liveUrl ?? `https://naiabynadine.com/products/${p.handle}`,
    image: p.parsed.identity.featuredImageUrl ?? null,
  }));

  return Response.json(
    { products },
    { headers: { "Access-Control-Allow-Origin": "*" } }
  );
}
