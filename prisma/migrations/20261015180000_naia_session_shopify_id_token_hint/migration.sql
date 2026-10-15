-- AlterTable: NaiaSession — persist the Shopify OIDC id_token from the login
-- that created this session, so logout can pass it as id_token_hint to
-- Shopify's end_session_endpoint and actually end Shopify's own
-- identity-provider session, not just this app's local one.
--
-- Additive, nullable column. Existing NaiaSession rows (created before this
-- field existed) simply have shopifyIdTokenHint = NULL — logout for those
-- sessions still destroys the local session and clears the cookie; it just
-- cannot also end the Shopify-side session, since there is no hint to send.

ALTER TABLE "NaiaSession" ADD COLUMN "shopifyIdTokenHint" TEXT;
