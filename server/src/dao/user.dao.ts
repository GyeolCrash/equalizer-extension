import { supabase } from '../config/supabase.config.ts';
import { UserProfile, UserCreateData } from '../types/user.types.ts';
import logger from '../logger.ts';

export class UserDAO {
  /**
   * Retrieves user profile by Supabase Auth UUID.
   */
  static async getUserById(userId: string): Promise<UserProfile | null> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Row not found
      logger.error({ err: error }, 'Error fetching user from Supabase');
      throw error;
    }
    return data as UserProfile;
  }

  /**
   * Creates a new user row with 'free' plan and 'none' subscription status.
   * The id must match the corresponding Supabase Auth user UUID.
   */
  static async createUserProfile(userId: string, userData: UserCreateData): Promise<UserProfile> {
    const now = new Date().toISOString();
    const newUser = {
      id: userId,
      email: userData.email,
      display_name: userData.display_name,
      subscription_status: 'none' as const,
      plan_type: 'free' as const,
      current_period_end: null,
      payment_provider: 'none' as const,
      provider_customer_id: '',
      provider_subscription_id: '',
      created_at: now,
      updated_at: now,
    };

    const { data, error } = await supabase
      .from('users')
      .insert(newUser)
      .select()
      .single();

    if (error) {
      logger.error({ err: error }, 'Error creating user in Supabase');
      throw error;
    }
    return data as UserProfile;
  }

  /**
   * Updates subscription fields. Called by the Polar webhook handler.
   */
  static async updateSubscriptionStatus(userId: string, statusData: Partial<UserProfile>): Promise<void> {
    const { error } = await supabase
      .from('users')
      .update({ ...statusData, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (error) {
      logger.error({ err: error, userId }, 'Error updating subscription in Supabase');
      throw error;
    }
    logger.info({ userId }, 'Successfully updated user subscription status');
  }
}
