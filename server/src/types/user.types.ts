export type SubscriptionStatus = 'active' | 'expired' | 'canceled' | 'none';
export type PlanType = 'free' | 'pro' | 'premium';
export type PaymentProvider = 'polar' | 'none';

export interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  subscription_status: SubscriptionStatus;
  plan_type: PlanType;
  current_period_end: string | null;
  payment_provider: PaymentProvider;
  provider_customer_id: string;
  provider_subscription_id: string;
  client_settings?: Record<string, any>;
  last_sync_version?: number;
  last_sync_id?: string;
  created_at: string;
  updated_at: string;
}

export interface UserCreateData {
  email: string;
  display_name: string;
}
