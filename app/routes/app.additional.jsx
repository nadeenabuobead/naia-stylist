import jwt from "jsonwebtoken";

export async function loader() {
  try {
    const now = Math.floor(Date.now() / 1000);

    const token = jwt.sign(
      {
        iss: process.env.AIUTA_CLIENT_ID,
        iat: now,
        exp: now + 3600,
      },
      process.env.AIUTA_SECRET,
      { algorithm: "HS256" }
    );

    return new Response(JSON.stringify({ token }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  } catch (error) {
    console.error(error);

    return new Response(JSON.stringify({ error: "JWT failed" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
}