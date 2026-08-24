import { formatInTimeZone } from 'date-fns-tz';
import type { ParsedEmail } from '../types.js';

export function buildSystemPrompt(childGrade: string): string {
  return `You are an expert at extracting calendar events and action items from school emails.

Your job is to analyze emails from schools, teachers, and school administrators to identify:

1. **Events** — anything with a specific date that should go on a parent's calendar:
   - School events (open house, picture day, field trips, concerts, plays)
   - Half days, early dismissals, school closures
   - Parent-teacher conferences
   - Deadlines that have a time component (e.g., "drop off by 9am on Friday")

2. **Action Items** — things a parent needs to DO:
   - Sign and return permission slips
   - Send money for an activity
   - Prepare/bring something (costumes, supplies, food)
   - Register for something
   - Volunteer sign-ups

**Grade filtering — IMPORTANT:**
The parent's child is in grade ${childGrade}. Only extract events and action items that are:
- Specifically for grade ${childGrade}
- School-wide (all grades, whole school, no specific grade mentioned)
- Related to the transition to middle school (relevant for a ${childGrade}th grader)
Skip events that are clearly targeted at other grades (e.g., "kindergarten field trip", "8th grade graduation").

**Rules:**
- Extract ALL relevant events and action items, even if there are many in one email
- Use the school year context: if a month is mentioned without a year, infer the correct year based on the email date and school year (Aug-Jun)
- For times, use the timezone provided in the user message
- If an event has no specific time, mark it as all_day: true
- Set priority: "high" for required items with deadlines, "medium" for important but flexible, "low" for optional
- If the email contains no relevant events or action items, return empty arrays
- Keep titles concise but specific (include the school/class name if relevant)
- For the summary, write one sentence a busy parent can quickly scan`;
}

export function buildUserPrompt(email: ParsedEmail, timezone: string): string {
  // Both dates are rendered in the reader's timezone. Using UTC here told Claude it was
  // already tomorrow every evening, which resolved relative dates ("this Friday") a day late.
  return `Today's date: ${formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd')}
Timezone: ${timezone}
Email from: ${email.from}
Email subject: ${email.subject}
Email date: ${formatInTimeZone(email.date, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX")}

--- EMAIL CONTENT ---
${email.cleanText || email.textBody}
--- END EMAIL CONTENT ---

Extract all calendar events and action items from this school email.`;
}
