import jwt from "jsonwebtoken";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getToken() {
  return jwt.sign(
    { iss: process.env.AIUTA_CLIENT_ID },
    process.env.AIUTA_CLIENT_SECRET,
    { algorithm: "HS256", expiresIn: "1h" }
  );
}

export async function action({ request }) {
  try {
    const formData = await request.formData();
    const intent = formData.get("intent");
    const token = getToken();

    // ✅ UPLOAD IMAGE
    if (intent === "upload") {
      const file = formData.get("image");

      const aiutaForm = new FormData();
      aiutaForm.append("image_data", file);

      const response = await fetch(
        "https://api.aiuta.com/digital-try-on/v1/uploaded_images",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: aiutaForm,
        }
      );

      return new Response(await response.text(), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 🔥 CREATE SKU (THIS IS THE FIX)
    if (intent === "create_sku") {
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
            image_url:
              "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/3b14fe8b-2c19-492e-82b1-44baaf3a3cc9.png",
          }),
        }
      );

      return new Response(await response.text(), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ✅ GENERATE TRY-ON
    if (intent === "generate") {
      const uploadedImageId = formData.get("uploaded_image_id");
      const skuId = formData.get("sku_id");

      const response = await fetch(
        "https://api.aiuta.com/digital-try-on/v1/sku_images_operations",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            uploaded_image_id: uploadedImageId,
            sku_id: skuId,
          }),
        }
      );

      return new Response(await response.text(), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ✅ STATUS
    if (intent === "status") {
      const operationId = formData.get("operation_id");

      const response = await fetch(
        `https://api.aiuta.com/digital-try-on/v1/sku_images_operations/${operationId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      return new Response(await response.text(), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    return jsonResponse({ error: "Unknown intent" }, 400);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}