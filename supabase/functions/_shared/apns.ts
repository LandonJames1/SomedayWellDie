/* ==============================================================
   apns.ts — deliver a notification to Apple Push Notification service.

   Shared by send-reminders and send-message-push, which until now
   spoke only Web Push. Inside the Capacitor WKWebView there is no
   service worker and no Notification API — the page is served from the
   `capacitor://` scheme, and WKWebView gives a custom scheme neither —
   so every push the app sends today lands nowhere on the very platform
   it is being submitted to. Native devices register with APNs instead
   and store their token in push_subscriptions with platform='ios'.
   See supabase/native-push.sql.

   ---- Why there is no library here ----

   The same argument the geo function makes about its own imports: a
   cold start is the slowest request either caller ever makes, and this
   is 80 lines of Web Crypto. APNs authentication is a JWT signed
   ES256, and `crypto.subtle` signs ES256 directly — it even returns the
   raw r‖s pair that JWS wants, so there is no DER unwrapping to get
   wrong. Pulling in a JWT library to avoid writing base64url twice
   would cost more than it saves.

   ---- The token is cached, and that is not an optimisation ----

   Apple rate-limits provider token generation and will start rejecting
   a provider that mints a fresh one per push (TooManyProviderTokenUpdates).
   A token is good for an hour; this refreshes at 50 minutes. Module
   scope is the right lifetime — it lives as long as the isolate, which
   is exactly as long as the connection reuse it pairs with.

   Secrets (set with `supabase secrets set`):
     APNS_KEY_ID       the 10-character Key ID of the .p8
     APNS_TEAM_ID      your 10-character Apple Developer Team ID
     APNS_PRIVATE_KEY  the whole .p8 file, BEGIN/END lines included
     APNS_BUNDLE_ID    com.landonjames.somedaywelldie
     APNS_ENV          'production' (default) or 'sandbox'

   ⚠️ APNS_ENV is the one that will waste an afternoon. A build run
   from Xcode onto a device gets a SANDBOX token; TestFlight and the
   App Store get PRODUCTION ones. Sending a sandbox token to the
   production host answers 400 BadDeviceToken, which is
   indistinguishable from a genuinely dead token — so a debug build
   silently receives nothing and the row is pruned as though the user
   had uninstalled. Set APNS_ENV=sandbox while testing from Xcode.
   ============================================================== */

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlStr = (s: string) => b64url(new TextEncoder().encode(s));

export function apnsConfigured(): boolean {
  return !!(
    Deno.env.get('APNS_KEY_ID') &&
    Deno.env.get('APNS_TEAM_ID') &&
    Deno.env.get('APNS_PRIVATE_KEY') &&
    Deno.env.get('APNS_BUNDLE_ID')
  );
}

/* The .p8 Apple hands you is a PKCS#8 PEM. Strip the armour, decode,
   and import as an ECDSA P-256 signing key. */
async function importKey(): Promise<CryptoKey> {
  const pem = (Deno.env.get('APNS_PRIVATE_KEY') ?? '')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

let cachedToken = '';
let cachedAt = 0;
const TOKEN_TTL_MS = 50 * 60 * 1000;   /* Apple's limit is 60; refresh early. */

async function providerToken(): Promise<string> {
  if (cachedToken && Date.now() - cachedAt < TOKEN_TTL_MS) return cachedToken;

  const header = b64urlStr(JSON.stringify({
    alg: 'ES256',
    kid: Deno.env.get('APNS_KEY_ID'),
  }));
  const claims = b64urlStr(JSON.stringify({
    iss: Deno.env.get('APNS_TEAM_ID'),
    iat: Math.floor(Date.now() / 1000),
  }));

  const key = await importKey();
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );

  cachedToken = `${header}.${claims}.${b64url(new Uint8Array(sig))}`;
  cachedAt = Date.now();
  return cachedToken;
}

/* A reason that means the token is dead and the row should go. Anything
   else — a 500 from Apple, a throttle — is transient and the row is
   left alone, for the same reason send-reminders only prunes on 404/410
   rather than on any failure.

   DeviceTokenNotForTopic is in here because it is terminal for *us*:
   the token belongs to a different bundle id and never will not. */
const PRUNE = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic']);

export type ApnsResult = { ok: boolean; status: number; reason: string; prune: boolean };

export type ApnsPayload = {
  title: string;
  body: string;
  badge?: number;
  /* Collapses a run of notifications about one thing into one row in
     Notification Center, the way the grouped reminder payload already
     collapses five reminders into one banner. */
  threadId?: string;
  /* Everything the app reads on tap. Merged in beside `aps`, matching
     the flat shape sw.js already receives on the Web Push path. */
  data?: Record<string, unknown>;
};

export async function sendApns(deviceToken: string, p: ApnsPayload): Promise<ApnsResult> {
  const host = Deno.env.get('APNS_ENV') === 'sandbox'
    ? 'api.sandbox.push.apple.com'
    : 'api.push.apple.com';

  const body: Record<string, unknown> = {
    aps: {
      alert: { title: p.title, body: p.body },
      sound: 'default',
      ...(p.badge === undefined ? {} : { badge: p.badge }),
      ...(p.threadId ? { 'thread-id': p.threadId } : {}),
    },
    ...(p.data ?? {}),
  };

  try {
    const res = await fetch(`https://${host}/3/device/${deviceToken}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${await providerToken()}`,
        'apns-topic': Deno.env.get('APNS_BUNDLE_ID')!,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      /* APNs answers 200 with an empty body. Read it anyway so the
         connection is returned to the pool rather than left dangling
         for the isolate's lifetime. */
      await res.text();
      return { ok: true, status: res.status, reason: '', prune: false };
    }

    const text = await res.text();
    let reason = '';
    try { reason = JSON.parse(text)?.reason ?? ''; } catch { reason = text.slice(0, 200); }

    /* A provider token Apple has decided is stale: drop the cache so
       the next send mints a fresh one rather than failing identically
       for the next 50 minutes. */
    if (reason === 'ExpiredProviderToken' || reason === 'InvalidProviderToken') {
      cachedToken = '';
    }

    return { ok: false, status: res.status, reason, prune: PRUNE.has(reason) };
  } catch (e) {
    /* Could not reach Apple at all. Never a prune — the same
       distinction js/offline.js draws between "the server said no" and
       "there was no server". */
    return { ok: false, status: 0, reason: String(e), prune: false };
  }
}
