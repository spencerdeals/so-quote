# SDL Instant Quote Frontend

A modern React frontend for the SDL Instant Quote system that provides import cost calculations and product data extraction.

## Features

- **Product Extractor**: Extract product information (title, price, image) from any product URL
- **Quote Calculator**: Calculate landed costs, duties, taxes, and retail pricing
- **Multi-item Support**: Handle multiple items in a single quote
- **Real-time Updates**: Automatic calculation updates as you modify inputs
- **Responsive Design**: Works seamlessly on desktop and mobile devices

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure the API URL:
   ```bash
   cp .env.example .env
   # Edit .env to set VITE_API_URL to your backend URL
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

## Environment Variables

- `VITE_API_URL`: URL of the backend API (default: http://localhost:3000)

## Backend Integration

This frontend connects to the SDL Instant Quote backend API with the following endpoints:

- `POST /quote` - Calculate quotes for multiple items
- `GET /quote` - Quick quote calculation for single item
- `POST /extractProduct` - Extract product data from URLs
- `GET /health` - Health check

## Tech Stack

- React 18 with TypeScript
- Vite for build tooling
- Tailwind CSS for styling
- Axios for API calls
- Lucide React for icons

## Project Structure

```
src/
├── components/          # React components
│   ├── Header.tsx      # App header
│   ├── ProductExtractor.tsx  # URL product extraction
│   └── QuoteCalculator.tsx   # Quote calculation form
├── lib/                # Utilities and API
│   ├── api.ts         # API client and types
│   └── utils.ts       # Helper functions
└── App.tsx            # Main app component
```