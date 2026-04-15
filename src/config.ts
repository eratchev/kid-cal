import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
  // IMAP (Yahoo Mail)
  IMAP_HOST: z.string().default('imap.mail.yahoo.com'),
  IMAP_PORT: z.coerce.number().default(993),
  IMAP_USER: z.string(),
  IMAP_PASSWORD: z.string(),

  // School email filtering
  SCHOOL_SENDER_DOMAINS: z.string().transform((s) => s.split(',').map((d) => d.trim().toLowerCase())),
  SCHOOL_SENDER_ADDRESSES: z.string().default('').transform((s) =>
    s ? s.split(',').map((a) => a.trim().toLowerCase()) : []
  ),

  // Claude API
  ANTHROPIC_API_KEY: z.string(),
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-5-20250929'),

  // Google Calendar
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string(),
  GOOGLE_PRIVATE_KEY: z.string().transform((s) => s.replace(/\\n/g, '\n')),
  GOOGLE_CALENDAR_ID: z.string(),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string(),
  TELEGRAM_CHAT_ID: z.string(),

  // Polling
  POLL_INTERVAL_MINUTES: z.coerce.number().default(5),
  REMINDER_CHECK_INTERVAL_MINUTES: z.coerce.number().default(15),

  // Timezone and reminder settings
  TIMEZONE: z.string().default('America/New_York'),
  MORNING_REMINDER_HOUR: z.coerce.number().min(0).max(23).default(7),

  // Database
  DB_PATH: z.string().default('./kid-cal.db'),

  // Grade filtering
  CHILD_GRADE: z.string().default('5'),
  EXCLUDE_KEYWORDS: z.string().default('').transform((s) =>
    s ? s.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean) : []
  ),

  // Subject-line filtering — emails whose subject contains any of these strings are skipped entirely
  BLOCKED_SUBJECT_KEYWORDS: z.string().default('').transform((s) =>
    s ? s.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean) : []
  ),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Config = z.infer<typeof configSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    const result = configSchema.safeParse(process.env);
    if (!result.success) {
      console.error('Invalid configuration:');
      for (const issue of result.error.issues) {
        console.error(`  ${issue.path.join('.')}: ${issue.message}`);
      }
      process.exit(1);
    }
    _config = result.data;
  }
  return _config;
}
