export async function loader() {
  const shopUrl = "naia-9417.myshopify.com";
  const accessToken = process.env.SHOPIFY_API_SECRET;

  const response = await fetch(
    `https://${shopUrl}/admin/api/2024-01/products.json?limit=20`,
    {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    }
  );

  const data = await response.json();

  const products = (data.products || []).map((p) => ({
    id: p.id,
    title: p.title,
    type: p.product_type,
    handle: p.handle,
    image: p.images?.[0]?.src || "",
  }));

  return Response.json(
    { products },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}