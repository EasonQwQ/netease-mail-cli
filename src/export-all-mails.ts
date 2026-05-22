import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { simpleParser } from 'mailparser';
import { getMailConfig, type MailConfig, type MailProvider } from './config.js';
import { hasAttachments } from './mail-body.js';
import { ImapFlow, type MessageStructureObject } from 'imapflow';

const BATCH = 50;
const BODY_BATCH = 15;
const MAX_SOURCE_BYTES = 800_000;
const BODY_TIMEOUT_MS = 120_000;

function getOutDir(provider: MailProvider) {
  if (provider === '163') return resolve(process.cwd(), 'data/mails');
  return resolve(process.cwd(), `data/mails-${provider}`);
}

export type ExportedMail = {
  uid: number;
  mailbox: string;
  date: string;
  from: string;
  to: string;
  subject: string;
  messageId?: string;
  bodyText: string;
  bodyHtml: string;
  hasAttachments: boolean;
  bodyStatus: 'ok' | 'empty' | 'pending' | 'timeout' | 'error';
};

type MailMeta = Pick<
  ExportedMail,
  'uid' | 'mailbox' | 'date' | 'from' | 'to' | 'subject' | 'hasAttachments' | 'bodyStatus'
>;

type CliOptions = {
  provider: MailProvider;
  mailbox: string;
  bodiesOnly: boolean;
  metadataOnly: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    provider: '163',
    mailbox: 'INBOX',
    bodiesOnly: false,
    metadataOnly: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--provider' && (next === '163' || next === 'qq')) {
      options.provider = next;
      i += 1;
    } else if (arg === '--mailbox' && next) {
      options.mailbox = next;
      i += 1;
    } else if (arg === '--bodies-only') {
      options.bodiesOnly = true;
    } else if (arg === '--metadata-only') {
      options.metadataOnly = true;
    }
  }

  return options;
}

function formatAddress(list?: { name?: string; address?: string }[]): string {
  if (!list?.length) return '';
  return list
    .map((item) => (item.name ? `${item.name} <${item.address}>` : item.address || ''))
    .filter(Boolean)
    .join(', ');
}

function hasAttachmentsFromStructure(node?: MessageStructureObject): boolean {
  if (!node) return false;
  if (node.disposition === 'attachment') return true;
  return (node.childNodes || []).some((child) => hasAttachmentsFromStructure(child));
}

function createClient(mailConfig: MailConfig) {
  const client = new ImapFlow({
    host: mailConfig.imapHost,
    port: mailConfig.imapPort,
    secure: true,
    auth: { user: mailConfig.email, pass: mailConfig.authCode },
    logger: false,
    socketTimeout: BODY_TIMEOUT_MS + 30_000,
  });
  client.on('error', () => {});
  return client;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function parseSource(source: Buffer): Promise<{ bodyText: string; bodyHtml: string }> {
  const parsed = await simpleParser(source);
  const bodyText = parsed.text || '';
  const bodyHtml = typeof parsed.html === 'string' ? parsed.html : '';
  return { bodyText, bodyHtml };
}

async function downloadSource(
  client: ImapFlow,
  uid: number,
): Promise<{ bodyText: string; bodyHtml: string; status: ExportedMail['bodyStatus'] }> {
  try {
    for await (const message of client.fetch(
      [uid],
      { uid: true, source: { maxLength: MAX_SOURCE_BYTES } },
      { uid: true },
    )) {
      if (!message.source?.length) {
        return { bodyText: '', bodyHtml: '', status: 'empty' };
      }

      const { bodyText, bodyHtml } = await withTimeout(
        parseSource(message.source),
        30_000,
        'parse',
      );

      if (!bodyText && !bodyHtml) return { bodyText: '', bodyHtml: '', status: 'empty' };
      return { bodyText, bodyHtml, status: 'ok' };
    }
    return { bodyText: '', bodyHtml: '', status: 'empty' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('timeout') || message.includes('ETIMEOUT')) {
      return { bodyText: '', bodyHtml: '', status: 'timeout' };
    }
    return { bodyText: '', bodyHtml: '', status: 'error' };
  }
}

function saveMail(outDir: string, mail: ExportedMail) {
  writeFileSync(resolve(outDir, `${mail.uid}.json`), JSON.stringify(mail, null, 2), 'utf8');
}

function writeIndex(
  outDir: string,
  mailConfig: MailConfig,
  options: CliOptions,
  manifest: MailMeta[],
) {
  manifest.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  writeFileSync(
    resolve(outDir, 'index.json'),
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        provider: options.provider,
        email: mailConfig.email,
        mailbox: options.mailbox,
        total: manifest.length,
        mails: manifest,
      },
      null,
      2,
    ),
    'utf8',
  );
}

function loadManifestFromDisk(outDir: string): MailMeta[] {
  const manifest: MailMeta[] = [];
  for (const name of readdirSync(outDir)) {
    if (!name.endsWith('.json') || name === 'index.json') continue;
    const mail = JSON.parse(readFileSync(resolve(outDir, name), 'utf8')) as ExportedMail;
    manifest.push({
      uid: mail.uid,
      mailbox: mail.mailbox,
      date: mail.date,
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      hasAttachments: mail.hasAttachments,
      bodyStatus: mail.bodyStatus || 'pending',
    });
  }
  return manifest;
}

function needsBody(mail: ExportedMail): boolean {
  if (mail.bodyStatus === 'ok' && (mail.bodyText?.trim() || mail.bodyHtml?.trim())) {
    return false;
  }
  if (mail.bodyStatus === 'empty') return false;
  return true;
}

