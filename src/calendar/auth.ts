import { google } from 'googleapis';
import { getConfig } from '../config.js';

let _calendarClient: ReturnType<typeof google.calendar> | null = null;

export function getCalendarClient() {
  if (!_calendarClient) {
    const config = getConfig();

    const auth = new google.auth.JWT({
      email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: config.GOOGLE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });

    _calendarClient = google.calendar({ version: 'v3', auth });
  }
  return _calendarClient;
}
