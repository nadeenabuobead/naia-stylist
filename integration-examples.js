// EXAMPLE INTEGRATION CODE
// How to implement styling-to-shopping event tracking in your nAia app

// ============================================================================
// 1. In your AI Styling Results Component
// ============================================================================

// When showing AI-recommended products to the user:
import { trackStylingRecommendation } from "~/utils/stylingConversion.server";

export async function generateStylingRecommendations(userId, preferences) {
  // Your existing AI logic to generate recommendations
  const recommendations = await getAIStylingRecommendations(preferences);
  
  // Create a session ID for this styling session
  const sessionId = `styling_${Date.now()}_${userId}`;
  
  // Track each recommendation
  for (const product of recommendations) {
    await trackStylingRecommendation({
      userId,
      productId: product.id,
      sessionId,
      lookId: product.lookId || null, // If part of a complete outfit
    });
  }
  
  return { recommendations, sessionId };
}

// ============================================================================
// 2. In your Product Click Handler
// ============================================================================

// When user clicks on a recommended product:
import { trackProductClick } from "~/utils/stylingConversion.server";

// Client-side (send to server via action)
function handleProductClick(productId, sessionId) {
  fetch('/api/track-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'product_click',
      productId,
      sessionId,
      userId: currentUser.id,
    }),
  });
  
  // Then navigate to product page
  navigate(`/products/${productId}`);
}

// Server-side action handler
export async function action({ request }) {
  const { event, productId, sessionId, userId } = await request.json();
  
  if (event === 'product_click') {
    await trackProductClick({ userId, productId, sessionId });
  }
  
  return json({ success: true });
}

// ============================================================================
// 3. In your Virtual Try-On Component
// ============================================================================

// When user activates virtual try-on:
import { trackVirtualTryOn } from "~/utils/stylingConversion.server";

async function handleTryOnClick(productId) {
  // Track the try-on event
  await fetch('/api/track-event', {
    method: 'POST',
    body: JSON.stringify({
      event: 'virtual_tryon',
      productId,
      sessionId: getCurrentSessionId(),
      userId: currentUser.id,
    }),
  });
  
  // Launch virtual try-on
  openVirtualTryOn(productId);
}

// ============================================================================
// 4. In your Wishlist/Save Handler
// ============================================================================

// When user saves/wishlists a product:
import { trackProductSaved } from "~/utils/stylingConversion.server";

async function handleSaveProduct(productId) {
  // Track the save event
  await fetch('/api/track-event', {
    method: 'POST',
    body: JSON.stringify({
      event: 'product_saved',
      productId,
      sessionId: getCurrentSessionId(),
      userId: currentUser.id,
    }),
  });
  
  // Add to wishlist
  await addToWishlist(productId);
}

// ============================================================================
// 5. In your Add to Cart Handler
// ============================================================================

// When user adds a product to cart:
import { trackAddToCart } from "~/utils/stylingConversion.server";

async function handleAddToCart(productId) {
  // Track the cart event
  await fetch('/api/track-event', {
    method: 'POST',
    body: JSON.stringify({
      event: 'add_to_cart',
      productId,
      sessionId: getCurrentSessionId(),
      userId: currentUser.id,
    }),
  });
  
  // Add to cart
  await addProductToCart(productId);
}

// ============================================================================
// 6. In your Shopify Order Webhook Handler
// ============================================================================

// When an order is completed (Shopify webhook):
import { trackPurchase } from "~/utils/stylingConversion.server";

export async function handleShopifyOrderWebhook(orderData) {
  const { customer_id, line_items, id: orderId } = orderData;
  
  // Track purchase for each line item
  for (const item of line_items) {
    const productId = item.product_id.toString();
    
    await trackPurchase({
      userId: customer_id,
      productId,
      orderId,
    });
  }
  
  return { success: true };
}

// ============================================================================
// 7. Session Management Helper
// ============================================================================

// Store session ID in localStorage or state to track the user's journey
function getCurrentSessionId() {
  // Check if there's an active styling session
  const sessionId = localStorage.getItem('naia_styling_session');
  
  if (!sessionId) {
    // If no session, create one
    const newSessionId = `styling_${Date.now()}_${currentUser.id}`;
    localStorage.setItem('naia_styling_session', newSessionId);
    return newSessionId;
  }
  
  return sessionId;
}

// Clear session after 24 hours or when user explicitly ends styling session
function clearStylingSession() {
  localStorage.removeItem('naia_styling_session');
}

// ============================================================================
// 8. React Hook for Easy Tracking
// ============================================================================

// Custom hook to simplify event tracking
import { useCallback } from 'react';

export function useStylingTracking() {
  const trackEvent = useCallback(async (event, data) => {
    try {
      await fetch('/api/track-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event,
          sessionId: getCurrentSessionId(),
          ...data,
        }),
      });
    } catch (error) {
      console.error('Tracking error:', error);
    }
  }, []);
  
  return {
    trackRecommendation: (data) => trackEvent('recommendation', data),
    trackClick: (data) => trackEvent('product_click', data),
    trackTryOn: (data) => trackEvent('virtual_tryon', data),
    trackSave: (data) => trackEvent('product_saved', data),
    trackAddToCart: (data) => trackEvent('add_to_cart', data),
  };
}

// Usage in components:
function StylingResultsPage() {
  const { trackClick, trackTryOn } = useStylingTracking();
  
  return (
    <div>
      <button onClick={() => {
        trackClick({ userId, productId });
        navigateToProduct(productId);
      }}>
        View Product
      </button>
      
      <button onClick={() => {
        trackTryOn({ userId, productId });
        openTryOn(productId);
      }}>
        Try On
      </button>
    </div>
  );
}