async function exportEnvelopes(
  outDir: string,
  mailConfig: MailConfig,
  mailbox: string,
  allUids: number[],
): Promise<void> {
  const client = createClient(mailConfig);
  await client.connect();
  const lock = await client.getMailboxLock(mailbox);

  try {
    for (let i = 0; i < allUids.length; i += BATCH) {
      const batch = allUids.slice(i, i + BATCH);

      for await (const message of client.fetch(
        batch,
        { uid: true, envelope: true, bodyStructure: true },
        { uid: true },
      )) {
        saveMail(outDir, {
          uid: message.uid,
          mailbox,
          date: message.envelope?.date?.toISOString?.() || '',
          from: formatAddress(message.envelope?.from) || '(unknown)',
          to: formatAddress(message.envelope?.to),
          subject: message.envelope?.subject || '(no subject)',
          messageId: message.envelope?.messageId,
          bodyText: '',
          bodyHtml: '',
          hasAttachments: hasAttachmentsFromStructure(message.bodyStructure),
          bodyStatus: 'pending',
        });
      }

      process.stdout.write(`\r元数据 ${Math.min(i + BATCH, allUids.length)}/${allUids.length}`);
    }
  } finally {
    lock.release();
    await client.logout();
  }
}

async function exportBodiesBatch(
  mailConfig: MailConfig,
  mailbox: string,
  mails: ExportedMail[],
): Promise<ExportedMail[]> {
  const client = createClient(mailConfig);
  await client.connect();
  const lock = await client.getMailboxLock(mailbox);
  const results: ExportedMail[] = [];

  try {
    for (const mail of mails) {
      const bodies = await withTimeout(
        downloadSource(client, mail.uid),
        BODY_TIMEOUT_MS,
        `uid ${mail.uid}`,
      );

      results.push({
        ...mail,
        bodyText: bodies.bodyText,
        bodyHtml: bodies.bodyHtml,
        bodyStatus: bodies.status,
      });
    }
  } finally {
    lock.release();
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }

  return results;
}

async function main() {
  const options = parseArgs(process.argv);
  const mailConfig = getMailConfig(options.provider);
  const outDir = getOutDir(options.provider);

  mkdirSync(outDir, { recursive: true });

  console.log(`导出邮箱: ${mailConfig.email} (${options.provider})`);
  console.log(`邮箱夹: ${options.mailbox}`);
  console.log(`输出目录: ${outDir}\n`);

  if (!options.bodiesOnly) {
    const client = createClient(mailConfig);
    await client.connect();
    const lock = await client.getMailboxLock(options.mailbox);
    let allUids: number[] = [];

    try {
      allUids = await client.search({ all: true }, { uid: true });
    } finally {
      lock.release();
      await client.logout();
    }

    const existing = new Set(
      existsSync(outDir)
        ? readdirSync(outDir)
            .filter((n) => n.endsWith('.json') && n !== 'index.json')
            .map((n) => Number(n.replace('.json', '')))
            .filter((n) => !Number.isNaN(n))
        : [],
    );

    const missingMeta = allUids.filter((uid) => !existing.has(uid));
    if (missingMeta.length > 0) {
      console.log(`第 1 步：下载元数据（${missingMeta.length} 封）...`);
      await exportEnvelopes(outDir, mailConfig, options.mailbox, missingMeta);
      console.log('\n');
    } else {
      console.log(`第 1 步：元数据已齐全（${allUids.length} 封）\n`);
    }
  }

  const allMails: ExportedMail[] = [];
  for (const name of readdirSync(outDir)) {
    if (!name.endsWith('.json') || name === 'index.json') continue;
    allMails.push(JSON.parse(readFileSync(resolve(outDir, name), 'utf8')) as ExportedMail);
  }

  const pendingBodies = options.metadataOnly ? [] : allMails.filter(needsBody);
  if (pendingBodies.length > 0) {
    console.log(
      `第 2 步：下载正文（${pendingBodies.length} 封，整封拉取，单批 ${BODY_BATCH} 封，超时 ${BODY_TIMEOUT_MS / 1000}s）...`,
    );

    for (let i = 0; i < pendingBodies.length; i += BODY_BATCH) {
      const batch = pendingBodies.slice(i, i + BODY_BATCH);
      const label = batch[0]?.subject.slice(0, 36) || '';
      process.stdout.write(
        `\r正文 ${Math.min(i + BODY_BATCH, pendingBodies.length)}/${pendingBodies.length} · ${label}   `,
      );

      try {
        const updated = await exportBodiesBatch(mailConfig, options.mailbox, batch);
        for (const mail of updated) saveMail(outDir, mail);
      } catch (error) {
        for (const mail of batch) {
          try {
            const [one] = await exportBodiesBatch(mailConfig, options.mailbox, [mail]);
            saveMail(outDir, one);
          } catch {
            saveMail(outDir, { ...mail, bodyStatus: 'error' });
          }
        }
      }
    }
    console.log('\n');
  }

  const manifest = loadManifestFromDisk(outDir);
  writeIndex(outDir, mailConfig, options, manifest);

  const ok = manifest.filter((m) => m.bodyStatus === 'ok').length;
  const failed = manifest.filter((m) => m.bodyStatus === 'timeout' || m.bodyStatus === 'error').length;

  console.log(`完成！共 ${manifest.length} 封`);
  console.log(`  正文成功: ${ok} · 超时/失败: ${failed}`);
  console.log(`索引: ${resolve(outDir, 'index.json')}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n错误: ${message}`);
  console.error('已保存进度，重新运行可断点续传。');
  process.exit(1);
});
