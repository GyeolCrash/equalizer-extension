import { OAuth2Client, TokenPayload } from 'google-auth-library';
import logger from '../logger.js';
import config from '../config/env.js';
const client = new OAuth2Client(config.googleClientId);

export class AuthService {
  /**
   * Verifies the Google OAuth2 Access Token provided by the Chrome Extension.
   * Extracts and validates the 'sub' and 'email' claims.
   * @param accessToken The raw access token from chrome.identity
   * @returns Validated token payload
   */
  static async verifyGoogleToken(accessToken: string): Promise<TokenPayload> {
    try {
      const tokenInfo = await client.getTokenInfo(accessToken);

      // Check claims
      if (!tokenInfo.sub || !tokenInfo.email) {
        throw new Error('Token is missing required claims (sub, email)');
      }

      // Map the returned TokenInfo back to a TokenPayload-like structure 
      // (as it is used elsewhere in the controller)
      return {
        sub: tokenInfo.sub,
        email: tokenInfo.email,
        name: tokenInfo.email.split('@')[0],
        aud: tokenInfo.aud,
        exp: tokenInfo.expiry_date || 0,
      } as unknown as TokenPayload;

    } catch (error) {
      logger.error({ err: error }, 'Google token verification failed');
      throw new Error('Authentication failed: Invalid Google Access Token');
    }
  }
}
