import { z } from 'zod';

export const extractedEventSchema = z.object({
  title: z.string().describe('Short, descriptive event title'),
  description: z.string().describe('Brief description of the event'),
  start_date: z.string().describe('Start date/time in ISO 8601 format (e.g. 2025-03-15T09:00:00)'),
  end_date: z.string().nullable().describe('End date/time in ISO 8601, or null if unknown/all-day'),
  all_day: z.boolean().describe('True if this is an all-day event with no specific time'),
  location: z.string().nullable().describe('Event location, or null if not specified'),
});

export const extractedActionItemSchema = z.object({
  title: z.string().describe('Short, actionable title (e.g. "Return signed permission slip")'),
  description: z.string().describe('What needs to be done'),
  deadline: z.string().nullable().describe('Deadline in ISO 8601 format, or null if no specific deadline'),
  priority: z.enum(['high', 'medium', 'low']).describe('Priority: high=urgent/required, medium=important, low=optional'),
});

export const extractionResultSchema = z.object({
  events: z.array(extractedEventSchema).describe('Calendar events found in the email'),
  action_items: z.array(extractedActionItemSchema).describe('Action items requiring parent attention'),
  summary: z.string().describe('One-sentence summary of the email content'),
});

export type ExtractionResultRaw = z.infer<typeof extractionResultSchema>;
