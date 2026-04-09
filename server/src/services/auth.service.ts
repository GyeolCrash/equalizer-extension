import { supabase } from '../config/supabase.config.js';
import logger from '../logger.js';

export class AuthService {
  /**
   * Verifies a Supabase access token issued after the client completes Supabase OAuth.
   * Uses the service-role Supabase client to validate and extract user claims.
   * @param accessToken The Supabase JWT from the client's auth session
   */
  static async verifySupabaseToken(accessToken: string): Promise<{ sub: string; email: string; name: string }> {
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);

    if (error || !user || !user.email) {
      logger.error({ err: error }, 'Supabase token verification failed');
      throw new Error('Authentication failed: Invalid Supabase Access Token');
    }

    return {
      sub: user.id,
      email: user.email,
      name: (user.user_metadata?.full_name as string | undefined) ?? user.email.split('@')[0],
    };
  }
}
