import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useSubmit, useNavigation, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Button,
  TextField,
  Banner,
  List,
  Text,
  BlockStack,
  InlineStack,
  DataTable,
  Thumbnail,
  Badge,
  Select,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { calculateImportCosts, type ImportItem } from "../lib/import-calculator";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  
  const formData = await request.formData();
  const urls = formData.get("urls") as string;
  const action = formData.get("action") as string;
  const productsData = formData.get("productsData") as string;
  
  if (action === "extract" && !urls) {
    return json({ error: "Please provide product URLs" }, { status: 400 });
  }

  if (action === "calculate" && productsData) {
    try {
      const products = JSON.parse(productsData);
      const importItems: ImportItem[] = products.map((p: any) => ({
        title: p.title,
        price: p.price,
        quantity: p.quantity || 1,
        volume: p.volume || 11.33, // default volume
      }));
      
      const calculation = calculateImportCosts(importItems);
      
      return json({
        success: true,
        calculation,
        step: 'breakdown'
      });
    } catch (error) {
      return json({ error: "Failed to calculate costs" }, { status: 500 });
    }
  }
  try {
    // Split URLs and extract products
    const urlList = urls.split('\n').filter(url => url.trim());
    const extractedProducts = [];
    
    for (const url of urlList) {
      try {
        // Call your existing backend API
        const response = await fetch(`${process.env.BACKEND_API_URL}/extractProduct`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url: url.trim() }),
        });
        
        if (response.ok) {
          const productData = await response.json();
          extractedProducts.push({
            url: url.trim(),
            ...productData,
            quantity: 1, // default quantity
            volume: 11.33, // default volume in ft³
          });
        } else {
          extractedProducts.push({
            url: url.trim(),
            error: 'Failed to extract product data',
            title: 'Unknown Product',
            price: 0,
            image: '',
            quantity: 1,
            volume: 11.33,
          });
        }
      } catch (error) {
        extractedProducts.push({
          url: url.trim(),
          error: 'Network error',
          title: 'Unknown Product',
          price: 0,
          image: '',
          quantity: 1,
          volume: 11.33,
        });
      }
    }
    
    return json({ 
      success: true, 
      products: extractedProducts,
      step: 'review' 
    });
    
  } catch (error) {
    return json({ error: "Failed to process URLs" }, { status: 500 });
  }
};

