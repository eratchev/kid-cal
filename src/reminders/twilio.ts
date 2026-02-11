import Twilio from 'twilio';
import { getConfig } from '../config.js';
import { getLogger } from '../logger.js';

const logger = getLogger();

let _client: ReturnType<typeof Twilio> | null = null;

function getClient() {
  if (!_client) {
    const config = getConfig();
    _client = Twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
  }
  return _client;
}

export async function sendSMS(body: string): Promise<string | null> {
  const config = getConfig();
  const client = getClient();

  try {
    const message = await client.messages.create({
      body,
      from: config.TWILIO_FROM_NUMBER,
      to: config.NOTIFICATION_PHONE_NUMBER,
    });

    logger.info({ sid: message.sid, bodyLength: body.length }, 'SMS sent');
    return message.sid;
  } catch (error) {
    logger.error({ error, bodyLength: body.length }, 'Failed to send SMS');
    throw error;
  }
}
