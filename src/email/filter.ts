import type { ParsedEmail } from '../types.js';
import { getConfig } from '../config.js';
import { getLogger } from '../logger.js';

const logger = getLogger();

export function isBlockedSubject(email: ParsedEmail): boolean {
  const config = getConfig();
  const subjectLower = email.subject.toLowerCase();
  return config.BLOCKED_SUBJECT_KEYWORDS.some((keyword) => subjectLower.includes(keyword));
}

export function isSchoolEmail(email: ParsedEmail): boolean {
  const config = getConfig();

  // Check if sender address matches any configured school addresses
  const fromLower = email.from.toLowerCase();
  if (config.SCHOOL_SENDER_ADDRESSES.includes(fromLower)) {
    logger.debug({ from: email.from, matchType: 'address' }, 'School email matched');
    return true;
  }

  // Check if sender domain matches any configured school domains
  const domainLower = email.fromDomain.toLowerCase();
  if (config.SCHOOL_SENDER_DOMAINS.includes(domainLower)) {
    logger.debug({ from: email.from, matchType: 'domain' }, 'School email matched');
    return true;
  }

  logger.debug({ from: email.from, domain: email.fromDomain }, 'Email filtered out (not from school)');
  return false;
}
