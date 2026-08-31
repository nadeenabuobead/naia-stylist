// app/routes/api.naia-observation-feedback.tsx
// POST endpoint — persists customer feedback on a nAia First Read observation.
//
// Security contract:
//   - Client submits ONLY: observationKey + feedback ("accurate" | "not-quite")
//   - Server NEVER trusts client for observationType, evidenceFields, evidenceValues, or claimText.
//   - Server loads the customer's current OnboardingProfile, runs computeNaiaFirstRead,
//     finds the observation by key, and persists server-generated provenance only.
//   - Stale or forged keys that do not match the current profile are rejected (422).
//
// One row per (customerId, observationKey) — upserted on each valid submission.

import { data, type ActionFunctionArgs } from "react-router";
import { getCurrentNaiaCustomer } from "../lib/naia-session.server";
import prisma from "../db.server";
import { computeNaiaFirstRead, FIRST_READ_SCHEMA_VERSION } from "../lib/ai/first-naia-read";

const VALID_FEEDBACK = new Set(["accurate", "not-quite"]);

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) {
    return data({ error: "not_authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return data({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return data({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const { observationKey, feedback } = body as Record<string, unknown>;

  // Validate observationKey prefix (fast reject before DB load)
  if (typeof observationKey !== "string" || !observationKey.startsWith(`${FIRST_READ_SCHEMA_VERSION}|`)) {
    return data({ error: "Invalid observationKey" }, { status: 400 });
  }

  // Validate feedback enum (only two values accepted)
  if (typeof feedback !== "string" || !VALID_FEEDBACK.has(feedback)) {
    return data({ error: "feedback must be 'accurate' or 'not-quite'" }, { status: 400 });
  }

  // Load customer's current OnboardingProfile — server is the source of truth for provenance
  const profile = await prisma.onboardingProfile.findUnique({
    where: { customerId: customer.id },
    select: {
      stylePersonalities:    true,
      silhouette:            true,
      successfulOutfitGives: true,
      lifestyle:             true,
      favoriteColors:        true,
      avoidColors:           true,
    },
  });

  // Reconstruct First Read server-side from current profile
  const firstReadResult = computeNaiaFirstRead(profile ?? {});

  // Find the observation matching the submitted key
  const observation = firstReadResult.observations.find(
    obs => obs.observationKey === observationKey,
  );

  if (!observation) {
    // Stale key (profile changed since observation was shown) or forged key
    return data({ error: "Observation not found for current profile" }, { status: 422 });
  }

  // Upsert — never use client-provided type, fields, values, or claim
  await prisma.naiaObservationFeedback.upsert({
    where: {
      customerId_observationKey: {
        customerId: customer.id,
        observationKey,
      },
    },
    update: {
      response:        feedback,
      observationType: observation.type,
      evidenceFields:  observation.evidenceFields,
      evidenceValues:  observation.evidenceValues,
      claimText:       observation.claim,
    },
    create: {
      customerId:      customer.id,
      observationKey,
      response:        feedback,
      observationType: observation.type,
      evidenceFields:  observation.evidenceFields,
      evidenceValues:  observation.evidenceValues,
      claimText:       observation.claim,
    },
  });

  return data({ ok: true });
}
