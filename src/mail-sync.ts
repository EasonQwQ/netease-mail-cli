import { existsSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildAlbum, getOutDir } from './build-album.js';
import { getMailConfig, type MailConfig, type MailProvider } from './config.js';
import { withMailClient } from './mail-client.js';
import type { ExportedMail } from './export-all-mails.js';
import { ImapFlow, type MessageStructureObject } from 'imapflow';

const BATCH = 50;

export type SyncResult = {
  provider: MailProvider;
  remoteTotal: number;
  localBefore: number;
  removed: number;
  added: number;
  removedUids: number[];
  localAfter: number;
};

function formatAddress(list?: { name?: string; address?: string }[]): string {
  if (!list?.length) return '';
  return list
    .map((item) => (item.name ? `${item.name} <${item.address}>` : item.address || ''))
    .filter(Boolean)
    .join(', ');
}

function hasAttachments(node?: MessageStructureObject): boolean {
  if (!node) return false;
  if (node.disposition === 'attachment') return true;
  return (node.childNodes || []).some((child) => hasAttachments(child));
}

function listLocalUids(outDir: string): number[] {
  if (!existsSync(outDir)) return [];
  return readdirSync(outDir)
    .filter((n) => n.endsWith('.json') && n !== 'index.json' && n !== 'album.json')
    .map((n) => Number(n.replace('.json', '')))
    .filter((n) => !Number.isNaN(n));
}

async function fetchNewEnvelopes(
  mailConfig: MailConfig,
  mailbox: string,
  outDir: string,
  uids: number[],
): Promise<number> {
  if (uids.length === 0) return 0;

  const client = new ImapFlow({
    host: mailConfig.imapHost,
    port: mailConfig.imapPort,
    secure: true,
    auth: { user: mailConfig.email, pass: mailConfig.authCode },
    logger: false,
    socketTimeout: 60_000,
  });

  let added = 0;
  await client.connect();
  const lock = await client.getMailboxLock(mailbox);

  try {
    for (let i = 0; i < uids.length; i += BATCH) {
      const batch = uids.slice(i, i + BATCH);
      for await (const message of client.fetch(
        batch,
        { uid: true, envelope: true, bodyStructure: true },
        { uid: true },
      )) {
        const file = resolve(outDir, `${message.uid}.json`);
        if (existsSync(file)) continue;

        const mail: ExportedMail = {
          uid: message.uid,
          mailbox,
          date: message.envelope?.date?.toISOString?.() || '',
          from: formatAddress(message.envelope?.from) || '(unknown)',
          to: formatAddress(message.envelope?.to),
          subject: message.envelope?.subject || '(no subject)',
          messageId: message.envelope?.messageId,
          bodyText: '',
          bodyHtml: '',
          hasAttachments: hasAttachments(message.bodyStructure),
          bodyStatus: 'pending',
        };
        writeFileSync(file, JSON.stringify(mail, null, 2), 'utf8');
        added += 1;
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }

  return added;
}

export async function syncMailbox(
  provider: MailProvider,
  mailbox = 'INBOX',
): Promise<SyncResult> {
  const outDir = getOutDir(provider);
  const mailConfig = getMailConfig(provider);

  let remoteUids: number[] = [];
  await withMailClient(mailConfig, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      remoteUids = await client.search({ all: true }, { uid: true });
    } finally {
      lock.release();
    }
  });

  const remoteSet = new Set(remoteUids);
  const localUids = listLocalUids(outDir);
  const localBefore = localUids.length;

  const removedUids: number[] = [];
  for (const uid of localUids) {
    if (!remoteSet.has(uid)) {
      unlinkSync(resolve(outDir, `${uid}.json`));
      removedUids.push(uid);
    }
  }

  const localAfterRemove = listLocalUids(outDir);
  const localSet = new Set(localAfterRemove);
  const missingOnDisk = remoteUids.filter((uid) => !localSet.has(uid));
  const added = await fetchNewEnvelopes(mailConfig, mailbox, outDir, missingOnDisk);

  buildAlbum(provider);

  const localAfter = listLocalUids(outDir).length;

  return {
    provider,
    remoteTotal: remoteUids.length,
    localBefore,
    removed: removedUids.length,
    added,
    removedUids,
    localAfter,
  };
}
