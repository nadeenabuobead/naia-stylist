const result = `You're feeling: excited  
You want to feel: comfortable  

Your outfit direction  
- Layer your white top with the Printed Wrap Kimono Jacket for a soft and artistic vibe.  
- Pair it with the Asymmetrical Waist Pants to create a structured yet relaxed silhouette.`;

const ALL_PIECE_NAMES = [
  "Sculptural Hybrid Coat", "Art Blouse", "Art Panel Tailored Blazer",
  "Textured Art Maxi Skirt", "Wrap Cropped Top", "Printed Wrap Kimono Jacket",
  "Art Collar Shirt", "Leather Midi Dress", "Asymmetrical Waist Pants", "Printed Straight Pants"
];

const foundPieces = ALL_PIECE_NAMES.filter(name => result.includes(name));
console.log('Found pieces:', foundPieces);
console.log('Count:', foundPieces.length);
