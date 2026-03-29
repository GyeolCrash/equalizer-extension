import { db } from '../config/firebase.config.js';
import { UserProfile, UserCreateData } from '../types/user.types.js';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import logger from '../logger.js';
const userCollection = db.collection('users');

export class UserDAO {
  /**
   * Retrieves user profile by Google User ID (sub claim).
   */
  static async getUserById(googleUserId: string): Promise<UserProfile | null> {
    try {
      const userDoc = await userCollection.doc(googleUserId).get();
      if (!userDoc.exists) {
        return null;
      }
      return { id: userDoc.id, ...userDoc.data() } as UserProfile;
    } catch (error: any) {
      logger.error({ err: error }, 'Error fetching user from Firestore');
      throw error;
    }
  }

  /**
   * Creates a new user entry with 'free' plan and 'none' subscription status.
   */
  static async createUserProfile(googleUserId: string, userData: UserCreateData): Promise<UserProfile> {
    try {
      const now = FieldValue.serverTimestamp();
      const newUser: Omit<UserProfile, 'id'> = {
        email: userData.email,
        display_name: userData.display_name,
        subscription_status: 'none',
        plan_type: 'free',
        current_period_end: Timestamp.now(), // Use current time as default expiration
        payment_provider: 'none',
        provider_customer_id: '',
        provider_subscription_id: '',
        created_at: now,
        updated_at: now,
      };

      await userCollection.doc(googleUserId).set(newUser);

      return { id: googleUserId, ...newUser } as UserProfile;
    } catch (error: any) {
      logger.error({ err: error }, 'Error creating user in Firestore');
      throw error;
    }
  }

  /**
   * Updates subscription status and plan type.
   */
  static async updateSubscriptionStatus(googleUserId: string, statusData: Partial<UserProfile>): Promise<void> {
    try {
      const updatePayload = {
        ...statusData,
        updated_at: FieldValue.serverTimestamp(),
      };
      await userCollection.doc(googleUserId).update(updatePayload);
      logger.info({ googleUserId }, 'Successfully updated user subscription status');
    } catch (error: any) {
      logger.error({ err: error, googleUserId }, 'Error updating user subscription in Firestore');
      throw error;
    }
  }
}
