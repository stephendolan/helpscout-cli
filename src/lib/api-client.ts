import { auth } from './auth.js';
import { HelpScoutCliError, HelpScoutApiError } from './errors.js';
import type {
  Conversation,
  ConversationStatus,
  AttachmentDownload,
  Customer,
  DraftConversationStatus,
  DraftReply,
  DraftReplyWriteResult,
  Tag,
  User,
  Workflow,
  Mailbox,
  Thread,
  PageInfo,
} from '../types/index.js';

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

interface AuthProvider {
  getAccessToken(): Promise<string | null>;
  setAccessToken(token: string): Promise<boolean>;
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string): Promise<boolean>;
  getAppId(): Promise<string | null>;
  getAppSecret(): Promise<string | null>;
}

const DRAFT_PREVIEW_LENGTH = 300;

function isDraftReply(
  thread: Thread
): thread is Thread & { type: 'message'; state: 'draft'; body: string } {
  return thread.type === 'message' && thread.state === 'draft' && typeof thread.body === 'string';
}

function toDraftReply(
  conversationId: number,
  thread: Thread & { type: 'message'; state: 'draft'; body: string }
): DraftReply {
  const preview =
    thread.body.length > DRAFT_PREVIEW_LENGTH
      ? `${thread.body.slice(0, DRAFT_PREVIEW_LENGTH).trim()}...`
      : thread.body;
  return {
    threadId: thread.id,
    conversationId,
    type: thread.type,
    state: thread.state,
    status: thread.status,
    body: thread.body,
    preview,
    createdAt: thread.createdAt,
    createdBy: thread.createdBy,
    to: thread.to,
    cc: thread.cc,
    bcc: thread.bcc,
  };
}

export class HelpScoutClient {
  private accessToken: string | null = null;

  constructor(private readonly authManager: AuthProvider = auth) {}

  clearToken(): void {
    this.accessToken = null;
  }

  async refreshAccessToken(): Promise<string> {
    const appId = await this.authManager.getAppId();
    const appSecret = await this.authManager.getAppSecret();
    const refreshToken = await this.authManager.getRefreshToken();

    if (!appId || !appSecret) {
      throw new HelpScoutCliError('Not configured. Please run: helpscout auth login', 401);
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
          await this.authManager.setAccessToken(data.access_token);
          if (data.refresh_token) {
            await this.authManager.setRefreshToken(data.refresh_token);
          }
          this.accessToken = data.access_token;
          return data.access_token;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(
          JSON.stringify({
            warning: 'Refresh token failed, using client credentials',
            reason: message,
          })
        );
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
    await this.authManager.setAccessToken(data.access_token);
    this.accessToken = data.access_token;
    return data.access_token;
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }

    const storedToken = await this.authManager.getAccessToken();
    if (storedToken) {
      this.accessToken = storedToken;
      return storedToken;
    }

    return this.refreshAccessToken();
  }

  private async rawRequest(
    method: string,
    path: string,
    options: {
      params?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
      retry?: boolean;
      rateLimitRetry?: boolean;
    } = {}
  ): Promise<Response> {
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
      return this.rawRequest(method, path, { ...options, retry: false });
    }

