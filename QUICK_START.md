# Quick Start Guide - Styling-to-Shopping Conversion

## Minimal Setup (30 minutes)

This guide gets you from zero to a working conversion tracking system in 30 minutes.

### Step 1: Add Database Models (5 min)

Add this to your `schema.prisma`:

```prisma
model StylingRecommendation {
  id                String   @id @default(cuid())
  userId            String
  productId         String
  sessionId         String
  lookId            String?
  recommendedAt     DateTime @default(now())
  
  clicked           Boolean  @default(false)
  clickedAt         DateTime?
  virtualTryOn      Boolean  @default(false)
  virtualTryOnAt    DateTime?
  saved             Boolean  @default(false)
  savedAt           DateTime?
  addedToCart       Boolean  @default(false)
  addedToCartAt     DateTime?
  purchased         Boolean  @default(false)
  purchasedAt       DateTime?
  orderId           String?
  
  user              User     @relation(fields: [userId], references: [id])
  product           Product  @relation(fields: [productId], references: [id])
  
  @@index([userId])
  @@index([productId])
  @@index([sessionId])
}
```

Run: `npx prisma migrate dev --name add_conversion_tracking`

### Step 2: Add Tracking Utility (5 min)

The file `app/utils/stylingConversion.server.js` is already created - you pasted it earlier!

### Step 3: Create Tracking API (5 min)

The file `app/routes/api.track-event.jsx` is already created - you pasted it earlier!

### Step 4: Track Initial Recommendations (5 min)

In your AI styling code, add:

```javascript
import { prisma } from "~/db.server";

// When generating recommendations
const sessionId = `styling_${Date.now()}_${userId}`;

for (const product of recommendations) {
  await prisma.stylingRecommendation.create({
    data: {
      userId,
      productId: product.id,
      sessionId,
    },
  });
}

// Return sessionId to frontend
return { recommendations, sessionId };
```

### Step 5: Track User Actions (5 min)

Add tracking to your product interactions:

```javascript
// In your frontend components
const sessionId = localStorage.getItem('naia_styling_session');

// On product click
async function trackClick(productId) {
  await fetch('/api/track-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'product_click',
      userId: user.id,
      productId,
      sessionId,
    }),
  });
}

// Use before navigation
trackClick(productId);
navigate(`/products/${productId}`);
```

### Step 6: Add Dashboard Component (5 min)

1. The component `app/components/StylingToShoppingConversion.jsx` is already created!
2. Add to your dashboard:

```javascript
import StylingToShoppingConversion from "~/components/StylingToShoppingConversion";

// In loader
const conversionStats = await getAllProductsConversionStats();

// In component
<StylingToShoppingConversion 
  data={{ 
    hasData: conversionStats.length > 0,
    stats: conversionStats 
  }} 
/>
```

## Test It

1. Generate AI recommendations → should create records
2. Click a product → should mark as clicked
3. Check dashboard → should see stats

## Common Issues

**No data showing?**
- Check if migrations ran: `npx prisma migrate status`
- Verify sessionId is being stored: `console.log(sessionId)`
- Check API responses: Network tab in DevTools

**Events not tracking?**
- Ensure fetch calls complete before navigation
- Check server logs for errors
- Verify userId matches database records

## Next Steps

Once basic tracking works:

1. Add virtual try-on tracking
2. Add save/wishlist tracking  
3. Add cart tracking
4. Set up Shopify webhook for purchases
5. Customize metrics and visualizations

## Need Help?

Check the full `IMPLEMENTATION_GUIDE.md` for detailed explanations.
