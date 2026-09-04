const FASHN_API_KEY = process.env.FASHN_API_KEY;
const FASHN_BASE = "https://api.fashn.ai/v1";

export async function action({ request }) {
  try {
    const { customerId, modelImage, garmentImage, garmentImage2, garmentImage3 } = await request.json();

    if (!customerId || !modelImage || !garmentImage) {
      return Response.json({ error: "customerId, modelImage and garmentImage required" }, { status: 400 });
    }

    // Combine garment images vertically using canvas if multiple
    let productImage = garmentImage;

    if (garmentImage2 || garmentImage3) {
      const { createCanvas, loadImage } = await import("canvas");
      const garments = [garmentImage, garmentImage2, garmentImage3].filter(Boolean);
      
      const loadedImages = await Promise.all(
        garments.map(async (g) => {
          if (g.startsWith("data:")) {
            const base64Data = g.split(",")[1];
            const buffer = Buffer.from(base64Data, "base64");
            return loadImage(buffer);
          }
          return loadImage(g);
        })
      );

      const width = Math.max(...loadedImages.map(img => img.width));
      const totalHeight = loadedImages.reduce((sum, img) => sum + img.height, 0);
      const canvas = createCanvas(width, totalHeight);
      const ctx = canvas.getContext("2d");
      let y = 0;
      for (const img of loadedImages) {
        ctx.drawImage(img, 0, y, width, img.height);
        y += img.height;
      }
      productImage = canvas.toDataURL("image/jpeg", 0.9);
    }

    // Upload model image to Cloudinary if base64
    let finalModelImage = modelImage;
    if (modelImage.startsWith("data:")) {
      const base64Data = modelImage.split(",")[1];
      const mimeType = modelImage.split(";")[0].split(":")[1] || "image/jpeg";
      const blob = Buffer.from(base64Data, "base64");
      const formData = new FormData();
      formData.append("file", new Blob([blob], { type: mimeType }));
      formData.append("upload_preset", "kqfhwrpq");
      const cloudRes = await fetch("https://api.cloudinary.com/v1_1/diybves1z/image/upload", {
        method: "POST",
        body: formData,
      });
      const cloudData = await cloudRes.json();
      finalModelImage = cloudData.secure_url;
    }

    // Upload product image to Cloudinary if base64
    let finalProductImage = productImage;
    if (productImage.startsWith("data:")) {
      const base64Data = productImage.split(",")[1];
      const blob = Buffer.from(base64Data, "base64");
      const formData = new FormData();
      formData.append("file", new Blob([blob], { type: "image/jpeg" }));
      formData.append("upload_preset", "kqfhwrpq");
      const cloudRes = await fetch("https://api.cloudinary.com/v1_1/diybves1z/image/upload", {
        method: "POST",
        body: formData,
      });
      const cloudData = await cloudRes.json();
      if (!cloudData.secure_url) throw new Error("Failed to upload combined garment image: " + JSON.stringify(cloudData));
      finalProductImage = cloudData.secure_url;
    }

    const res = await fetch(`${FASHN_BASE}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${FASHN_API_KEY}`,
      },
      body: JSON.stringify({
        model_name: "tryon-max",
        inputs: {
          model_image: finalModelImage,
          product_image: finalProductImage,
          resolution: "1k",
          generation_mode: "balanced",
          output_format: "jpeg",
        }
      }),
    });

    const data = await res.json();
    if (data.error) {
      return Response.json({ error: data.error }, { status: 400 });
    }
    return Response.json({ predictionId: data.id });
  } catch (error) {
    console.error("Try-on error FULL:", error, error.stack);
    return Response.json({ error: error.message || "Internal server error", stack: error.stack }, { status: 500 });
  }
}

export async function loader({ request }) {
  try {
    const url = new URL(request.url);
    const predictionId = url.searchParams.get("predictionId");
    if (!predictionId) {
      return Response.json({ error: "predictionId required" }, { status: 400 });
    }
    const res = await fetch(`${FASHN_BASE}/status/${predictionId}`, {
      headers: { "Authorization": `Bearer ${FASHN_API_KEY}` },
    });
    const data = await res.json();
    if (data.status === "completed" && data.output?.[0]) {
      return Response.json({ status: "success", imageUrl: data.output[0] });
    }
    if (data.status === "failed" || data.error) {
      return Response.json({ status: "error", message: data.error });
    }
    return Response.json({ status: "processing" });
  } catch (error) {
    console.error("Poll error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
