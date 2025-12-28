export interface OutputOptions {
  compact?: boolean;
  slim?: boolean;
  plain?: boolean;
  fields?: string;
}

export interface CommandOptions {
  compact?: boolean;
}

export interface HelpScoutError {
  name: string;
  detail: string;
  statusCode?: number;
}

export interface PageInfo {
  size: number;
  totalElements: number;
  totalPages: number;
  number: number;
}

export interface Conversation {
  id: number;
  number: number;
  threads: number;
  type: string;
  folderId: number;
  status: string;
  state: string;
  subject: string;
  preview: string;
  mailboxId: number;
  assignee?: {
    id: number;
    first: string;
    last: string;
    email: string;
  };
  createdBy?: {
    id: number;
    type: string;
    email?: string;
  };
  createdAt: string;
  closedAt?: string;
  closedBy?: number;
  modifiedAt?: string;
  customerWaitingSince?: {
    time: string;
    friendly: string;
  };
  source?: {
    type: string;
    via: string;
  };
  tags?: Tag[];
  cc?: string[];
  bcc?: string[];
  primaryCustomer?: {
    id: number;
    first?: string;
    last?: string;
    email?: string;
  };
  customFields?: CustomField[];
  _embedded?: {
    threads?: Thread[];
  };
}

export interface Thread {
  id: number;
  type: string;
  status: string;
  state: string;
  action?: {
    type: string;
    text?: string;
  };
  body?: string;
  source?: {
    type: string;
    via: string;
  };
  customer?: {
    id: number;
    first?: string;
    last?: string;
    email?: string;
  };
  createdBy?: {
    id: number;
    type: string;
    first?: string;
    last?: string;
    email?: string;
  };
  assignedTo?: {
    id: number;
    first: string;
    last: string;
    email: string;
  };
  savedReplyId?: number;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  createdAt: string;
  openedAt?: string;
}

export interface Customer {
  id: number;
  firstName?: string;
  lastName?: string;
  gender?: string;
  jobTitle?: string;
  location?: string;
  organization?: string;
  photoType?: string;
  photoUrl?: string;
  background?: string;
  age?: string;
  createdAt: string;
  updatedAt?: string;
  emails?: CustomerEmail[];
  phones?: CustomerPhone[];
  chats?: CustomerChat[];
  socialProfiles?: CustomerSocialProfile[];
  websites?: CustomerWebsite[];
  addresses?: CustomerAddress[];
}

export interface CustomerEmail {
  id: number;
  value: string;
  type: string;
}

export interface CustomerPhone {
  id: number;
  value: string;
  type: string;
}

export interface CustomerChat {
  id: number;
  value: string;
  type: string;
}

export interface CustomerSocialProfile {
  id: number;
  value: string;
  type: string;
}

export interface CustomerWebsite {
  id: number;
  value: string;
}

export interface CustomerAddress {
  id: number;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  lines?: string[];
}

export interface Tag {
  id: number;
  name: string;
  slug: string;
  color?: string;
  createdAt?: string;
  updatedAt?: string;
  ticketCount?: number;
}

export interface Workflow {
  id: number;
  mailboxId: number;
  type: string;
  status: string;
  order: number;
  name: string;
  createdAt: string;
  modifiedAt: string;
}

export interface CustomField {
  id: number;
  name: string;
  value: string;
  type: string;
}

export interface Mailbox {
  id: number;
  name: string;
  slug: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}