    if (response.status === 429 && rateLimitRetry) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
      const waitSeconds = Math.min(retryAfter, 120);
      console.error(
        JSON.stringify({ warning: `Rate limited. Waiting ${waitSeconds}s before retry...` })
      );
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      return this.rawRequest(method, path, { ...options, rateLimitRetry: false });
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new HelpScoutApiError('API request failed', error, response.status);
    }

    return response;
  }

  private async request<T>(
    method: string,
    path: string,
    options: {
      params?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
      retry?: boolean;
      rateLimitRetry?: boolean;
    } = {}
  ): Promise<T> {
    const response = await this.rawRequest(method, path, options);
    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    return JSON.parse(text) as T;
  }

  // Conversations
  async listConversations(
    params: {
      mailbox?: string;
      status?: string;
      tag?: string;
      assignedTo?: string;
      sortField?: string;
      sortOrder?: string;
      page?: number;
      embed?: string;
      query?: string;
    } = {}
  ) {
    const response = await this.request<PaginatedResponse<{ conversations: Conversation[] }>>(
      'GET',
      '/conversations',
      { params }
    );
    return {
      conversations: response._embedded?.conversations || [],
      page: response.page,
    };
  }

  async listAllConversations(
    params: {
      mailbox?: string;
      status?: string;
      tag?: string;
      assignedTo?: string;
      query?: string;
      embed?: string;
    } = {},
    maxResults?: number
  ): Promise<Conversation[]> {
    const allConversations: Conversation[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const result = await this.listConversations({ ...params, page });
      allConversations.push(...result.conversations);
      if (maxResults && allConversations.length >= maxResults) {
        return allConversations.slice(0, maxResults);
      }
      totalPages = result.page.totalPages;
      page++;
    } while (page <= totalPages);

    return allConversations;
  }

  async getConversation(conversationId: number, embed?: string) {
    const params = embed ? { embed } : undefined;
    return this.request<Conversation>('GET', `/conversations/${conversationId}`, { params });
  }

  /**
   * Resolve a conversation reference to its internal API id.
   *
   * Help Scout exposes two identifiers: the internal `id`, which the detail
   * endpoint requires, and the visible ticket `number` (e.g. #12345) shown in
   * the UI and notifications. A "#"-prefixed value is treated as a ticket
   * number and resolved via search; anything else is parsed as an internal id
   * directly.
   */
  async resolveConversationId(ref: string | number): Promise<number> {
    const value = String(ref).trim();

    if (value.startsWith('#')) {
      const digits = value.slice(1);
      const number = /^\d+$/.test(digits) ? parseInt(digits, 10) : NaN;
      if (isNaN(number) || number <= 0) {
        throw new HelpScoutCliError(`Invalid conversation number: "${ref}"`, 400);
      }
      const { conversations } = await this.listConversations({
        query: `number:${number}`,
        status: 'all',
      });
      const match = conversations.find((c) => c.number === number);
      if (!match) {
        throw new HelpScoutCliError(`No conversation found with number #${number}`, 404);
      }
      return match.id;
    }

    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed <= 0) {
      throw new HelpScoutCliError(`Invalid conversation ID: "${ref}"`, 400);
    }
    return parsed;
  }

  async getConversationThreads(conversationId: number, maxResults?: number) {
    const threads: Thread[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const response = await this.request<PaginatedResponse<{ threads: Thread[] }>>(
        'GET',
        `/conversations/${conversationId}/threads`,
        { params: { page } }
      );

      threads.push(...(response._embedded?.threads || []));
      if (maxResults && threads.length >= maxResults) {
        return threads.slice(0, maxResults);
      }

      totalPages = response.page.totalPages;
      page++;
    } while (page <= totalPages);

    return threads;
  }

  async downloadAttachment(
    conversationId: number,
    attachmentId: number
  ): Promise<AttachmentDownload> {
    const response = await this.rawRequest(
      'GET',
      `/conversations/${conversationId}/attachments/${attachmentId}/file`
    );
    const data = new Uint8Array(await response.arrayBuffer());
    const contentLength = response.headers.get('Content-Length');

    return {
      data,
      contentType: response.headers.get('Content-Type') ?? undefined,
      contentLength: contentLength ? parseInt(contentLength, 10) : undefined,
      contentDisposition: response.headers.get('Content-Disposition') ?? undefined,
    };
  }

  async updateConversation(
    conversationId: number,
    data: Partial<{
      op: string;
      path: string;
      value: unknown;
    }>
  ) {
    await this.request<void>('PATCH', `/conversations/${conversationId}`, { body: data });
  }

  async updateConversationStatus(conversationId: number, status: ConversationStatus) {
    await this.updateConversation(conversationId, {
      op: 'replace',
      path: '/status',
      value: status,
    });
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
    const existingTags = conversation?.tags?.map((t) => t.name) || [];
    const newTags = existingTags.filter((t) => t !== tag);
    await this.request<void>('PUT', `/conversations/${conversationId}/tags`, {
      body: { tags: newTags },
    });
  }

  async createDraftReply(
    conversationId: number,
    data: {
      text: string;
      user?: number;
    }
  ): Promise<DraftReplyWriteResult> {
    const conversation = await this.getConversation(conversationId);
    const customerId = conversation?.primaryCustomer?.id;
    if (!customerId) {
      throw new Error(
        `Cannot create draft reply: conversation ${conversationId} has no primary customer`
      );
    }
    const response = await this.rawRequest('POST', `/conversations/${conversationId}/reply`, {
      body: { ...data, customer: { id: customerId }, draft: true },
    });
    const resourceId = response.headers.get('Resource-ID');
    const threadId = resourceId && /^\d+$/.test(resourceId) ? Number(resourceId) : NaN;
    if (!Number.isSafeInteger(threadId) || threadId <= 0) {
      throw new HelpScoutCliError(
        'Draft reply created but Help Scout did not return a valid Resource-ID thread header',
        502
      );
    }
    return this.verifyDraftReply(conversationId, threadId, data.text, 'created');
  }

  async listDraftReplies(conversationId: number): Promise<DraftReply[]> {
    const threads = await this.getConversationThreads(conversationId);
    return threads.filter(isDraftReply).map((thread) => toDraftReply(conversationId, thread));
  }

  async updateDraftReply(
    conversationId: number,
    threadId: number,
    text: string
  ): Promise<DraftReplyWriteResult> {
    const threads = await this.getConversationThreads(conversationId);
    const thread = threads.find((candidate) => candidate.id === threadId);
    if (!thread) {
      throw new HelpScoutCliError(
        `Cannot update draft reply: thread ${threadId} does not exist in conversation ${conversationId}`,
        404
      );
    }
    if (!isDraftReply(thread)) {
      throw new HelpScoutCliError(
        `Refusing to update thread ${threadId}: expected a draft reply (type message, state draft), found type ${thread.type}, state ${thread.state ?? 'unknown'}`,
        409
      );
    }

    await this.request<void>('PATCH', `/conversations/${conversationId}/threads/${threadId}`, {
      body: { op: 'replace', path: '/text', value: text },
    });
    return this.verifyDraftReply(conversationId, threadId, text, 'updated');
  }

  async upsertDraftReply(
    conversationId: number,
    data: { text: string; user?: number; threadId?: number }
  ): Promise<DraftReplyWriteResult> {
    if (data.threadId !== undefined) {
      return this.updateDraftReply(conversationId, data.threadId, data.text);
    }

    const drafts = await this.listDraftReplies(conversationId);
    if (drafts.length === 0) {
      return this.createDraftReply(conversationId, { text: data.text, user: data.user });
    }
    if (drafts.length === 1) {
      return this.updateDraftReply(conversationId, drafts[0].threadId, data.text);
    }

    const ids = drafts.map((draft) => draft.threadId).join(', ');
    throw new HelpScoutCliError(
      `Refusing to choose among ${drafts.length} active draft replies (${ids}). Specify the intended thread ID explicitly.`,
      409
    );
  }

  private async verifyDraftReply(
    conversationId: number,
    threadId: number,
    expectedText: string,
    action: DraftReplyWriteResult['action']
  ): Promise<DraftReplyWriteResult> {
    const threads = await this.getConversationThreads(conversationId);
    const thread = threads.find((candidate) => candidate.id === threadId);
    if (!thread || !isDraftReply(thread) || thread.body !== expectedText) {
      throw new HelpScoutCliError(
        `Draft reply ${action} but post-write verification failed for thread ${threadId}: expected an unsent draft with the requested text`,
        502
      );
    }
    return {
      conversationId,
      threadId,
      action,
      verified: true,
      draft: toDraftReply(conversationId, thread),
    };
  }

  async createDraftConversation(data: {
    subject: string;
    mailboxId: number;
    customerEmail: string;
    text: string;
    type?: 'email' | 'chat' | 'phone';
    status?: DraftConversationStatus;
    user?: number;
    tags?: string[];
  }): Promise<{ id: number }> {
    const {
      subject,
      mailboxId,
      customerEmail,
      text,
      type = 'email',
      status = 'active',
      user,
      tags,
    } = data;
    const response = await this.rawRequest('POST', '/conversations', {
      body: {
        subject,
        mailboxId,
        type,
        status,
        customer: { email: customerEmail },
        threads: [
          {
            type: 'reply',
            customer: { email: customerEmail },
            text,
            draft: true,
            ...(user !== undefined && { user }),
          },
        ],
        ...(tags && { tags }),
      },
    });

    const location = response.headers.get('Location') || '';
    const match = location.match(/\/conversations\/(\d+)/);
    if (!match) {
      throw new HelpScoutCliError(
        'Draft conversation created but could not parse ID from Location header',
        0
      );
    }
    return { id: parseInt(match[1], 10) };
  }

  async createNote(
    conversationId: number,
    data: {
      text: string;
      user?: number;
      status?: ConversationStatus;
    }
  ) {
    await this.request<void>('POST', `/conversations/${conversationId}/notes`, { body: data });
  }

  // Customers
  async listCustomers(
    params: {
      mailbox?: string;
      firstName?: string;
      lastName?: string;
      sortField?: string;
      sortOrder?: string;
      page?: number;
      query?: string;
    } = {}
  ) {
    const response = await this.request<PaginatedResponse<{ customers: Customer[] }>>(
      'GET',
      '/customers',
      { params }
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
    }>
  ) {
    await this.request<void>('PUT', `/customers/${customerId}`, { body: data });
  }

  async deleteCustomer(customerId: number) {
    await this.request<void>('DELETE', `/customers/${customerId}`);
  }

  // Users
  async listUsers(params: { email?: string; mailbox?: number; page?: number } = {}) {
    const response = await this.request<PaginatedResponse<{ users: User[] }>>('GET', '/users', {
      params,
    });
    return {
      users: response._embedded?.users || [],
      page: response.page,
    };
  }

  async getUser(userId: number) {
    return this.request<User>('GET', `/users/${userId}`);
  }

  // Tags
  async listTags(page?: number) {
    const response = await this.request<PaginatedResponse<{ tags: Tag[] }>>('GET', '/tags', {
      params: page ? { page } : undefined,
    });
    return {
      tags: response._embedded?.tags || [],
      page: response.page,
    };
  }

  async getTag(tagId: number) {
    return this.request<Tag>('GET', `/tags/${tagId}`);
  }

  // Workflows
  async listWorkflows(params: { mailbox?: number; type?: string; page?: number } = {}) {
    const response = await this.request<PaginatedResponse<{ workflows: Workflow[] }>>(
      'GET',
      '/workflows',
      { params: { mailboxId: params.mailbox, type: params.type, page: params.page } }
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
      { params: page ? { page } : undefined }
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
