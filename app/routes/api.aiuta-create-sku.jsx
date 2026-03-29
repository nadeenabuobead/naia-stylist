import jwt from "jsonwebtoken";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function getToken() {
  return jwt.sign(
    {
      iss: process.env.AIUTA_CLIENT_ID,
    },
    process.env.AIUTA_CLIENT_SECRET,
    {
      algorithm: "HS256",
      expiresIn: "1h",
    }
  );
}

export async function loader() {
  try {
    const token = getToken();

    const response = await fetch(
      "https://api.aiuta.com/digital-try-on/v1/sku_images",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sku_id: "print_pants_001",
          sku_catalog_name: "main",
          image_url:
            "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/3b14fe8b-2c19-492e-82b1-44baaf3a3cc9.png",
        }),
      }
    );

    const text = await response.text();

    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {}

    return jsonResponse(
      {
        ok: response.ok,
        status: response.status,
        parsed,
        raw: text,
      },
      response.status
    );
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error?.message || "Create SKU failed.",
      },
      500
    );
  }
}