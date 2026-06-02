import prisma from "../db.server";

const FASHN_API_KEY = process.env.FASHN_API_KEY;
const FASHN_BASE = "https://api.fashn.ai/v1";

// POST — start a try-on
export async function action({ request }) {
  try {
    const { customerId, modelImage, garmentImage } = await request.json();

    if (!customerId || !modelImage || !garmentImage) {
      return Response.json({ error: "customerId, modelImage and garmentImage required" }, { status: 400 });
    }

    const res = await fetch(`${FASHN_BASE}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${FASHN_API_KEY}`,
      },
      body: JSON.stringify({
        model_name: "tryon-v1.6",
        inputs: {
          model_image: modelImage,
          garment_image: garmentImage,
        },
      }),
    });

    const data = await res.json();

    if (data.error) {
      return Response.json({ error: data.error }, { status: 400 });
    }

    return Response.json({ predictionId: data.id });
  } catch (error) {
    console.error("Try-on error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET — poll for result
export async function loader({ request }) {
  try {
    const url = new URL(request.url);
    const predictionId = url.searchParams.get("predictionId");

    if (!predictionId) {
      return Response.json({ error: "predictionId required" }, { status: 400 });
    }

    const res = await fetch(`${FASHN_BASE}/status/${predictionId}`, {
      headers: {
        "Authorization": `Bearer ${FASHN_API_KEY}`,
      },
    });

    const data = await res.json();

    if (data.status === "completed" && data.output?.[0]) {
      return Response.json({
        status: "success",
        imageUrl: data.output[0],
      });
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