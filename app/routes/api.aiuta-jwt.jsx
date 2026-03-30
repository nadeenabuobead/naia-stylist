import jwt from "jsonwebtoken";

export async function loader({ request }) {
  const token = jwt.sign(
    { iss: process.env.AIUTA_CLIENT_ID },
    process.env.AIUTA_CLIENT_SECRET,
    { algorithm: "HS256", expiresIn: "1h" }
  );

  return new Response(JSON.stringify({ token }), {
    headers: { 
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}