import { Entry } from '@napi-rs/keyring';
import { config } from './config.js';

const SERVICE_NAME = 'helpscout-cli';
const ACCESS_TOKEN_ACCOUNT = 'access-token';
const REFRESH_TOKEN_ACCOUNT = 'refresh-token';
const APP_ID_ACCOUNT = 'app-id';
const APP_SECRET_ACCOUNT = 'app-secret';

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

async function setPassword(account: string, value: string): Promise<boolean> {
  const entry = getKeyring(account);
  if (!entry) {
    return false;
  }
  entry.setPassword(value);
  return true;
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

  async setAccessToken(token: string): Promise<boolean> {
    return setPassword(ACCESS_TOKEN_ACCOUNT, token);
  }

  async getRefreshToken(): Promise<string | null> {
    return getPassword(REFRESH_TOKEN_ACCOUNT);
  }

  async setRefreshToken(token: string): Promise<boolean> {
    return setPassword(REFRESH_TOKEN_ACCOUNT, token);
  }

  async getAppId(): Promise<string | null> {
    const keychainValue = await getPassword(APP_ID_ACCOUNT);
    return keychainValue || process.env.HELPSCOUT_APP_ID || null;
  }

  async setAppId(appId: string): Promise<boolean> {
    return setPassword(APP_ID_ACCOUNT, appId);
  }

  async getAppSecret(): Promise<string | null> {
    const keychainValue = await getPassword(APP_SECRET_ACCOUNT);
    return keychainValue || process.env.HELPSCOUT_APP_SECRET || null;
  }

  async setAppSecret(appSecret: string): Promise<boolean> {
    return setPassword(APP_SECRET_ACCOUNT, appSecret);
  }

  async isAuthenticated(): Promise<boolean> {
    if ((await this.getAccessToken()) !== null) {
      return true;
    }
    const appId = await this.getAppId();
    const appSecret = await this.getAppSecret();
    return !!(appId && appSecret);
  }

  async logout(): Promise<void> {
    await deletePassword(ACCESS_TOKEN_ACCOUNT);
    await deletePassword(REFRESH_TOKEN_ACCOUNT);
    config.clearDefaultMailbox();
  }
}

export const auth = new AuthManager();
