import React, { useState } from 'react';
import { Header } from './components/Header';
import { ProductExtractor } from './components/ProductExtractor';
import { QuoteCalculator } from './components/QuoteCalculator';
import { ProductData } from './lib/api';

function App() {
  const [extractedProduct, setExtractedProduct] = useState<ProductData | null>(null);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">
              Import Cost Calculator
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Extract product information from any URL and instantly calculate landed costs, 
              duties, taxes, and retail pricing for your imports.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <ProductExtractor onProductExtracted={setExtractedProduct} />
            </div>
            
            <div>
              <QuoteCalculator extractedProduct={extractedProduct} />
            </div>
          </div>
        </div>
      </main>

      <footer className="bg-white border-t border-gray-200 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center text-gray-600">
            <p className="text-sm">
              SDL Instant Quote System - Streamlining import cost calculations
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;