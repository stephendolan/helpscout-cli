import Conf from 'conf';

interface ConfigSchema {
  defaultMailbox?: string;
}

const store = new Conf<ConfigSchema>({
  projectName: 'helpscout-cli',
});

export const config = {
  getDefaultMailbox(): string | undefined {
    return store.get('defaultMailbox') || process.env.HELPSCOUT_MAILBOX_ID;
  },

  setDefaultMailbox(mailboxId: string): void {
    store.set('defaultMailbox', mailboxId);
  },

  clearDefaultMailbox(): void {
    store.delete('defaultMailbox');
  },

  clear(): void {
    store.clear();
  },
};
