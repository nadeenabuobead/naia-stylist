-- CreateTable: GarmentStyleMeProfile
-- Stores manually-curated StyleMe garment audit taxonomy.
-- Separate from Closet Intelligence V2; not wired to live StyleMe yet.

CREATE TABLE "GarmentStyleMeProfile" (
    "id" TEXT NOT NULL,
    "closetItemId" TEXT NOT NULL,
    "profileStatus" TEXT NOT NULL DEFAULT 'unreviewed',
    "exactSlot" TEXT,
    "outfitFunction" TEXT,
    "styleFamilyPrimary" TEXT,
    "styleFamilySecondary" TEXT,
    "dressRegister" TEXT,
    "construction" TEXT,
    "fabricBehaviour" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "silhouetteCharacter" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "visualWeight" TEXT,
    "stylingEffort" TEXT,
    "layeringBehaviour" TEXT,
    "waistComfort" TEXT,
    "statementLevel" TEXT,
    "occasionFit" JSONB,
    "intentionPotentials" JSONB,
    "naturalPairings" TEXT,
    "intentionalMix" TEXT,
    "avoidInStyleMe" TEXT,
    "specialNotes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GarmentStyleMeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GarmentStyleMeProfile_closetItemId_key" ON "GarmentStyleMeProfile"("closetItemId");

-- AddForeignKey
ALTER TABLE "GarmentStyleMeProfile" ADD CONSTRAINT "GarmentStyleMeProfile_closetItemId_fkey"
    FOREIGN KEY ("closetItemId") REFERENCES "ClosetItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
