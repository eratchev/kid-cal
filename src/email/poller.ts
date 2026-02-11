import { ImapFlow } from 'imapflow';
import type { FetchMessageObject } from 'imapflow';
import { getConfig } from '../config.js';
import { getLogger } from '../logger.js';

export interface RawEmail {
  uid: number;
  messageId: string;
  envelope: {
    from: Array<{ name?: string; address?: string }>;
    subject: string;
    date: Date;
  };
  source: Buffer;
}

export class EmailPoller {
  private client: ImapFlow | null = null;
  private logger = getLogger();
  private config = getConfig();

  async connect(): Promise<void> {
    this.client = new ImapFlow({
      host: this.config.IMAP_HOST,
      port: this.config.IMAP_PORT,
      secure: true,
      auth: {
        user: this.config.IMAP_USER,
        pass: this.config.IMAP_PASSWORD,
      },
      logger: false, // Suppress imapflow's own logging
    });

    this.client.on('error', (err: Error) => {
      this.logger.warn({ error: err }, 'IMAP connection error (will reconnect on next cycle)');
      this.client = null;
    });

    await this.client.connect();
    this.logger.info({ host: this.config.IMAP_HOST, user: this.config.IMAP_USER }, 'IMAP connected');
  }

  async fetchUnseen(): Promise<RawEmail[]> {
    if (!this.client) throw new Error('IMAP client not connected');

    const emails: RawEmail[] = [];
    const lock = await this.client.getMailboxLock('INBOX');

    try {
      // Fetch all UNSEEN messages
      const messages = this.client.fetch({ seen: false }, {
        uid: true,
        envelope: true,
        source: true,
      });

      for await (const msg of messages) {
        const envelope = msg.envelope;
        if (!envelope || !msg.source) {
          this.logger.warn({ uid: msg.uid }, 'Skipping message with missing envelope or source');
          continue;
        }

        const fromAddr = envelope.from?.[0];
        const messageId = envelope.messageId ||
          `${this.config.IMAP_USER}:${msg.uid}:${envelope.date?.toISOString() ?? 'unknown'}`;

        emails.push({
          uid: msg.uid,
          messageId,
          envelope: {
            from: envelope.from?.map((f: { name?: string; address?: string }) => ({
              name: f.name,
              address: f.address,
            })) ?? [],
            subject: envelope.subject ?? '(no subject)',
            date: envelope.date ?? new Date(),
          },
          source: msg.source,
        });

        this.logger.debug(
          { uid: msg.uid, from: fromAddr?.address, subject: envelope.subject },
          'Fetched email'
        );
      }

      this.logger.info({ count: emails.length }, 'Fetched unseen emails');
    } finally {
      lock.release();
    }

    return emails;
  }

  async markSeen(uid: number): Promise<void> {
    if (!this.client) throw new Error('IMAP client not connected');

    const lock = await this.client.getMailboxLock('INBOX');
    try {
      await this.client.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true });
      this.logger.debug({ uid }, 'Marked as seen');
    } finally {
      lock.release();
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.logout();
      this.client = null;
      this.logger.info('IMAP disconnected');
    }
  }

  isConnected(): boolean {
    return this.client?.usable ?? false;
  }
}
