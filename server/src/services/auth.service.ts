import { OAuth2Client, TokenPayload } from 'google-auth-library';
import pino from 'pino';

const logger = pino();
const client = new OAuth2Client();

export class AuthService {
  /**
   * Verifies the Google ID Token provided by the Chrome Extension.
   * Extracts and validates the 'sub', 'email', and 'name' claims.
   * @param idToken The raw ID token from chrome.identity
   * @returns Validated token payload
   */
  static async verifyGoogleToken(idToken: string): Promise<TokenPayload> {
    try {
      const ticket = await client.verifyIdToken({
        idToken,
        // The audience should match the Chrome Extension's OAuth client ID
        // In Cloud Run, we should load this from env variables.
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      
      if (!payload) {
        throw new Error('Invalid token payload');
      }

      // Check claims
      if (!payload.sub || !payload.email) {
        throw new Error('Token is missing required claims (sub, email)');
      }

      return payload;
    } catch (error) {
      logger.error({ err: error }, 'Google token verification failed');
      throw new Error('Authentication failed: Invalid Google ID Token');
    }
  }
}
