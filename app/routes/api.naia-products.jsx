export async function loader() {
  const products = [
    { id: 7822708867114, title: "Sculptural Hybrid Coat", handle: "trench-coat", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/b7af3725-7048-4ead-8d04-d6fb42556eac.png" },
    { id: 7822708310058, title: "Art Blouse", handle: "silk-top", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/32674461-cac7-4699-aff1-74c435289333.png" },
    { id: 7822708113450, title: "Art Panel Tailored Blazer", handle: "blazer", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/a7b908bb-3079-4f39-93b8-e1a89435249a.png" },
    { id: 7822708047914, title: "Textured Art Midi Skirt", handle: "skirt", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/6992350d-5695-4f28-8674-7747dfd1e680.png" },
    { id: 7822707949610, title: "Wrap Cropped Top", handle: "top", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/3614927b-4685-4df3-aeff-b3d5a950cbd2.png" },
    { id: 7822707589162, title: "Printed Wrap Kimono Dress", handle: "kimono", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/77d61b97-37da-4e57-8297-aa5207b35d07.png" },
    { id: 7822707392554, title: "Art Collar Layered Shirt", handle: "shirt-1", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/32fe2afb-b8ef-46d2-ae2c-b1adc81a1b0f.png" },
    { id: 7822707130410, title: "Leather Midi Dress", handle: "shirt", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/8a855f15-e5e9-4ef5-a7db-a7253e83a542.png" },
    { id: 7822706475050, title: "Asymmetrical Waist Pants", handle: "pants", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/7d5d1e05-796a-45d9-b74a-4ddb0c9da3cf.png" },
    { id: 7822706016298, title: "Printed Straight Pants", handle: "trousers", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/3b14fe8b-2c19-492e-82b1-44baaf3a3cc9.png" },
  ].map(p => ({
    ...p,
    url: `https://naia-9417.myshopify.com/products/${p.handle}`
  }));

  return Response.json(
    { products },
    { headers: { "Access-Control-Allow-Origin": "*" } }
  );
}