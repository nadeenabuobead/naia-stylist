import { authenticate } from "~/shopify.server";

export async function loader({ request }) {
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);

  const customerIdentityAvailable =
    typeof sessionToken?.sub === "string" && sessionToken.sub.startsWith("gid://shopify/");

  return cors(
    Response.json({
      verified: true,
      customerIdentityAvailable,
    })
  );
}

export async function action({ request }) {
  // authenticate.public.customerAccount throws a 204 CORS preflight response for OPTIONS.
  // For any other non-GET method it returns cors(), which we use to return 405.
  const { cors } = await authenticate.public.customerAccount(request);
  return cors(new Response(null, { status: 405 }));
}
