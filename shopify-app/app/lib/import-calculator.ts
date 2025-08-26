// Import cost calculation logic
export interface ImportItem {
  title: string;
  price: number;
  quantity: number;
  dimensions?: {
    length: number;
    width: number;
    height: number;
  };
  volume?: number; // cubic feet
}

export interface CostBreakdown {
  firstCost: number;
  customsCost: number; // 26.5% duty
  deliveryCost: number;
  entryFees: number; // $8 per item
  shippingHandling: number; // our profit margin
  total: number;
}

export interface ImportCalculation {
  items: ImportItem[];
  breakdown: CostBreakdown;
  totalItems: number;
  totalVolume: number;
}

// Constants
const CUSTOMS_DUTY_RATE = 0.265; // 26.5%
const ENTRY_FEE_PER_ITEM = 8; // $8 per item
const CONTAINER_COST = 6000; // $6,000 for 20ft container
const CONTAINER_VOLUME_FT3 = 1165; // 20ft container volume in cubic feet
const DEFAULT_VOLUME_FT3 = 11.33; // fallback volume

// Dynamic margin structure based on item value and size
export function calculateProfitMargin(itemValue: number, volume: number): number {
  let baseMargin = 0.4; // 40% base margin
  
  // Adjust based on item value (higher value = lower margin)
  if (itemValue > 5000) {
    baseMargin = 0.15; // 15% for very high value items
  } else if (itemValue > 3000) {
    baseMargin = 0.20; // 20% for high value items
  } else if (itemValue > 1000) {
    baseMargin = 0.25; // 25% for medium value items
  } else if (itemValue > 500) {
    baseMargin = 0.30; // 30% for medium-low value items
  }
  
  // Adjust based on volume (larger items = lower margin)
  if (volume > 50) {
    baseMargin = Math.min(baseMargin, 0.20); // Max 20% for very large items
  } else if (volume > 20) {
    baseMargin = Math.min(baseMargin, 0.25); // Max 25% for large items
  }
  
  return baseMargin;
}

export function calculateImportCosts(items: ImportItem[]): ImportCalculation {
  let totalFirstCost = 0;
  let totalVolume = 0;
  let totalItems = items.length;
  
  // Calculate totals
  items.forEach(item => {
    const itemCost = item.price * item.quantity;
    totalFirstCost += itemCost;
    
    // Use provided volume or calculate from dimensions or use default
    let itemVolume = item.volume || DEFAULT_VOLUME_FT3;
    if (!item.volume && item.dimensions) {
      // Convert dimensions to cubic feet (assuming dimensions are in inches)
      itemVolume = (item.dimensions.length * item.dimensions.width * item.dimensions.height) / 1728;
    }
    totalVolume += itemVolume * item.quantity;
  });
  
  // Calculate costs
  const customsCost = totalFirstCost * CUSTOMS_DUTY_RATE;
  const entryFees = totalItems * ENTRY_FEE_PER_ITEM;
  
  // Calculate delivery cost based on container utilization
  const containerUtilization = totalVolume / CONTAINER_VOLUME_FT3;
  const deliveryCost = CONTAINER_COST * containerUtilization;
  
  // Calculate shipping & handling (our profit margin)
  let totalShippingHandling = 0;
  items.forEach(item => {
    const itemValue = item.price * item.quantity;
    const itemVolume = item.volume || DEFAULT_VOLUME_FT3;
    const marginRate = calculateProfitMargin(item.price, itemVolume);
    
    // Apply margin to the landed cost of this item
    const itemCustomsCost = itemValue * CUSTOMS_DUTY_RATE;
    const itemDeliveryCost = deliveryCost * (itemVolume * item.quantity / totalVolume);
    const itemEntryFee = ENTRY_FEE_PER_ITEM;
    const itemLandedCost = itemValue + itemCustomsCost + itemDeliveryCost + itemEntryFee;
    
    totalShippingHandling += itemLandedCost * marginRate;
  });
  
  const breakdown: CostBreakdown = {
    firstCost: totalFirstCost,
    customsCost,
    deliveryCost,
    entryFees,
    shippingHandling: totalShippingHandling,
    total: totalFirstCost + customsCost + deliveryCost + entryFees + totalShippingHandling,
  };
  
  return {
    items,
    breakdown,
    totalItems,
    totalVolume,
  };
}

// Helper function to estimate dimensions for similar products
export function estimateProductDimensions(title: string, price: number): { length: number; width: number; height: number } {
  // This is a simplified estimation - in reality, you'd want a more sophisticated system
  // Based on product category keywords and price ranges
  
  const titleLower = title.toLowerCase();
  
  // Furniture categories
  if (titleLower.includes('sofa') || titleLower.includes('couch')) {
    return { length: 84, width: 36, height: 32 }; // inches
  }
  if (titleLower.includes('chair')) {
    return { length: 30, width: 30, height: 32 };
  }
  if (titleLower.includes('table')) {
    if (titleLower.includes('dining')) {
      return { length: 72, width: 36, height: 30 };
    }
    return { length: 48, width: 24, height: 30 };
  }
  if (titleLower.includes('bed')) {
    if (titleLower.includes('king')) {
      return { length: 80, width: 76, height: 14 };
    }
    if (titleLower.includes('queen')) {
      return { length: 80, width: 60, height: 14 };
    }
    return { length: 75, width: 54, height: 14 }; // full/twin
  }
  if (titleLower.includes('dresser') || titleLower.includes('cabinet')) {
    return { length: 60, width: 18, height: 32 };
  }
  
  // Default based on price (rough estimation)
  if (price > 2000) {
    return { length: 60, width: 30, height: 30 }; // Large item
  }
  if (price > 500) {
    return { length: 36, width: 24, height: 24 }; // Medium item
  }
  
  return { length: 24, width: 18, height: 12 }; // Small item
}