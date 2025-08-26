import React, { useState, useEffect } from 'react';
import { Calculator, Plus, Trash2, AlertCircle } from 'lucide-react';
import { quoteApi, QuoteItem, QuoteResponse, ProductData } from '../lib/api';
import { formatCurrency, formatPercent } from '../lib/utils';

interface QuoteCalculatorProps {
  extractedProduct?: ProductData | null;
}

export function QuoteCalculator({ extractedProduct }: QuoteCalculatorProps) {
  const [items, setItems] = useState<QuoteItem[]>([
    { firstCost: 0, qty: 1, volumeFt3: 11.33 }
  ]);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-populate when product is extracted
  useEffect(() => {
    if (extractedProduct && extractedProduct.price > 0) {
      setItems([{
        firstCost: extractedProduct.price,
        qty: 1,
        volumeFt3: 11.33
      }]);
    }
  }, [extractedProduct]);

  const updateItem = (index: number, field: keyof QuoteItem, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const addItem = () => {
    setItems([...items, { firstCost: 0, qty: 1, volumeFt3: 11.33 }]);
  };

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const calculateQuote = async () => {
    const validItems = items.filter(item => item.firstCost > 0);
    if (validItems.length === 0) return;

    setLoading(true);
    setError(null);

    try {
      const result = await quoteApi.getQuote(validItems);
      setQuote(result);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to calculate quote');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center gap-2 mb-6">
          <Calculator className="w-5 h-5 text-primary-600" />
          <h2 className="text-lg font-semibold">Quote Calculator</h2>
        </div>

        <div className="space-y-4">
          {items.map((item, index) => (
            <div key={index} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-gray-900">Item {index + 1}</h3>
                {items.length > 1 && (
                  <button
                    onClick={() => removeItem(index)}
                    className="text-red-600 hover:text-red-700 p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    First Cost ($)
                  </label>
                  <input
                    type="number"
                    value={item.firstCost || ''}
                    onChange={(e) => updateItem(index, 'firstCost', Number(e.target.value))}
                    className="input-field"
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Quantity
                  </label>
                  <input
                    type="number"
                    value={item.qty || 1}
                    onChange={(e) => updateItem(index, 'qty', Number(e.target.value))}
                    className="input-field"
                    min="1"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Volume (ft³)
                  </label>
                  <input
                    type="number"
                    value={item.volumeFt3 || ''}
                    onChange={(e) => updateItem(index, 'volumeFt3', Number(e.target.value))}
                    className="input-field"
                    placeholder="11.33"
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>
            </div>
          ))}

          <div className="flex gap-2">
            <button onClick={addItem} className="btn-secondary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Add Item
            </button>
            <button
              onClick={calculateQuote}
              disabled={loading || items.every(item => item.firstCost <= 0)}
              className="btn-primary flex items-center gap-2"
            >
              <Calculator className="w-4 h-4" />
              {loading ? 'Calculating...' : 'Calculate Quote'}
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}
        </div>
      </div>

      {quote && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Quote Results</h3>
          
          <div className="space-y-4">
            {quote.results.map((result, index) => (
              <div key={index} className="border border-gray-200 rounded-lg p-4">
                <h4 className="font-medium text-gray-900 mb-3">Item {index + 1}</h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h5 className="text-sm font-medium text-gray-700 mb-2">Cost Breakdown (per unit)</h5>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span>First Cost:</span>
                        <span>{formatCurrency(result.breakdown.unit.firstCost)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>US Sales Tax:</span>
                        <span>{formatCurrency(result.breakdown.unit.usSalesTax)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Freight:</span>
                        <span>{formatCurrency(result.breakdown.unit.freight)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Duty ({formatPercent(result.inputs.dutyRate)}):</span>
                        <span>{formatCurrency(result.breakdown.unit.duty)}</span>
                      </div>
                      <div className="flex justify-between font-medium border-t pt-1">
                        <span>Landed Cost:</span>
                        <span>{formatCurrency(result.breakdown.unit.landed)}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h5 className="text-sm font-medium text-gray-700 mb-2">Customer Pricing</h5>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span>Quantity:</span>
                        <span>{result.inputs.qty}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Unit Price:</span>
                        <span className="font-medium text-green-600">
                          {formatCurrency(result.customer.unit)}
                        </span>
                      </div>
                      <div className="flex justify-between font-medium border-t pt-1">
                        <span>Total Price:</span>
                        <span className="text-green-600">
                          {formatCurrency(result.customer.total)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
              <h4 className="font-semibold text-primary-900 mb-2">Order Totals</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex justify-between">
                  <span>Total Landed Cost:</span>
                  <span className="font-medium">{formatCurrency(quote.totals.landed)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Customer Price:</span>
                  <span className="font-medium text-green-600">
                    {formatCurrency(quote.totals.customer)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}