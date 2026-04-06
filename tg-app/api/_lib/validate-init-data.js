// Validate Telegram initData using HMAC-SHA256
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

import { createHmac } from 'crypto';

export function validateInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    params.delete('hash');

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = createHmac('sha256', 'WebAppData')
      .update(botToken).digest();

    const checkHash = createHmac('sha256', secretKey)
      .update(dataCheckString).digest('hex');

    if (checkHash !== hash) return null;

    // Valid — extract user
    const userStr = params.get('user');
    if (!userStr) return null;
    return JSON.parse(userStr);
  } catch {
    return null;
  }
}

// Fallback: extract user without validation (for development/testing)
export function extractUser(initData) {
  if (!initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const userStr = params.get('user');
    if (!userStr) return null;
    return JSON.parse(userStr);
  } catch {
    return null;
  }
}

// Smart auth: validate HMAC if BOT_TOKEN is set, otherwise fallback
export function authenticateUser(initData, botToken) {
  if (botToken) {
    const user = validateInitData(initData, botToken);
    if (user) return user;
  }
  // Fallback for development
  return extractUser(initData);
}
