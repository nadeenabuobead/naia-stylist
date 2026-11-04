// app/lib/email/resend-email.test.ts
//
// sendVerificationEmailViaResend — the real implementation behind
// identity-linking.server.ts's _sendVerificationEmail injection point. No
// live RESEND_API_KEY anywhere in this worktree; every test here injects a
// fake client — none make a real network call to Resend.
//
// Run: npx vitest run app/lib/email/resend-email.test.ts

import { describe, it, expect, vi } from "vitest";
import { sendVerificationEmailViaResend, EmailDeliveryError, EmailRateLimitError } from "./resend-email.server";

function fakeResendClient(response: { data: any; error: any }) {
  return { emails: { send: vi.fn().mockResolvedValue(response) } };
}

describe("sendVerificationEmailViaResend", () => {
  it("a successful send resolves with no return value and never throws", async () => {
    const client = fakeResendClient({ data: { id: "email-1" }, error: null });
    await expect(
      sendVerificationEmailViaResend("customer@example.com", "482913", { _resendClient: client as any }),
    ).resolves.toBeUndefined();
  });

  it("sends from the expected from/to/subject shape, with the code embedded in both html and text bodies", async () => {
    const client = fakeResendClient({ data: { id: "email-1" }, error: null });
    await sendVerificationEmailViaResend("customer@example.com", "482913", { _resendClient: client as any });

    const call = client.emails.send.mock.calls[0][0];
    expect(call.to).toBe("customer@example.com");
    expect(call.subject).toMatch(/verification code/i);
    expect(call.html).toContain("482913");
    expect(call.text).toContain("482913");
  });

  it("a rate_limit_exceeded error throws EmailRateLimitError specifically, not the generic EmailDeliveryError", async () => {
    const client = fakeResendClient({
      data: null,
      error: { name: "rate_limit_exceeded", message: "Too many requests", statusCode: 429 },
    });
    await expect(
      sendVerificationEmailViaResend("customer@example.com", "482913", { _resendClient: client as any }),
    ).rejects.toBeInstanceOf(EmailRateLimitError);
  });

  it("EmailRateLimitError is also an EmailDeliveryError — a caller that only checks the general type still catches it", async () => {
    const client = fakeResendClient({
      data: null,
      error: { name: "rate_limit_exceeded", message: "Too many requests", statusCode: 429 },
    });
    await expect(
      sendVerificationEmailViaResend("customer@example.com", "482913", { _resendClient: client as any }),
    ).rejects.toBeInstanceOf(EmailDeliveryError);
  });

  it("a non-rate-limit Resend error (e.g. invalid_from_address) throws the generic EmailDeliveryError with Resend's own error name as the code", async () => {
    const client = fakeResendClient({
      data: null,
      error: { name: "invalid_from_address", message: "The from address is not verified", statusCode: 422 },
    });
    try {
      await sendVerificationEmailViaResend("customer@example.com", "482913", { _resendClient: client as any });
      expect.fail("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EmailDeliveryError);
      expect((err as EmailDeliveryError).code).toBe("invalid_from_address");
      expect((err as EmailDeliveryError).message).toMatch(/invalid_from_address/);
    }
  });

  it("SECURITY — the verification code never appears in a thrown delivery-error's message", async () => {
    const client = fakeResendClient({
      data: null,
      error: { name: "internal_server_error", message: "Something went wrong", statusCode: 500 },
    });
    try {
      await sendVerificationEmailViaResend("customer@example.com", "482913", { _resendClient: client as any });
      expect.fail("expected a throw");
    } catch (err) {
      expect((err as Error).message).not.toContain("482913");
    }
  });

  it("SECURITY — a monthly_quota_exceeded response is treated the same as any other delivery error, not confused with rate limiting", async () => {
    const client = fakeResendClient({
      data: null,
      error: { name: "monthly_quota_exceeded", message: "Monthly quota exceeded", statusCode: 429 },
    });
    try {
      await sendVerificationEmailViaResend("customer@example.com", "482913", { _resendClient: client as any });
      expect.fail("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EmailDeliveryError);
      expect(err).not.toBeInstanceOf(EmailRateLimitError);
      expect((err as EmailDeliveryError).code).toBe("monthly_quota_exceeded");
    }
  });
});
