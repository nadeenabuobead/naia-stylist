import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

// ---------------------------------------------------------------------------
// Structured validation error — carries a fixed safe category for log output.
// Raw jose messages, claim values, and token content are never stored here.
// ---------------------------------------------------------------------------

type ValidationCategory =
  | "signature_or_jwks"
  | "issuer"
  | "audience"
  | "expiry_or_token_age"
  | "nonce"
  | "customer_gid_format"
  | "unknown_validation_error";

export class IdTokenValidationError extends Error {
  readonly category: ValidationCategory;
  readonly joseCode?: string;
  constructor(category: ValidationCategory, joseCode?: string) {
    super("id_token_validation_failed");
    this.name     = "IdTokenValidationError";
    this.category = category;
    this.joseCode = joseCode;
  }
}

// ---------------------------------------------------------------------------
// OIDC discovery — fetched once per cold start, cached with TTL
// ---------------------------------------------------------------------------

interface OidcConfig {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint: string;
  jwks_uri: string;
}

let oidcCache: OidcConfig | null = null;
let oidcCachedAt = 0;
const OIDC_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function getOidcConfig(): Promise<OidcConfig> {
  if (oidcCache && Date.now() - oidcCachedAt < OIDC_TTL_MS) return oidcCache;

  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!storeDomain) throw new Error("SHOPIFY_STORE_DOMAIN env var is not set");

  const res = await fetch(
    `https://${storeDomain}/.well-known/openid-configuration`
  );
  if (!res.ok) {
    throw new Error(`OIDC discovery failed: ${res.status}`);
  }

  const raw = await res.json();
  oidcCache = {
    issuer:                  raw.issuer,
    authorization_endpoint:  raw.authorization_endpoint,
    token_endpoint:          raw.token_endpoint,
    end_session_endpoint:    raw.end_session_endpoint,
    jwks_uri:                raw.jwks_uri,
  };
  oidcCachedAt = Date.now();
  return oidcCache;
}

// ---------------------------------------------------------------------------
// JWKS — module-level so jose's internal cache survives across warm calls
// ---------------------------------------------------------------------------

let jwksSet: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwksSet(jwksUri: string) {
  if (!jwksSet) {
    jwksSet = createRemoteJWKSet(new URL(jwksUri));
  }
  return jwksSet;
}

// ---------------------------------------------------------------------------
// PKCE + state + nonce generation
// ---------------------------------------------------------------------------

export interface PkceBundle {
  codeVerifier:  string; // stored in signed session cookie
  codeChallenge: string; // sent in authorization URL
  state:         string; // sent in URL, stored in session, compared in callback
  nonce:         string; // sent in URL, stored in session, compared in id_token
}

export function generatePkceBundle(): PkceBundle {
  const codeVerifier  = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const state = randomBytes(16).toString("hex");
  const nonce = randomBytes(16).toString("hex");
  return { codeVerifier, codeChallenge, state, nonce };
}

// ---------------------------------------------------------------------------
// Authorization URL
// ---------------------------------------------------------------------------

export function buildAuthorizationUrl(
  oidcConfig: OidcConfig,
  bundle: PkceBundle,
  redirectUri: string
): string {
  const url = new URL(oidcConfig.authorization_endpoint);
  url.searchParams.set("client_id",              process.env.SHOPIFY_API_KEY!);
  url.searchParams.set("scope",                  "openid email customer-account-api:full");
  url.searchParams.set("redirect_uri",           redirectUri);
  url.searchParams.set("response_type",          "code");
  url.searchParams.set("state",                  bundle.state);
  url.searchParams.set("nonce",                  bundle.nonce);
  url.searchParams.set("code_challenge",         bundle.codeChallenge);
  url.searchParams.set("code_challenge_method",  "S256");
  return url.toString();
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

interface TokenResponse {
  id_token:      string;
  access_token:  string;
  refresh_token?: string;
  token_type:    string;
  expires_in:    number;
}

export async function exchangeCodeForTokens(
  code:         string,
  codeVerifier: string,
  redirectUri:  string,
  oidcConfig:   OidcConfig
): Promise<TokenResponse> {
  const clientId     = process.env.SHOPIFY_API_KEY!;
  const clientSecret = process.env.SHOPIFY_API_SECRET!;

  const res = await fetch(oidcConfig.token_endpoint, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/x-www-form-urlencoded",
      // client_secret_basic as declared in token_endpoint_auth_methods_supported
      "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      client_id:     clientId,
      code,
      redirect_uri:  redirectUri,
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "<unreadable>");
    throw new Error(`Token exchange failed: ${res.status}`);
  }

  return res.json() as Promise<TokenResponse>;
}

// ---------------------------------------------------------------------------
// id_token validation (all 7 checks)
// ---------------------------------------------------------------------------

export interface VerifiedCustomerClaims {
  shopifyCustomerId: string; // numeric portion of gid://shopify/Customer/<id>
}

export async function validateIdToken(
  idToken:     string,
  storedNonce: string,
  oidcConfig:  OidcConfig
): Promise<VerifiedCustomerClaims> {
  const clientId = process.env.SHOPIFY_API_KEY!;

  // jwtVerify validates RS256 signature (via JWKS), issuer, audience, and exp.
  // It does NOT automatically enforce iat freshness — that requires explicit maxTokenAge.
  let payload: import("jose").JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, getJwksSet(oidcConfig.jwks_uri), {
      issuer:         oidcConfig.issuer,
      audience:       clientId,
      clockTolerance: 30,  // seconds — tolerate minor clock skew
      maxTokenAge:    300, // seconds — id_token must have been issued within 5 minutes
    }));
  } catch (e) {
    const code  = (e as { code?: string }).code  ?? "";
    const claim = (e as { claim?: string }).claim ?? "";
    let category: ValidationCategory = "unknown_validation_error";
    if (code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" || code.startsWith("ERR_JWKS_")) {
      category = "signature_or_jwks";
    } else if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
      if      (claim === "iss")                                         category = "issuer";
      else if (claim === "aud")                                         category = "audience";
      else if (claim === "exp" || claim === "iat" || claim === "nbf")   category = "expiry_or_token_age";
    } else if (code === "ERR_JWT_EXPIRED") {
      category = "expiry_or_token_age";
    }
    throw new IdTokenValidationError(category, code || undefined);
  }

  // Check 3: nonce (replay prevention)
  const nonce = payload.nonce as string | undefined;
  if (!nonce) throw new IdTokenValidationError("nonce");
  try {
    if (!timingSafeEqual(Buffer.from(nonce), Buffer.from(storedNonce))) {
      throw new IdTokenValidationError("nonce");
    }
  } catch (e) {
    if (e instanceof IdTokenValidationError) throw e;
    throw new IdTokenValidationError("nonce"); // timingSafeEqual RangeError on length mismatch
  }

  // Extract and validate sub
  const sub = payload.sub;
  if (typeof sub !== "string" || !sub.startsWith("gid://shopify/Customer/")) {
    throw new IdTokenValidationError("customer_gid_format");
  }

  const shopifyCustomerId = sub.split("/").pop();
  if (!shopifyCustomerId || !/^\d+$/.test(shopifyCustomerId)) {
    throw new IdTokenValidationError("customer_gid_format");
  }

  return { shopifyCustomerId };
}

// ---------------------------------------------------------------------------
// return_to URL validation (open-redirect prevention)
// ---------------------------------------------------------------------------

export function validateReturnTo(raw: string | null): string {
  if (!raw) return "/";
  if (raw.startsWith("/") && !raw.startsWith("//") && raw.length <= 200) {
    return raw;
  }
  return "/";
}
