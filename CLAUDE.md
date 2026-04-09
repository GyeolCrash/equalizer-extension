# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome Extension (Manifest V3) for advanced audio manipulation (EQ, Compressor) with a subscription backend.

- **Client**: TypeScript + Vite, Web Audio API, Manifest V3
- **Server**: Node.js + Express 5, Firestore, Polar.sh payments — deployed to Google Cloud Run
- **Auth**: Google OAuth2 via `chrome.identity` → backend issues JWTs
- **Payment**: Polar.sh webhooks sync subscription status to Firestore
- **CORS:** Only accepts requests from the extension origin (`chrome-extension://{EXTENSION_ID}`).
- **Rate limiting:** 20 requests per 15 minutes per IP.

## Key Constraints

- **Windows 11** environment — use Windows-compatible commands in scripts.
- **No source maps in production** builds.
- **Obfuscation** (`npm run obfuscate`) must run after every production build.
- Background service worker must never access DOM or Web Audio API.
- All API endpoints must be idempotent.
- Use Zod for all request validation before database operations.
- Server is stateless — must be scale-to-zero compatible.
- Respond to users in **Korean**; code comments and technical docs in **English**.
- Must not access to **.env**, this rule is no exception.
- 