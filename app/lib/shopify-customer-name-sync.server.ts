// app/lib/shopify-customer-name-sync.server.ts
//
// Pure decision logic for syncing Customer.firstName/lastName/email from the
// Shopify Customer Account API during OAuth login. No I/O — the OAuth
// callback owns fetching the Shopify profile and writing the Prisma row;
// this module only decides what, if anything, should change.

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
