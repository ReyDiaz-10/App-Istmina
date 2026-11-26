type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  idempotencyKey: string;
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
let cachedAccessToken = "";
let tokenExpiresAt = 0;
let tokenRefresh: Promise<string> | null = null;

async function accessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) return cachedAccessToken;
  if (!tokenRefresh) {
    tokenRefresh = (async () => {
      const clientId = Deno.env.get("GMAIL_OAUTH_CLIENT_ID")?.trim();
      const clientSecret = Deno.env.get("GMAIL_OAUTH_CLIENT_SECRET")?.trim();
      const refreshToken = Deno.env.get("GMAIL_OAUTH_REFRESH_TOKEN")?.trim();
      if (!clientId || !clientSecret || !refreshToken) throw new Error("email_oauth_secrets_missing");
      let response: Response;
      try {
        response = await fetch(GOOGLE_TOKEN_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
          }),
          signal: AbortSignal.timeout(12_000),
        });
      } catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new Error("email_oauth_timeout");
        throw new Error("email_oauth_unreachable");
      }
      let result: { access_token?: string; expires_in?: number } = {};
      try { result = await response.json(); } catch { /* omit upstream body */ }
      if (!response.ok || !result.access_token) throw new Error("email_oauth_http_" + response.status);
      cachedAccessToken = result.access_token;
      tokenExpiresAt = Date.now() + Math.max(60, Number(result.expires_in) || 3600) * 1000;
      return cachedAccessToken;
    })().finally(() => { tokenRefresh = null; });
  }
  return await tokenRefresh;
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function encodeBase64Utf8(value: string) {
  return base64(new TextEncoder().encode(value)).replace(/.{1,76}/g, "$&\r\n").trim();
}

function base64Url(value: string) {
  return base64(new TextEncoder().encode(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeHeader(value: string) {
  return "=?UTF-8?B?" + base64(new TextEncoder().encode(value)) + "?=";
}

function buildRawMessage(message: EmailMessage, sender: string) {
  if (/[\r\n]/.test(message.to) || /[\r\n]/.test(message.subject)) throw new Error("email_header_invalid");
  const messageId = base64Url(message.idempotencyKey).slice(0, 48);
  const headers = [
    "From: IstmiYa Notificaciones <" + sender + ">",
    "To: " + message.to,
    "Subject: " + encodeHeader(message.subject),
    "Message-ID: <" + messageId + "@istmiya.local>",
    "MIME-Version: 1.0",
  ];
  if (message.html) {
    const boundary = "istmiya_" + messageId;
    return headers.concat([
      'Content-Type: multipart/alternative; boundary="' + boundary + '"',
      "",
      "--" + boundary,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      encodeBase64Utf8(message.text),
      "--" + boundary,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      encodeBase64Utf8(message.html),
      "--" + boundary + "--",
      "",
    ]).join("\r\n");
  }
  return headers.concat([
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeBase64Utf8(message.text),
  ]).join("\r\n");
}

export async function sendTransactionalEmail(message: EmailMessage): Promise<void> {
  const sender = (Deno.env.get("GMAIL_SENDER_EMAIL") || Deno.env.get("SMTP_USER") || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender)) throw new Error("email_sender_missing_or_invalid");
  let token = await accessToken();
  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(GMAIL_SEND_URL, {
        method: "POST",
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify({ raw: base64Url(buildRawMessage(message, sender)) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new Error("email_gmail_timeout");
      throw new Error("email_gmail_unreachable");
    }
    if (response.status !== 401 || attempt > 0) break;
    cachedAccessToken = "";
    tokenExpiresAt = 0;
    token = await accessToken(true);
  }
  if (!response) throw new Error("email_gmail_no_response");
  if (!response.ok) throw new Error("email_gmail_http_" + response.status);
}
