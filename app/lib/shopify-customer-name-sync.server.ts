// app/lib/shopify-customer-name-sync.server.ts
//
// Pure decision logic for syncing Customer.firstName/lastName from the
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
