# Styling-to-Shopping Conversion Tracking - Implementation Guide

## Overview

This feature tracks the complete user journey from AI styling recommendation to purchase, answering the critical question: **"Did styling lead to buying?"**

This is different from general Shopify analytics. While Shopify tracks overall product views and purchases, this system specifically tracks what happens **after a product is recommended through the AI styling journey**.

## Architecture

### 1. Database Schema (Prisma)

Three new models track the conversion funnel:

- **StylingRecommendation**: Core tracking model that captures the entire journey from recommendation to purchase
- **StylingSession**: Groups recommendations by styling session
- **ConversionDropOff**: Optional model for detailed funnel analysis

### 2. Event Tracking Functions

Located in `app/utils/stylingConversion.server.js`:

- `trackStylingRecommendation()` - When AI recommends a product
- `trackProductClick()` - When user clicks recommended product
- `trackVirtualTryOn()` - When user uses virtual try-on
- `trackProductSaved()` - When user saves/wishlists
- `trackAddToCart()` - When user adds to cart
- `trackPurchase()` - When user completes purchase

### 3. API Endpoint

`app/routes/api.designer-stats.jsx` provides conversion statistics for the dashboard.

### 4. UI Component

`StylingToShoppingConversion.jsx` displays the data in the designer dashboard.

## Implementation Steps

### Step 1: Update Database Schema

Add the new models to your `schema.prisma` file (see `prisma-schema-additions.prisma`).

Run migrations:
```bash
npx prisma migrate dev --name add_styling_conversion_tracking
npx prisma generate
```

### Step 2: Add Tracking Utilities

The file `app/utils/stylingConversion.server.js` has already been created with all tracking functions.

### Step 3: Create Unified Tracking API

The file `app/routes/api.track-event.jsx` has already been created.

### Step 4: Integrate Event Tracking

#### A. When AI Generates Styling Recommendations

```javascript
// In your AI styling logic
const sessionId = `styling_${Date.now()}_${userId}`;

for (const product of recommendations) {
  await trackStylingRecommendation({
    userId,
    productId: product.id,
    sessionId,
    lookId: product.lookId,
  });
}

// Store sessionId in localStorage for subsequent tracking
localStorage.setItem('naia_styling_session', sessionId);
```

#### B. On Product Click

```javascript
// When user clicks a recommended product
function handleProductClick(productId) {
  fetch('/api/track-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'product_click',
      userId: currentUser.id,
      productId,
      sessionId: localStorage.getItem('naia_styling_session'),
    }),
  });
  
  navigate(`/products/${productId}`);
}
```

#### C. On Virtual Try-On

```javascript
function handleTryOn(productId) {
  fetch('/api/track-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'virtual_tryon',
      userId: currentUser.id,
      productId,
      sessionId: localStorage.getItem('naia_styling_session'),
    }),
  });
  
  openVirtualTryOn(productId);
}
```

#### D. On Save/Wishlist

```javascript
function handleSave(productId) {
  fetch('/api/track-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'product_saved',
      userId: currentUser.id,
      productId,
      sessionId: localStorage.getItem('naia_styling_session'),
    }),
  });
  
  addToWishlist(productId);
}
```

#### E. On Add to Cart

```javascript
function handleAddToCart(productId) {
  fetch('/api/track-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'add_to_cart',
      userId: currentUser.id,
      productId,
      sessionId: localStorage.getItem('naia_styling_session'),
    }),
  });
  
  addToCart(productId);
}
```

#### F. On Purchase (Shopify Webhook)

```javascript
// app/routes/webhooks.shopify.orders.jsx
import { trackPurchase } from "~/utils/stylingConversion.server";

export async function action({ request }) {
  const orderData = await request.json();
  
  for (const item of orderData.line_items) {
    await trackPurchase({
      userId: orderData.customer_id,
      productId: item.product_id.toString(),
      orderId: orderData.id,
    });
  }
  
  return json({ success: true });
}
```