export default function Index() {
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [urls, setUrls] = useState("");
  const [currentStep, setCurrentStep] = useState<'input' | 'review' | 'verify' | 'breakdown'>('input');
  const [products, setProducts] = useState<any[]>([]);
  const [verifiedProducts, setVerifiedProducts] = useState<any[]>([]);

  const isLoading = navigation.state === "submitting";

  const handleSubmit = () => {
    submit({ urls, action: "extract" }, { method: "post" });
  };

  const handleNextStep = (step?: string) => {
    if (step) {
      setCurrentStep(step as any);
    } else if (currentStep === 'input' && actionData?.success) {
      setCurrentStep('review');
      setProducts(actionData.products || []);
    } else if (currentStep === 'review') {
      setCurrentStep('verify');
      setVerifiedProducts(products);
    } else if (currentStep === 'verify') {
      // Calculate final costs
      submit({ 
        action: "calculate", 
        productsData: JSON.stringify(verifiedProducts) 
      }, { method: "post" });
    }
  };

  const updateProductQuantity = (index: number, quantity: number) => {
    const updated = [...products];
    updated[index].quantity = quantity;
    setProducts(updated);
  };

  const removeProduct = (index: number) => {
    const updated = products.filter((_, i) => i !== index);
    setProducts(updated);
  };

  const updateVerifiedPrice = (index: number, price: number) => {
    const updated = [...verifiedProducts];
    updated[index].price = price;
    setVerifiedProducts(updated);
  };
  // Step 1: URL Input Page
  if (currentStep === 'input') {
    return (
      <Page
        title="SDL Instant Import Quote"
        subtitle="Step 1: Paste Product URLs"
        primaryAction={{
          content: "Extract Products",
          onAction: handleSubmit,
          loading: isLoading,
          disabled: !urls.trim(),
        }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Product URLs
                </Text>
                <Text variant="bodyMd" color="subdued">
                  Paste product URLs from Wayfair, Amazon, or other retailers. One URL per line.
                </Text>
                <TextField
                  label="Product URLs"
                  value={urls}
                  onChange={setUrls}
                  multiline={6}
                  placeholder={`https://www.wayfair.com/furniture/pdp/...
https://www.amazon.com/dp/...
https://www.overstock.com/...`}
                  helpText="Enter one URL per line"
                  autoComplete="off"
                />
                
                {actionData?.error && (
                  <Banner status="critical">
                    <p>{actionData.error}</p>
                  </Banner>
                )}
                
                {actionData?.success && (
                  <Banner status="success" onDismiss={() => {}}>
                    <p>Successfully extracted {actionData.products?.length} products!</p>
                    <Button onClick={() => handleNextStep()} variant="primary">
                      Review Products →
                    </Button>
                  </Banner>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
          
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  How it works
                </Text>
                <List type="number">
                  <List.Item>Paste product URLs</List.Item>
                  <List.Item>Review extracted products</List.Item>
                  <List.Item>Verify prices</List.Item>
                  <List.Item>Get final cost breakdown</List.Item>
                </List>
                
                <Text variant="bodyMd" color="subdued">
                  We'll extract product information and calculate:
                </Text>
                <List>
                  <List.Item>First cost</List.Item>
                  <List.Item>Customs cost (26.5%)</List.Item>
                  <List.Item>Delivery to NJ</List.Item>
                  <List.Item>Entry fees ($8/item)</List.Item>
                  <List.Item>Shipping & handling</List.Item>
                </List>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  // Step 2: Review Page (placeholder for now)
  if (currentStep === 'review') {
    return (
      <Page
        title="SDL Instant Import Quote"
        subtitle="Step 2: Review Products"
        backAction={{ onAction: () => handleNextStep('input') }}
        primaryAction={{
          content: "Continue to Price Verification →",
          onAction: () => handleNextStep(),
        }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Review & Edit Products
                </Text>
                
                {products.map((product: any, index: number) => (
                  <Card key={index}>
                    <BlockStack gap="400">
                      <InlineStack gap="400" align="start">
                        {product.image && (
                          <Thumbnail
                            source={product.image}
                            alt={product.title}
                            size="large"
                          />
                        )}
                        <BlockStack gap="200">
                          <Text variant="headingSm" as="h3">
                            {product.title || 'Unknown Product'}
                          </Text>
                          <Text variant="bodyMd">
                            Price: ${product.price || 0}
                          </Text>
                          {product.error && (
                            <Badge tone="critical">Error: {product.error}</Badge>
                          )}
                        </BlockStack>
                      </InlineStack>
                      
                      <InlineStack gap="400" align="end">
                        <div style={{ width: '100px' }}>
                          <TextField
                            label="Quantity"
                            type="number"
                            value={product.quantity.toString()}
                            onChange={(value) => updateProductQuantity(index, parseInt(value) || 1)}
                            min={1}
                            autoComplete="off"
                          />
                        </div>
                        <Button 
                          variant="primary" 
                          tone="critical"
                          onClick={() => removeProduct(index)}
                        >
                          Remove
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                ))}
                
                <InlineStack gap="400" align="end">
                  <Text variant="headingMd" as="h3">
                    Total Items: {products.length}
                  </Text>
                  <Text variant="headingMd" as="h3">
                    Total Value: ${products.reduce((sum, p) => sum + (p.price * p.quantity), 0).toFixed(2)}
                  </Text>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  // Step 3: Price Verification Page
  if (currentStep === 'verify') {
    return (
      <Page
        title="SDL Instant Import Quote"
        subtitle="Step 3: Verify Prices"
        backAction={{ onAction: () => handleNextStep('review') }}
        primaryAction={{
          content: "Calculate Final Costs →",
          onAction: () => handleNextStep(),
        }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Double-Check Scraped Prices
                </Text>
                <Text variant="bodyMd" color="subdued">
                  Please verify these prices are correct before we calculate your final import costs.
                  All items will be delivered to: <strong>6 Progress Street, Elizabeth, NJ 07201</strong>
                </Text>
                
                {verifiedProducts.map((product: any, index: number) => (
                  <Card key={index}>
                    <InlineStack gap="400" align="start">
                      {product.image && (
                        <Thumbnail
                          source={product.image}
                          alt={product.title}
                          size="large"
                        />
                      )}
                      <BlockStack gap="200">
                        <Text variant="headingSm" as="h3">
                          {product.title}
                        </Text>
                        <Text variant="bodyMd" color="subdued">
                          Quantity: {product.quantity}
                        </Text>
                      </BlockStack>
                      <div style={{ width: '150px' }}>
                        <TextField
                          label="Price per item"
                          type="number"
                          value={product.price.toString()}
                          onChange={(value) => updateVerifiedPrice(index, parseFloat(value) || 0)}
                          prefix="$"
                          step={0.01}
                          autoComplete="off"
                        />
                      </div>
                    </InlineStack>
                  </Card>
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  // Step 4: Final Cost Breakdown
  if (currentStep === 'breakdown' && actionData?.calculation) {
    const calc = actionData.calculation;
    
    return (
      <Page
        title="SDL Instant Import Quote"
        subtitle="Step 4: Final Cost Breakdown"
        backAction={{ onAction: () => handleNextStep('verify') }}
        primaryAction={{
          content: "Start Over",
          onAction: () => {
            setCurrentStep('input');
            setProducts([]);
            setVerifiedProducts([]);
            setUrls('');
          },
        }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="600">
                <Text variant="headingLg" as="h2">
                  Import Cost Breakdown
                </Text>
                
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
                  gap: '16px' 
                }}>
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="headingSm" color="subdued">First Cost</Text>
                      <Text variant="headingLg">${calc.breakdown.firstCost.toFixed(2)}</Text>
                    </BlockStack>
                  </Card>
                  
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="headingSm" color="subdued">Customs Cost (26.5%)</Text>
                      <Text variant="headingLg">${calc.breakdown.customsCost.toFixed(2)}</Text>
                    </BlockStack>
                  </Card>
                  
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="headingSm" color="subdued">USA to NJ Delivery</Text>
                      <Text variant="headingLg">${calc.breakdown.deliveryCost.toFixed(2)}</Text>
                    </BlockStack>
                  </Card>
                  
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="headingSm" color="subdued">Entry Fees ({calc.totalItems} items)</Text>
                      <Text variant="headingLg">${calc.breakdown.entryFees.toFixed(2)}</Text>
                    </BlockStack>
                  </Card>
                  
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="headingSm" color="subdued">Shipping & Handling</Text>
                      <Text variant="headingLg">${calc.breakdown.shippingHandling.toFixed(2)}</Text>
                    </BlockStack>
                  </Card>
                </div>
                
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingLg" as="h3">
                      Total Import Cost: ${calc.breakdown.total.toFixed(2)}
                    </Text>
                    <Text variant="bodyMd" color="subdued">
                      Total Volume: {calc.totalVolume.toFixed(2)} ft³ | 
                      Container Utilization: {((calc.totalVolume / 1165) * 100).toFixed(1)}%
                    </Text>
                  </BlockStack>
                </Card>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page title="Loading...">
      <Layout>
        <Layout.Section>
          <Card>
            <Text variant="bodyMd">Processing...</Text>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}