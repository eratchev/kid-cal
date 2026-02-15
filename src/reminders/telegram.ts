import { getConfig } from '../config.js';
import { getLogger } from '../logger.js';

const logger = getLogger();

export async function sendNotification(body: string): Promise<string | null> {
  const config = getConfig();

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.TELEGRAM_CHAT_ID,
          text: body,
        }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Telegram API error ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as { result: { message_id: number } };
    const messageId = String(data.result.message_id);

    logger.info({ messageId, bodyLength: body.length }, 'Telegram notification sent');
    return messageId;
  } catch (error) {
    logger.error({ error, bodyLength: body.length }, 'Failed to send Telegram notification');
    throw error;
  }
}
