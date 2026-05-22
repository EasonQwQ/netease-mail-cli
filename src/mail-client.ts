import { ImapFlow, type SearchObject } from 'imapflow';
import type { MailConfig } from './config.js';

export type MailSummary = {
  uid: number;
  date: string;
  from: string;
  subject: string;
};

export type SearchFilters = {
  mailbox?: string;
  from?: string;
  subject?: string;
  before?: string;
  limit?: number;
  offset?: number;
};

function buildSearchQuery(filters: SearchFilters): SearchObject {
  const query: SearchObject = { all: true };

  if (filters.from) {
    query.from = filters.from;
  }

  if (filters.subject) {
    query.subject = filters.subject;
  }

  if (filters.before) {
    query.before = new Date(`${filters.before}T23:59:59`);
  }

  return query;
}

async function fetchMessageSummaries(client: ImapFlow, filters: SearchFilters): Promise<MailSummary[]> {
  const uids = await client.search(buildSearchQuery(filters), { uid: true });
  const offset = filters.offset || 0;
  const end = filters.limit ? offset + filters.limit : uids.length;
  const pageUids = uids.slice(offset, end);

  if (pageUids.length === 0) {
    return [];
  }

  const summaries: MailSummary[] = [];

  for await (const message of client.fetch(
    pageUids,
    { uid: true, envelope: true },
    { uid: true },
  )) {
    const from = message.envelope?.from?.[0];
    const fromText = from
      ? from.name
        ? `${from.name} <${from.address}>`
        : from.address || '(unknown)'
      : '(unknown)';

    summaries.push({
      uid: message.uid,
      date: message.envelope?.date?.toISOString?.() || '(unknown)',
      from: fromText,
      subject: message.envelope?.subject || '(no subject)',
    });
  }

  return summaries.sort((a, b) => a.uid - b.uid);
}

async function removeMessages(client: ImapFlow, mailConfig: MailConfig, uids: number[]): Promise<void> {
  if (uids.length === 0) {
    return;
  }

  if (mailConfig.trashFolder) {
    await client.messageMove(uids, mailConfig.trashFolder, { uid: true });
    return;
  }

  await client.messageDelete(uids, { uid: true });
}

export async function withMailClient<T>(
  mailConfig: MailConfig,
  run: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = new ImapFlow({
    host: mailConfig.imapHost,
    port: mailConfig.imapPort,
    secure: true,
    auth: {
      user: mailConfig.email,
      pass: mailConfig.authCode,
    },
    logger: false,
  });

  await client.connect();

  try {
    return await run(client);
  } finally {
    await client.logout();
  }
}

export async function searchMessages(
  client: ImapFlow,
  filters: SearchFilters,
): Promise<MailSummary[]> {
  const mailbox = filters.mailbox || 'INBOX';
  const lock = await client.getMailboxLock(mailbox);

  try {
    return await fetchMessageSummaries(client, filters);
  } finally {
    lock.release();
  }
}

export async function deleteMessages(
  client: ImapFlow,
  mailConfig: MailConfig,
  filters: SearchFilters,
): Promise<MailSummary[]> {
  const mailbox = filters.mailbox || 'INBOX';
  const lock = await client.getMailboxLock(mailbox);

  try {
    const targets = await fetchMessageSummaries(client, filters);
    if (targets.length === 0) {
      return [];
    }

    const uidList = targets.map((item) => item.uid);
    await removeMessages(client, mailConfig, uidList);
    return targets;
  } finally {
    lock.release();
  }
}

export async function deleteMessagesByUids(
  client: ImapFlow,
  mailConfig: MailConfig,
  uids: number[],
): Promise<number> {
  const lock = await client.getMailboxLock('INBOX');

  try {
    await removeMessages(client, mailConfig, uids);
    return uids.length;
  } finally {
    lock.release();
  }
}
