import { authenticateCustomer } from "../customer-auth.server.js";

export async function action({ request }) {
  try {
    const { customer } = await authenticateCustomer(request);
    
    if (!customer) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { result, session } = body;

    const { prisma } = await import("../db.server.js");
    
    const savedLook = await prisma.savedLook.create({
      data: {
        customerId: customer.id,
        resultText: result,
        productsUsed: [],
        wardrobeItemsUsed: [],
        createdAt: new Date()
      }
    });

    return Response.json({ 
      success: true,
      lookId: savedLook.id
    });
    
  } catch (error) {
    console.error("Save look error:", error);
    return Response.json({ error: "Failed to save look" }, { status: 500 });
  }
}
