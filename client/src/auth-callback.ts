// Content script injected on the server's /auth/callback page.
// Reads Supabase tokens from the URL fragment and forwards them to the background service worker.
const hash = new URLSearchParams(window.location.hash.substring(1));
const access_token = hash.get('access_token');
const refresh_token = hash.get('refresh_token');
const expires_at = hash.get('expires_at');

if (access_token && refresh_token) {
  chrome.runtime.sendMessage({
    type: 'MAGIC_LINK_CALLBACK',
    payload: {
      access_token,
      refresh_token,
      expires_at: expires_at ? Number(expires_at) : Math.floor(Date.now() / 1000) + 3600,
    },
  });
}

export { };