### Step 5: Update Designer Stats API

The file `app/routes/api.designer-stats.jsx` has already been created.

### Step 6: Add Component to Dashboard

In `app/routes/naia-designer-dashboard-2026.jsx`:

```javascript
import StylingToShoppingConversion from "~/components/StylingToShoppingConversion";

export default function DesignerDashboard() {
  const { stylingToShopping } = useLoaderData();
  
  return (
    <div>
      {/* Other sections... */}
      
      <StylingToShoppingConversion data={stylingToShopping} />
    </div>
  );
}
```

## Key Concepts

### Session Management

- Each styling interaction creates a unique `sessionId`
- Session ID is stored in localStorage: `naia_styling_session`
- Links all subsequent actions back to the original styling recommendation
- Sessions expire after 24 hours or when user starts a new styling session

### Attribution Window

- Purchases are attributed to recommendations within **30 days**
- This window can be adjusted in `trackPurchase()` function
- Only the most recent recommendation is credited for a purchase

### Metrics Explained

1. **Recommended in looks**: How many times AI recommended this product
2. **Clicked from styling result**: Users who clicked to view product details
3. **Click rate**: (Clicked / Recommended) × 100
4. **Virtual try-on usage**: Users who used AR try-on feature
5. **Saved/wishlisted**: Users who saved for later
6. **Added to cart**: Users who added to cart
7. **Purchased**: Completed purchases
8. **Conversion rate**: (Purchased / Recommended) × 100
9. **Main drop-off**: Largest drop between consecutive funnel stages

## Testing

### Manual Testing Checklist

1. ✅ Generate AI styling recommendations
2. ✅ Click on a recommended product → verify click tracking
3. ✅ Use virtual try-on → verify try-on tracking
4. ✅ Save product to wishlist → verify save tracking
5. ✅ Add to cart → verify cart tracking
6. ✅ Complete purchase → verify purchase tracking
7. ✅ Check dashboard displays correct stats

### Test Data Creation

```javascript
// Create test data for development
import { trackStylingRecommendation, trackProductClick, trackPurchase } from "~/utils/stylingConversion.server";

async function seedConversionData() {
  const sessionId = `test_session_${Date.now()}`;
  
  // Create recommendations
  await trackStylingRecommendation({
    userId: "user_123",
    productId: "prod_pants_001",
    sessionId,
  });
  
  // Simulate click
  await trackProductClick({
    userId: "user_123",
    productId: "prod_pants_001",
    sessionId,
  });
  
  // Simulate purchase
  await trackPurchase({
    userId: "user_123",
    productId: "prod_pants_001",
    orderId: "order_456",
  });
}
```

## Troubleshooting

### No data showing in dashboard

1. Check if Prisma migrations ran successfully
2. Verify tracking functions are being called (add console.logs)
3. Check browser console for API errors
4. Verify sessionId is being stored and retrieved correctly

### Purchases not being tracked

1. Ensure Shopify webhook is configured and working
2. Check that customer IDs match between systems
3. Verify 30-day attribution window is appropriate
4. Check webhook payload structure matches your code

### Session ID not persisting

1. Verify localStorage is available (not in incognito mode)
2. Check for localStorage key typos
3. Ensure sessionId is created before first tracking call

## Performance Considerations

- All tracking calls are async and non-blocking
- Failed tracking calls shouldn't break user experience
- Consider batching events if high volume
- Index frequently queried fields (productId, userId, sessionId)

## Privacy & Compliance

- Ensure tracking complies with privacy policy
- Get user consent for tracking where required
- Respect GDPR/CCPA data deletion requests
- Don't track PII in session metadata

## Future Enhancements

- Add A/B testing for different styling algorithms
- Track time-to-purchase metric
- Add cohort analysis (users who purchased vs didn't)
- Track which styling features (AI chat, quiz, builder) convert best
- Add email attribution (purchases from styling emails)
