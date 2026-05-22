import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildAlbum, getOutDir } from './build-album.js';
import { getMailConfig, type MailProvider } from './config.js';
import { deleteMessagesByUids, withMailClient } from './mail-client.js';

const IMAP_BATCH = 50;

export type DeleteResult = {
  deleted: number;
  uids: number[];
  provider: MailProvider;
};

export async function deleteMailsByUids(
  provider: MailProvider,
  uids: number[],
): Promise<DeleteResult> {
  const unique = [...new Set(uids.filter((u) => Number.isInteger(u) && u > 0))];
  if (unique.length === 0) {
    return { deleted: 0, uids: [], provider };
  }

  const mailConfig = getMailConfig(provider);

  for (let i = 0; i < unique.length; i += IMAP_BATCH) {
    const batch = unique.slice(i, i + IMAP_BATCH);
    await withMailClient(mailConfig, (client) =>
      deleteMessagesByUids(client, mailConfig, batch),
    );
  }

  const outDir = getOutDir(provider);
  for (const uid of unique) {
    const file = resolve(outDir, `${uid}.json`);
    if (existsSync(file)) unlinkSync(file);
  }

  buildAlbum(provider);

  return { deleted: unique.length, uids: unique, provider };
}
