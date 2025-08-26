import React, { useState } from 'react';
import { Search, ExternalLink, Package, AlertCircle } from 'lucide-react';
import { quoteApi, ProductData } from '../lib/api';
import { formatCurrency } from '../lib/utils';

interface ProductExtractorProps {
  onProductExtracted?: (product: ProductData) => void;
}

export function ProductExtractor({ onProductExtracted }: ProductExtractorProps) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<ProductData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExtract = async () => {
    if (!url.trim()) return;

    setLoading(true);
    setError(null);
    
    try {
      const result = await quoteApi.extractProduct(url.trim());
      setProduct(result);
      onProductExtracted?.(result);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to extract product data');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleExtract();
    }
  };

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <Package className="w-5 h-5 text-primary-600" />
        <h2 className="text-lg font-semibold">Product Extractor</h2>
      </div>

      <div className="space-y-4">
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Enter product URL (e.g., Wayfair, Amazon, etc.)"
            className="input-field flex-1"
            disabled={loading}
          />
          <button
            onClick={handleExtract}
            disabled={loading || !url.trim()}
            className="btn-primary flex items-center gap-2 px-6"
          >
            <Search className="w-4 h-4" />
            {loading ? 'Extracting...' : 'Extract'}
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {product && (
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <div className="flex items-start gap-4">
              {product.image && (
                <img
                  src={product.image}
                  alt={product.title}
                  className="w-20 h-20 object-cover rounded-lg border border-gray-200"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-gray-900 mb-1 line-clamp-2">
                  {product.title}
                </h3>
                <div className="flex items-center gap-4 text-sm text-gray-600 mb-2">
                  <span className="font-semibold text-lg text-green-600">
                    {product.price > 0 ? formatCurrency(product.price) : 'Price not found'}
                  </span>
                  {product.used && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                      via {product.used.provider}
                    </span>
                  )}
                </div>
                <a
                  href={product.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700"
                >
                  <ExternalLink className="w-3 h-3" />
                  View Original
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}