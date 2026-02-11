import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { getConfig } from '../config.js';
import { getLogger } from '../logger.js';
import type { ParsedEmail, ExtractionResult, ExtractedEvent, ExtractedActionItem } from '../types.js';
import { extractionResultSchema } from './schemas.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: getConfig().ANTHROPIC_API_KEY });
  }
  return _client;
}

export async function extractFromEmail(email: ParsedEmail): Promise<ExtractionResult> {
  const config = getConfig();
  const logger = getLogger();
  const client = getClient();

  logger.info(
    { messageId: email.messageId, subject: email.subject },
    'Extracting events from email',
  );

  const message = await client.messages.parse({
    model: config.CLAUDE_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: buildUserPrompt(email, config.TIMEZONE),
      },
    ],
    output_config: {
      format: zodOutputFormat(extractionResultSchema),
    },
  });

  const parsed = message.parsed_output;
  if (!parsed) {
    logger.warn({ messageId: email.messageId, stopReason: message.stop_reason }, 'No parsed output from Claude');
    return { events: [], actionItems: [], summary: 'Could not extract information from this email.', extractionFailed: true };
  }

  // Map snake_case schema output to camelCase application types
  const events: ExtractedEvent[] = parsed.events.map((e) => ({
    title: e.title,
    description: e.description,
    startDate: e.start_date,
    endDate: e.end_date,
    allDay: e.all_day,
    location: e.location,
    sourceEmailId: email.messageId,
    sourceEmailSubject: email.subject,
  }));

  const actionItems: ExtractedActionItem[] = parsed.action_items.map((a) => ({
    title: a.title,
    description: a.description,
    deadline: a.deadline,
    priority: a.priority,
    sourceEmailId: email.messageId,
    sourceEmailSubject: email.subject,
  }));

  logger.info(
    {
      messageId: email.messageId,
      eventCount: events.length,
      actionItemCount: actionItems.length,
      summary: parsed.summary,
    },
    'Extraction complete',
  );

  return {
    events,
    actionItems,
    summary: parsed.summary,
  };
}
