import { Timestamp, FieldValue } from 'firebase-admin/firestore';

export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'none';
export type PlanType = 'free' | 'pro' | 'premium';
export type PaymentProvider = 'stripe' | 'paddle' | 'lemon_squeezy' | 'none';

export interface UserProfile {
  id: string; // Document ID (google_user_id)
  email: string;
  display_name: string;
  subscription_status: SubscriptionStatus;
  plan_type: PlanType;
  current_period_end: Timestamp | Date;
  payment_provider: PaymentProvider;
  provider_customer_id: string;
  provider_subscription_id: string;
  client_settings?: Record<string, any>;
  last_sync_version?: number;
  last_sync_id?: string;
  created_at: Timestamp | FieldValue;
  updated_at: Timestamp | FieldValue;
}

export interface UserCreateData {
  email: string;
  display_name: string;
}
