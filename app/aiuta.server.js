export const AIUTA_BASE_URL =
  process.env.AIUTA_BASE_URL || "https://api.aiuta.com/digital-try-on/v1";

export function aiutaHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${process.env.AIUTA_API_TOKEN}`,
    ...extra,
  };
}