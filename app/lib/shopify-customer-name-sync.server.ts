// app/lib/shopify-customer-name-sync.server.ts
//
// Pure decision logic for syncing Customer.firstName/lastName/email from the
// Shopify Customer Account API during OAuth login. No I/O — the OAuth
// callback owns fetching the Shopify profile and writing the Prisma row;
// this module only decides what, if anything, should change.

import { Prisma } from "@prisma/client";

export function usableName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface NameFields {
  firstName: string | null;
  lastName:  string | null;
}

// Returns only the fields that should be written. Never overwrites an
// existing usable local name with a null/blank Shopify value, and never
// writes a value that already matches what's stored.
export function resolveNameUpdate(shopify: NameFields, local: NameFields): Partial<NameFields> {
  const update: Partial<NameFields> = {};

  const shopifyFirst = usableName(shopify.firstName);
  if (shopifyFirst !== null && shopifyFirst !== local.firstName) {
    update.firstName = shopifyFirst;
  }

  const shopifyLast = usableName(shopify.lastName);
  if (shopifyLast !== null && shopifyLast !== local.lastName) {
    update.lastName = shopifyLast;
  }

  return update;
}

// ---------------------------------------------------------------------------
// Email — same non-destructive rule as the name fields above: Shopify's
// email is trusted as the on-file value for the account the customer just
// authenticated into (not user-submitted input) — Shopify's Customer
// Account API exposes no separate "verified" flag for it, and this module
// makes no verified-email claim. A null/blank value from Shopify must never
// clear out an existing local email, and an unchanged value never triggers
// a write.
// ---------------------------------------------------------------------------

export function usableEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveEmailUpdate(
  shopifyEmail: string | null,
  localEmail:   string | null,
): { email?: string } {
  const candidate = usableEmail(shopifyEmail);
  if (candidate !== null && candidate !== localEmail) {
    return { email: candidate };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Safety check for the OAuth callback's collision-recovery branches: a P2002
// is Prisma's generic "a unique constraint was violated" code — it does not
// by itself say WHICH field. Dropping email and retrying is only safe to do
// in response to an email collision specifically; blindly reacting to any
// P2002 risks silently swallowing (and mis-handling) a completely unrelated
// uniqueness violation — e.g. the Customer.shopifyCustomerId constraint, or a
// future unique field this module has never heard of. Checking the error's
// own meta.target is the only way to know which constraint actually fired,
// rather than inferring it from surrounding control flow.
//
// Postgres (this app's only datasource) reports meta.target as a string[] of
// column names for P2002; a bare string naming the constraint is handled
// too, for resilience against a differently-shaped driver error.
// ---------------------------------------------------------------------------

export function isEmailUniqueConstraintViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== "P2002") return false;

  const target = (err.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) return target.includes("email");
  if (typeof target === "string") return target.includes("email");
  return false;
}
