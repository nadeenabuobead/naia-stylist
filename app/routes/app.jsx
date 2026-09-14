import { Outlet, useLoaderData, useRouteError } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

// Propagate Shopify's CSP and App Bridge link headers through the response chain.
export const headers = boundary.headers;

// Catches thrown Responses (auth bounces, 4xx) from any child route.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export async function loader({ request }) {
  await authenticate.admin(request);
  return Response.json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
}

export default function AppLayout() {
  const { apiKey } = useLoaderData();
  return (
    <AppProvider embedded apiKey={apiKey}>
      <Outlet />
    </AppProvider>
  );
}
