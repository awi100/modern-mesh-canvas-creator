# Modern Mesh Co. Canvas Creator

Custom needlepoint canvas creator that transforms photos into stitchable patterns with DMC color matching.

## Setup Instructions

### Step 1: Configure Your Settings

Edit `src/App.js` and update the CONFIG object at the top:

```javascript
const CONFIG = {
  // Your Shopify store URL
  shopifyStoreUrl: 'https://your-store.myshopify.com',
  
  // Your Shopify product variant IDs
  variantIds: {
    '5x5': 'YOUR_VARIANT_ID',
    '8x10': 'YOUR_VARIANT_ID',
    '12x12': 'YOUR_VARIANT_ID',
    '14x18': 'YOUR_VARIANT_ID',
  },
  
  // Cloudinary settings
  cloudinary: {
    cloudName: 'your-cloud-name',
    uploadPreset: 'modern_mesh_uploads',
  },
};
```

### Step 2: Get Your Shopify Variant IDs

1. Go to Shopify Admin > Products
2. Create a product called "Custom Needlepoint Canvas" (or similar)
3. Add 4 variants: Mini ($39), Standard ($65), Large ($95), Premium ($145)
4. For each variant, view the URL - the number at the end is the variant ID
5. Or use the Shopify API to get variant IDs

### Step 3: Deploy to Vercel

1. Push this code to a GitHub repository
2. Go to vercel.com and sign in
3. Click "New Project"
4. Import your GitHub repository
5. Click "Deploy"

### Step 4: Link from Shopify

Add a button/link on your Shopify store that points to your Vercel URL:

```html
<a href="https://your-app.vercel.app" class="btn">Create Custom Canvas</a>
```

## Local Development

```bash
npm install
npm start
```

Open http://localhost:3000 to view it in the browser.

## How It Works

1. Customer uploads a photo
2. Algorithm converts image to needlepoint pattern
3. Colors are matched to DMC thread palette
4. Customer sees live preview
5. On checkout, files are uploaded to Cloudinary
6. Customer is redirected to Shopify cart with order data

## Files Generated

- **Original image**: Customer's uploaded photo
- **Print-ready file**: High-res (300 DPI) pattern for printing on canvas
- **Preview image**: Lower-res preview for order confirmation

## Order Data Structure

The order data is passed to Shopify as a cart property:

```json
{
  "originalImage": "cloudinary-url",
  "printFile": "cloudinary-url", 
  "previewImage": "cloudinary-url",
  "settings": {
    "size": "8x10",
    "sizeName": "Standard",
    "dimensions": "8\" × 10\"",
    "colorCount": 16
  },
  "colors": [
    { "id": "310", "name": "Black", "hex": "#000000" },
    ...
  ],
  "timestamp": "2026-01-12T..."
}
```

## Accessing Order Data in Shopify

The order data is stored in the line item properties. You can:

1. View it in Order Details in Shopify Admin
2. Access via Shopify API
3. Use an app like "Order Printer" to include it in packing slips

## Customization

- Prices: Edit `CANVAS_SIZES` in `src/App.js`
- Colors: Edit brand colors in `src/App.css` (CSS variables)
- DMC Colors: Edit `src/dmcColors.js` to add/remove thread colors
