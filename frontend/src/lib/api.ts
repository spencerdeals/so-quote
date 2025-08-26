import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface QuoteItem {
  firstCost: number;
  qty?: number;
  volumeFt3?: number;
  freightRatePerFt3?: number;
  applyUsSalesTax?: boolean;
  usSalesTaxRate?: number;
}

export interface QuoteResult {
  index: number;
  inputs: {
    firstCost: number;
    qty: number;
    volumeFt3: number;
    freightRatePerFt3: number;
    applyUsSalesTax: boolean;
    usSalesTaxRate: number;
    dutyRate: number;
  };
  breakdown: {
    unit: {
      firstCost: number;
      usSalesTax: number;
      freight: number;
      duty: number;
      landed: number;
    };
    total: {
      landed: number;
    };
  };
  customer: {
    unit: number;
    total: number;
  };
}

export interface QuoteResponse {
  ok: boolean;
  version: string;
  defaults: {
    freightRatePerFt3: number;
    defaultVolumeFt3: number;
    usSalesTaxRate: number;
    dutyRate: number;
  };
  results: QuoteResult[];
  totals: {
    landed: number;
    customer: number;
  };
}

export interface ProductData {
  ok: boolean;
  url: string;
  title: string;
  price: number;
  image: string;
  used?: {
    provider: string;
    render_js: boolean;
  };
}

export const quoteApi = {
  getQuote: async (items: QuoteItem[]): Promise<QuoteResponse> => {
    const response = await api.post('/quote', { items });
    return response.data;
  },

  getQuickQuote: async (item: QuoteItem): Promise<QuoteResponse> => {
    const params = new URLSearchParams();
    params.append('firstCost', item.firstCost.toString());
    if (item.qty) params.append('qty', item.qty.toString());
    if (item.volumeFt3) params.append('volumeFt3', item.volumeFt3.toString());
    if (item.freightRatePerFt3) params.append('freightRatePerFt3', item.freightRatePerFt3.toString());
    if (item.applyUsSalesTax !== undefined) params.append('applyUsSalesTax', item.applyUsSalesTax.toString());

    const response = await api.get(`/quote?${params.toString()}`);
    return response.data;
  },

  extractProduct: async (url: string): Promise<ProductData> => {
    const response = await api.post('/extractProduct', { url });
    return response.data;
  },

  healthCheck: async () => {
    const response = await api.get('/health');
    return response.data;
  },
};