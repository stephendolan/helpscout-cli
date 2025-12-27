import { Entry } from '@napi-rs/keyring';
import { config } from './config.js';

const SERVICE_NAME = 'helpscout-cli';
const ACCESS_TOKEN_ACCOUNT = 'access-token';
const REFRESH_TOKEN_ACCOUNT = 'refresh-token';
const APP_ID_ACCOUNT = 'app-id';
const APP_SECRET_ACCOUNT = 'app-secret';

const KEYRING_UNAVAILABLE_ERROR =
  'Keychain storage unavailable. Cannot store credentials securely.\n' +
  'On Linux, install libsecret: sudo apt-get install libsecret-1-dev\n' +
  'Then reinstall: bun install -g @stephendolan/helpscout-cli\n' +
  'Alternatively, use HELPSCOUT_APP_ID and HELPSCOUT_APP_SECRET environment variables.';

const keyringCache = new Map<string, Entry | null>();

function getKeyring(account: string): Entry | null {
  if (keyringCache.has(account)) {
    return keyringCache.get(account)!;
  }
  try {
    const entry = new Entry(SERVICE_NAME, account);
    keyringCache.set(account, entry);
    return entry;
  } catch {
    keyringCache.set(account, null);
    return null;
  }
}

async function getPassword(account: string): Promise<string | null> {
  const entry = getKeyring(account);
  if (entry) {
    try {
      return entry.getPassword();
    } catch {
      return null;
    }
  }
  return null;
}

async function setPassword(account: string, value: string): Promise<void> {
  const entry = getKeyring(account);
  if (!entry) {
    throw new Error(KEYRING_UNAVAILABLE_ERROR);
  }
  entry.setPassword(value);
}

async function deletePassword(account: string): Promise<boolean> {
  const entry = getKeyring(account);
  if (entry) {
    return entry.deletePassword();
  }
  return false;
}

export class AuthManager {
  async getAccessToken(): Promise<string | null> {
    return getPassword(ACCESS_TOKEN_ACCOUNT);
  }

  async setAccessToken(token: string): Promise<void> {
    return setPassword(ACCESS_TOKEN_ACCOUNT, token);
  }

  async getRefreshToken(): Promise<string | null> {
    return getPassword(REFRESH_TOKEN_ACCOUNT);
  }

  async setRefreshToken(token: string): Promise<void> {
    return setPassword(REFRESH_TOKEN_ACCOUNT, token);
  }

  async getAppId(): Promise<string | null> {
    const keychainValue = await getPassword(APP_ID_ACCOUNT);
    return keychainValue || process.env.HELPSCOUT_APP_ID || null;
  }

  async setAppId(appId: string): Promise<void> {
    return setPassword(APP_ID_ACCOUNT, appId);
  }

  async getAppSecret(): Promise<string | null> {
    const keychainValue = await getPassword(APP_SECRET_ACCOUNT);
    return keychainValue || process.env.HELPSCOUT_APP_SECRET || null;
  }

  async setAppSecret(appSecret: string): Promise<void> {
    return setPassword(APP_SECRET_ACCOUNT, appSecret);
  }

  async isAuthenticated(): Promise<boolean> {
    return (await this.getAccessToken()) !== null;
  }

  async logout(): Promise<void> {
    await deletePassword(ACCESS_TOKEN_ACCOUNT);
    await deletePassword(REFRESH_TOKEN_ACCOUNT);
    config.clearDefaultMailbox();
  }

  async clearAll(): Promise<void> {
    await deletePassword(ACCESS_TOKEN_ACCOUNT);
    await deletePassword(REFRESH_TOKEN_ACCOUNT);
    await deletePassword(APP_ID_ACCOUNT);
    await deletePassword(APP_SECRET_ACCOUNT);
    config.clear();
  }
}

export const auth = new AuthManager();
