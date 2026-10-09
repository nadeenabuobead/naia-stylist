// app/lib/buyskip/persistence-error-diagnostics.server.ts
//
// Classifies a caught Prisma error into a safe, value-free diagnostic
// category for logging. Never returns anything derived from the error's
// own message or meta — those can embed invocation/input values (Prisma
// validation errors in particular quote the offending value). The only
// data that ever leaves this function is: which Prisma error CLASS it was,
// and — only for a known-request error — its short P-code (a fixed,
// finite enum Prisma defines, e.g. "P2024", never a value).

import { Prisma } from "@prisma/client";

export type PersistenceErrorCategory =
  | "KNOWN_REQUEST_ERROR"
  | "VALIDATION_ERROR"
  | "INITIALIZATION_ERROR"
  | "UNKNOWN_REQUEST_ERROR"
  | "UNKNOWN_ERROR";

export interface PersistenceErrorDiagnostic {
  category: PersistenceErrorCategory;
  code: string | null;
}

export function classifyPersistenceError(err: unknown): PersistenceErrorDiagnostic {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return { category: "KNOWN_REQUEST_ERROR", code: err.code };
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    return { category: "VALIDATION_ERROR", code: null };
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return { category: "INITIALIZATION_ERROR", code: err.errorCode ?? null };
  }
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    return { category: "UNKNOWN_REQUEST_ERROR", code: null };
  }
  return { category: "UNKNOWN_ERROR", code: null };
}
