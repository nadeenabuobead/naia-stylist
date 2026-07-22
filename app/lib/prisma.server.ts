import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

const makePrisma = () => new PrismaClient().$extends(withAccelerate());
type ExtendedPrisma = ReturnType<typeof makePrisma>;

declare global {
  var __prisma: ExtendedPrisma | undefined;
}

let prisma: ExtendedPrisma;

if (process.env.NODE_ENV === "production") {
  prisma = makePrisma();
} else {
  if (!global.__prisma) {
    global.__prisma = makePrisma();
  }
  prisma = global.__prisma;
}

export { prisma };
