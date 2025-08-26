import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useSubmit, useNavigation } from "@remix-run/react";
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
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  
  const formData = await request.formData();
  const urls = formData.get("urls") as string;
  
  if (!urls) {
    return json({ error: "Please provide product URLs" }, { status: 400 });
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
          });
        } else {
          extractedProducts.push({
            url: url.trim(),
            error: 'Failed to extract product data',
            title: 'Unknown Product',
            price: 0,
            image: '',
            quantity: 1,
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

  const isLoading = navigation.state === "submitting";

  const handleSubmit = () => {
    submit({ urls }, { method: "post" });
  };

  const handleNextStep = () => {
    if (currentStep === 'input' && actionData?.success) {
      setCurrentStep('review');
    }
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
                    <Button onClick={handleNextStep} variant="primary">
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
        backAction={{ onAction: () => setCurrentStep('input') }}
        primaryAction={{
          content: "Continue to Price Verification →",
          onAction: () => setCurrentStep('verify'),
        }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Extracted Products
                </Text>
                
                {actionData?.products?.map((product: any, index: number) => (
                  <Card key={index}>
                    <InlineStack gap="400" align="start">
                      {product.image && (
                        <img 
                          src={product.image} 
                          alt={product.title}
                          style={{ width: '80px', height: '80px', objectFit: 'cover' }}
                        />
                      )}
                      <BlockStack gap="200">
                        <Text variant="headingSm" as="h3">
                          {product.title || 'Unknown Product'}
                        </Text>
                        <Text variant="bodyMd">
                          Price: ${product.price || 0}
                        </Text>
                        <Text variant="bodyMd" color="subdued">
                          Quantity: {product.quantity}
                        </Text>
                        {product.error && (
                          <Text variant="bodyMd" color="critical">
                            Error: {product.error}
                          </Text>
                        )}
                      </BlockStack>
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

  // Placeholder for other steps
  return (
    <Page title="SDL Instant Import Quote">
      <Layout>
        <Layout.Section>
          <Card>
            <Text variant="headingMd" as="h2">
              Step {currentStep === 'verify' ? '3: Price Verification' : '4: Final Breakdown'}
            </Text>
            <Text variant="bodyMd">
              This step is under development.
            </Text>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}