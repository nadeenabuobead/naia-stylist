export async function loader() {
  const response = await fetch(
    "https://naia-9417.myshopify.com/products.json?limit=20"
  );
  const data = await response.json();

  const products = (data.products || []).map((p) => ({
    id: p.id,
    title: p.title,
    handle: p.handle,
    image: p.images?.[0]?.src || "",
    url: `https://naia-9417.myshopify.com/products/${p.handle}`,
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