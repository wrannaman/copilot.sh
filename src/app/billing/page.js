'use client';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast-provider';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CheckCircle } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { AuthGuard } from '@/components/auth-guard';
import { AuthenticatedNav } from '@/components/layout/authenticated-nav';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function BillingPageContent() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [prices, setPrices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchPrices() {
      try {
        const response = await fetch(`${API_URL}/billing/prices`);
        if (!response.ok) {
          // throw new Error('Failed to fetch prices.');
        }
        const data = await response.json();
        const normalized = Array.isArray(data)
          ? data
          : (Array.isArray(data?.prices) ? data.prices : []);
        setPrices(normalized);
      } catch (err) {
        setError(err.message);
        toast.error('Error', {
          description: err.message,
        });
      } finally {
        setIsLoading(false);
      }
    }
    fetchPrices();
  }, [toast]);

  const handleSubscribe = async (priceId) => {
    if (!user || !user.org || !user.org.id) {
      toast.error('Error', {
        description: 'Organization ID not found.',
      });
      return;
    }

    try {
      const response = await fetch(`${API_URL}/billing/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId: priceId, OrgId: user.org.id }),
      });
      const session = await response.json();
      if (session.url) {
        window.location.href = session.url;
      }
    } catch (err) {
      toast.error('Error', {
        description: 'Could not initiate subscription. Please try again.',
      });
    }
  };

  const handleManageSubscription = async () => {
    if (!user || !user.org || !user.org.stripe_customer_id) {
      toast.error('Error', {
        description: 'Stripe customer ID not found.',
      });
      return;
    }
    try {
      const response = await fetch(`${API_URL}/billing/customer-portal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: user.org.stripe_customer_id }),
      });
      const portalSession = await response.json();
      if (portalSession.url) {
        window.location.href = portalSession.url;
      }
    } catch (err) {
      toast.error('Error', {
        description: 'Could not open customer portal. Please try again.',
      });
    }
  };


  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-4">Billing</h1>
      <Button onClick={handleManageSubscription} className="mb-8">Manage Subscription</Button>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {(Array.isArray(prices) ? prices : []).map((price) => (
          <Card key={price.id}>
            <CardHeader>
              <CardTitle>{price.name}</CardTitle>
              <CardDescription>{price.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold">
                ${price.price}
                <span className="text-sm font-normal">/{price.interval}</span>
              </div>
              <ul className="mt-4 space-y-2">
                {(Array.isArray(price.features) ? price.features : []).map((feature, index) => (
                  <li key={index} className="flex items-center">
                    <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Button onClick={() => handleSubscribe(price.id)} className="w-full mt-6">
                Subscribe
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <AuthGuard>
      <div className="min-h-screen bg-background">
        <AuthenticatedNav />
        <main className="container mx-auto p-6 space-y-6">
          <BillingPageContent />
        </main>
      </div>
    </AuthGuard>
  )
} 