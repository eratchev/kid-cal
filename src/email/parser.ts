import { simpleParser } from 'mailparser';
import { convert } from 'html-to-text';
import type { ParsedEmail } from '../types.js';
import { getLogger } from '../logger.js';
import type { RawEmail } from './poller.js';

const logger = getLogger();

export async function parseEmail(raw: RawEmail): Promise<ParsedEmail> {
  const parsed = await simpleParser(raw.source);

  const fromAddress = parsed.from?.value?.[0]?.address ?? raw.envelope.from[0]?.address ?? 'unknown';
  const fromDomain = fromAddress.includes('@') ? fromAddress.split('@')[1]!.toLowerCase() : 'unknown';

  const htmlBody = typeof parsed.html === 'string' ? parsed.html : '';
  const textBody = parsed.text ?? '';

  // Convert HTML to clean text for Claude processing
  const cleanText = htmlBody
    ? convert(htmlBody, {
        wordwrap: false,
        selectors: [
          { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
          { selector: 'img', format: 'skip' },
          { selector: 'table', format: 'dataTable' },
        ],
      })
    : textBody;

  const messageId = parsed.messageId ?? raw.messageId;

  logger.debug(
    { messageId, from: fromAddress, subject: parsed.subject, textLength: cleanText.length },
    'Parsed email',
  );

  return {
    messageId,
    from: fromAddress,
    fromDomain,
    subject: parsed.subject ?? raw.envelope.subject,
    date: parsed.date ?? raw.envelope.date,
    textBody,
    htmlBody,
    cleanText,
  };
}
