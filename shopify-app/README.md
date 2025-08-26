# SDL Instant Import Quote - Shopify App

A Shopify app that provides instant import cost calculations for products from various retailers.

## Features

### 4-Page Flow:
1. **URL Input Page** - Paste product URLs from Wayfair, Amazon, etc.
2. **Review Page** - Edit quantities, remove items, view extracted product data
3. **Price Verification** - Double-check scraped prices before final calculation
4. **Cost Breakdown** - Complete import cost analysis with profit margins

### Cost Calculations:
- **First Cost** - Original product price
- **Customs Cost** - 26.5% duty on all items
- **USA to NJ Delivery** - Calculated from 20ft container shipping ($6,000)
- **Customs Entry Fee** - $8 per item fixed cost
- **Shipping & Handling** - Dynamic profit margin (15-50% based on item value/size)

### Integration:
- Connects to existing backend API for product scraping
- Uses ScrapingBee for reliable data extraction
- Estimates shipping dimensions when not available
- Dynamic profit margin structure for competitive pricing

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your Shopify app credentials and backend API URL
   ```

3. Start development:
   ```bash
   npm run dev
   ```

## Environment Variables

- `SHOPIFY_API_KEY` - Your Shopify app API key
- `SHOPIFY_API_SECRET` - Your Shopify app secret
- `BACKEND_API_URL` - URL of your existing backend API
- `SCRAPINGBEE_API_KEY` - ScrapingBee API key for product extraction

## Backend Integration

This app connects to your existing backend endpoints:
- `POST /extractProduct` - Extract product data from URLs
- `POST /quote` - Calculate import costs and margins

## Shipping Address

All items are delivered to:
**6 Progress Street, Elizabeth, NJ 07201**

## Profit Margin Structure

Dynamic margins based on item characteristics:
- **High Value Items** (>$5000): 15% margin
- **Medium-High Value** ($3000-$5000): 20% margin  
- **Medium Value** ($1000-$3000): 25% margin
- **Medium-Low Value** ($500-$1000): 30% margin
- **Low Value Items** (<$500): 40% margin

Additional adjustments:
- **Large Items** (>50 ft³): Max 20% margin
- **Medium Items** (20-50 ft³): Max 25% margin
- **Small Items** (<20 ft³): Full calculated margin

## Container Shipping

- **Container Type**: 20ft container
- **Container Cost**: $6,000
- **Container Volume**: 1,165 ft³
- **Cost Allocation**: Proportional to item volume