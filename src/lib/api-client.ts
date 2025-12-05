import { auth } from './auth.js';
import { HelpScoutCliError, HelpScoutApiError } from './errors.js';
import dotenv from 'dotenv';
import type {
  Conversation,
  Customer,
  Tag,
  Workflow,
  Mailbox,
  Thread,
  PageInfo,
} from '../types/index.js';

dotenv.config();

const API_BASE = 'https://api.helpscout.net/v2';
const TOKEN_URL = 'https://api.helpscout.net/v2/oauth2/token';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
}

interface PaginatedResponse<T> {
  _embedded: T;
  page: PageInfo;
}

export class HelpScoutClient {
  private accessToken: string | null = null;

  clearToken(): void {
    this.accessToken = null;
  }

  async refreshAccessToken(): Promise<string> {
    const appId = await auth.getAppId();
    const appSecret = await auth.getAppSecret();
    const refreshToken = await auth.getRefreshToken();

    if (!appId || !appSecret) {
      throw new HelpScoutCliError(
        'Not configured. Please run: helpscout auth login',
        401,
      );
    }

    if (refreshToken) {
      try {
        const response = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: appId,
            client_secret: appSecret,
            refresh_token: refreshToken,
          }),
        });

        if (response.ok) {
          const data = (await response.json()) as TokenResponse;
          await auth.setAccessToken(data.access_token);
          if (data.refresh_token) {
            await auth.setRefreshToken(data.refresh_token);
          }
          this.accessToken = data.access_token;
          return data.access_token;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(JSON.stringify({ warning: 'Refresh token failed, using client credentials', reason: message }));
      }
    }

    let response: Response;
    try {
      response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: appId,
          client_secret: appSecret,
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown network error';
      throw new HelpScoutCliError(`Network request failed during authentication: ${message}`, 0);
    }

    if (!response.ok) {
      const error = await response.json();
      throw new HelpScoutApiError('OAuth token request failed', error, response.status);
    }

    const data = (await response.json()) as TokenResponse;
    await auth.setAccessToken(data.access_token);
    this.accessToken = data.access_token;
    return data.access_token;
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }

    const storedToken = await auth.getAccessToken();
    if (storedToken) {
      this.accessToken = storedToken;
      return storedToken;
    }

    return this.refreshAccessToken();
  }

  private async request<T>(
    method: string,
    path: string,
    options: {
      params?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
      retry?: boolean;
      rateLimitRetry?: boolean;
    } = {},
  ): Promise<T> {
    const { params, body, retry = true, rateLimitRetry = true } = options;

    const url = new URL(`${API_BASE}${path}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    const token = await this.getAccessToken();
    const fetchOptions: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), fetchOptions);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown network error';
      throw new HelpScoutCliError(`Network request failed: ${message}`, 0);
    }

    if (response.status === 401 && retry) {
      this.accessToken = null;
      await this.refreshAccessToken();
      return this.request(method, path, { ...options, retry: false });
    }

    if (response.status === 429 && rateLimitRetry) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
      const waitSeconds = Math.min(retryAfter, 120);
      console.error(JSON.stringify({ warning: `Rate limited. Waiting ${waitSeconds}s before retry...` }));
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      return this.request(method, path, { ...options, rateLimitRetry: false });
    }

    if (response.status === 204) {
      return {} as T;
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new HelpScoutApiError('API request failed', error, response.status);
    }

    return response.json() as Promise<T>;
  }


  // Conversations
  async listConversations(params: {
    mailbox?: string;
    status?: string;
    tag?: string;
    assignedTo?: string;
    modifiedSince?: string;
    sortField?: string;
    sortOrder?: string;
    page?: number;
    embed?: string;
  } = {}) {
    const response = await this.request<PaginatedResponse<{ conversations: Conversation[] }>>(
      'GET',
      '/conversations',
      { params },
    );
    return {
      conversations: response._embedded?.conversations || [],
      page: response.page,
    };
  }

  async getConversation(conversationId: number, embed?: string) {
    const params = embed ? { embed } : undefined;
    return this.request<Conversation>('GET', `/conversations/${conversationId}`, { params });
  }

  async getConversationThreads(conversationId: number) {
    const response = await this.request<PaginatedResponse<{ threads: Thread[] }>>(
      'GET',
      `/conversations/${conversationId}/threads`,
    );
    return response._embedded?.threads || [];
  }

  async updateConversation(
    conversationId: number,
    data: Partial<{
      op: string;
      path: string;
      value: unknown;
    }>,
  ) {
    await this.request<void>('PATCH', `/conversations/${conversationId}`, { body: data });
  }

  async deleteConversation(conversationId: number) {
    await this.request<void>('DELETE', `/conversations/${conversationId}`);
  }

  async addConversationTag(conversationId: number, tag: string) {
    await this.request<void>('PUT', `/conversations/${conversationId}/tags`, {
      body: { tags: [tag] },
    });
  }

  async removeConversationTag(conversationId: number, tag: string) {
    const conversation = await this.getConversation(conversationId);
    const existingTags = conversation?.tags?.map(t => t.name) || [];
    const newTags = existingTags.filter(t => t !== tag);
    await this.request<void>('PUT', `/conversations/${conversationId}/tags`, {
      body: { tags: newTags },
    });
  }

  async createReply(
    conversationId: number,
    data: {
      text: string;
      user?: number;
      draft?: boolean;
      status?: string;
    },
  ) {
    await this.request<void>('POST', `/conversations/${conversationId}/reply`, { body: data });
  }

  async createNote(
    conversationId: number,
    data: {
      text: string;
      user?: number;
    },
  ) {
    await this.request<void>('POST', `/conversations/${conversationId}/notes`, { body: data });
  }

  // Customers
  async listCustomers(params: {
    mailbox?: string;
    firstName?: string;
    lastName?: string;
    modifiedSince?: string;
    sortField?: string;
    sortOrder?: string;
    page?: number;
    query?: string;
  } = {}) {
    const response = await this.request<PaginatedResponse<{ customers: Customer[] }>>(
      'GET',
      '/customers',
      { params },
    );
    return {
      customers: response._embedded?.customers || [],
      page: response.page,
    };
  }

  async getCustomer(customerId: number) {
    return this.request<Customer>('GET', `/customers/${customerId}`);
  }

  async createCustomer(data: {
    firstName?: string;
    lastName?: string;
    emails?: Array<{ type: string; value: string }>;
    phones?: Array<{ type: string; value: string }>;
  }) {
    await this.request<void>('POST', '/customers', { body: data });
  }

  async updateCustomer(
    customerId: number,
    data: Partial<{
      firstName: string;
      lastName: string;
      jobTitle: string;
      location: string;
      organization: string;
      background: string;
    }>,
  ) {
    await this.request<void>('PUT', `/customers/${customerId}`, { body: data });
  }

  async deleteCustomer(customerId: number) {
    await this.request<void>('DELETE', `/customers/${customerId}`);
  }

  // Tags
  async listTags(page?: number) {
    const response = await this.request<PaginatedResponse<{ tags: Tag[] }>>(
      'GET',
      '/tags',
      { params: page ? { page } : undefined },
    );
    return {
      tags: response._embedded?.tags || [],
      page: response.page,
    };
  }

  async getTag(tagId: number) {
    return this.request<Tag>('GET', `/tags/${tagId}`);
  }

  // Workflows
  async listWorkflows(params: {
    mailbox?: number;
    type?: string;
    page?: number;
  } = {}) {
    const response = await this.request<PaginatedResponse<{ workflows: Workflow[] }>>(
      'GET',
      '/workflows',
      { params: { mailboxId: params.mailbox, type: params.type, page: params.page } },
    );
    return {
      workflows: response._embedded?.workflows || [],
      page: response.page,
    };
  }

  async runWorkflow(workflowId: number, conversationIds: number[]) {
    await this.request<void>('POST', `/workflows/${workflowId}/run`, {
      body: { conversationIds },
    });
  }

  async updateWorkflowStatus(workflowId: number, status: 'active' | 'inactive') {
    await this.request<void>('PATCH', `/workflows/${workflowId}`, {
      body: { op: 'replace', path: '/status', value: status },
    });
  }

  // Mailboxes
  async listMailboxes(page?: number) {
    const response = await this.request<PaginatedResponse<{ mailboxes: Mailbox[] }>>(
      'GET',
      '/mailboxes',
      { params: page ? { page } : undefined },
    );
    return {
      mailboxes: response._embedded?.mailboxes || [],
      page: response.page,
    };
  }

  async getMailbox(mailboxId: number) {
    return this.request<Mailbox>('GET', `/mailboxes/${mailboxId}`);
  }
}

export const client = new HelpScoutClient();
