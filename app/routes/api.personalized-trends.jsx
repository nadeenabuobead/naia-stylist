// This endpoint is retired. It previously had a customer-data scoping bug
// (authenticateCustomer()'s return value was never destructured, so its auth
// check could never fail and a Prisma query could run without a customer
// filter). Returning 410 immediately, with no auth/DB/AI code reachable,
// closes that exposure without depending on the broken logic at all.
export async function action() {
  return Response.json(
    { error: "This endpoint has been retired." },
    { status: 410 }
  );
}
