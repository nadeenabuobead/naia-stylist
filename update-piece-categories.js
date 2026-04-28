import prisma from './app/db.server.js';

const PIECE_CATEGORIES = {
  "Sculptural Hybrid Coat": "Outerwear",
  "Art Blouse": "Top",
  "Art Panel Tailored Blazer": "Outerwear",
  "Textured Art Maxi Skirt": "Skirt",
  "Wrap Cropped Top": "Top",
  "Printed Wrap Kimono Jacket": "Outerwear",
  "Art Collar Shirt": "Top",
  "Leather Midi Dress": "Dress",
  "Asymmetrical Waist Pants": "Trouser",
  "Printed Straight Pants": "Trouser",
};

const items = await prisma.outfitItem.findMany({
  where: { itemType: "TOP" }
});

console.log(`Found ${items.length} items with category "TOP"`);

for (const item of items) {
  const correctCategory = PIECE_CATEGORIES[item.productTitle];
  if (correctCategory) {
    await prisma.outfitItem.update({
      where: { id: item.id },
      data: { itemType: correctCategory }
    });
    console.log(`Updated ${item.productTitle} → ${correctCategory}`);
  }
}

console.log('Done! Refresh dashboard.');
await prisma.$disconnect();
