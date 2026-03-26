import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || 8080,
  jwtSecret: process.env.JWT_SECRET || 'gc-audio-secret',
  googleClientId: process.env.GOOGLE_CLIENT_ID || 'gc-audio-client',
  extensionId: process.env.EXTENSION_ID || 'gc-audio-extension',
};
export default config;
