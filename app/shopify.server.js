import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { attachSessionStorageReadinessSafetyNet } from "./lib/shopify-session-storage-safety-net.server.js";
import { createLazySessionStorage } from "./lib/lazy-shopify-session-storage.server.js";

// See shopify-session-storage-safety-net.server.js for the full root-cause
// writeup of why attachSessionStorageReadinessSafetyNet exists — it
// prevents a transient DB blip from crashing the entire process via an
// unhandled rejection on PrismaSessionStorage's own background readiness
// check.
//
// See lazy-shopify-session-storage.server.js for the full writeup of WHY
// this is wrapped in createLazySessionStorage (2026-11-19): the real
// PrismaSessionStorage constructor polls for the session table
// immediately and unconditionally, competing with every cold start's own
// route code for db.server.js's connection_limit=2 pool — even for a
// customer-facing Clerk-only route that will never call a single
// session-storage method. This defers that poll to the first actual
// Shopify-specific request (/app/*, /auth/shopify/*) instead of paying
// it on every cold start regardless of route. connectionRetries: 1 (also
// 2026-11-19) halves that poll's own demand further on the rare cold
// start where it does still fire — a pure reduction in how many
// connections this one background check asks for, not a change to
// connection_limit itself (db.server.js is untouched).
const prismaSessionStorage = createLazySessionStorage(() => {
  const real = new PrismaSessionStorage(prisma, { connectionRetries: 1 });
  attachSessionStorageReadinessSafetyNet(real);
  return real;
});

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: prismaSessionStorage,
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
