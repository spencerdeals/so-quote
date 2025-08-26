import React from 'react';
import { Package, Calculator } from 'lucide-react';

export function Header() {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Package className="w-8 h-8 text-primary-600" />
              <Calculator className="w-6 h-6 text-primary-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">SDL Instant Quote</h1>
              <p className="text-sm text-gray-600">Import Cost Calculator & Product Extractor</p>
            </div>
          </div>
          
          <div className="text-sm text-gray-500">
            v1.0.0
          </div>
        </div>
      </div>
    </header>
  );
}