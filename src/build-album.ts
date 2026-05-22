import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { coarseClassify, fineClassify, type MailRow, type Tier } from './mail-classify.js';
import type { ExportedMail } from './export-all-mails.js';
import { getMailConfig, type MailProvider } from './config.js';

const BULK_DOMAINS = new Set([
  'tencent.com', 'qq.com', 'github.com', 'google.com', 'apple.com', 'icloud.com',
  'amazon.com', 'facebook.com', 'linkedin.com', 'twitter.com', 'x.com',
  'csdn.net', 'medium.com', 'substack.com', 'mailchimp.com', 'sendgrid.net',
  'noreply.com', 'notification.com', 'accountprotection.microsoft.com',
]);

export function getOutDir(provider: MailProvider) {
  if (provider === '163') return resolve(process.cwd(), 'data/mails');
  return resolve(process.cwd(), `data/mails-${provider}`);
}

function parseArgs(): MailProvider {
  const arg = process.argv.find((a) => a === '--provider');
  const next = process.argv[process.argv.indexOf(arg || '') + 1];
  return next === 'qq' ? 'qq' : '163';
}

function senderKey(from: string): { key: string; label: string; email: string } {
  const match = from.match(/<([^>]+)>/);
  const email = (match?.[1] || from).trim().toLowerCase();
  const domain = email.split('@')[1] || email;
  const name = from.replace(/<[^>]+>/, '').trim() || domain;

  if (BULK_DOMAINS.has(domain)) {
    return { key: domain, label: domain, email };
  }
  return { key: email || from, label: name.slice(0, 24) || email, email };
}

function classifyMail(mail: ExportedMail): { tier: Tier; reason: string } {
  const row: MailRow = {
    uid: mail.uid,
    date: mail.date?.slice(0, 10) || '2099-01-01',
    from: mail.from,
    subject: mail.subject,
  };

  let tier = coarseClassify(row);
  let reason = tier === 'DELETE' ? '营销/通知/验证码' : tier === 'KEEP' ? '账单/重要信息' : '需人工确认';

  if (tier === 'REVIEW' && (mail.bodyText || mail.bodyHtml)) {
    const fine = fineClassify(row, `${mail.bodyText}\n${mail.bodyHtml}`);
    if (fine === 'DELETE') {
      tier = 'DELETE';
      reason = '正文判定：可删';
    } else {
      tier = 'KEEP';
      reason = '正文判定：保留';
    }
  }

  if (tier === 'DELETE' && mail.subject.includes('验证码组件')) {
    tier = 'KEEP';
    reason = '主题例外保留';
  }

  return { tier, reason };
}

function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

type AlbumMail = {
  uid: number;
  date: string;
  from: string;
  subject: string;
  reason: string;
  preview: string;
  hasAttachments: boolean;
};

type Album = {
  id: string;
  tier: Tier;
  title: string;
  subtitle: string;
  senderKey: string;
  hue: number;
  count: number;
  reason: string;
  mails: AlbumMail[];
};

function previewText(mail: ExportedMail): string {
  const raw = mail.bodyText?.trim() || mail.bodyHtml?.replace(/<[^>]+>/g, ' ').trim() || '';
  return raw.replace(/\s+/g, ' ').slice(0, 160);
}

export function buildAlbum(provider: MailProvider) {
  const outDir = getOutDir(provider);
  if (!existsSync(outDir)) {
    throw new Error(`目录不存在: ${outDir}`);
  }

  const grouped = new Map<string, { tier: Tier; reason: string; sender: ReturnType<typeof senderKey>; mails: AlbumMail[] }>();

  for (const name of readdirSync(outDir)) {
    if (!name.endsWith('.json') || name === 'index.json' || name === 'album.json') continue;
    const mail = JSON.parse(readFileSync(resolve(outDir, name), 'utf8')) as ExportedMail;
    const { tier, reason } = classifyMail(mail);
    const sender = senderKey(mail.from);
    const groupId = `${tier}::${sender.key}`;

    if (!grouped.has(groupId)) {
      grouped.set(groupId, { tier, reason, sender, mails: [] });
    }

    grouped.get(groupId)!.mails.push({
      uid: mail.uid,
      date: mail.date,
      from: mail.from,
      subject: mail.subject,
      reason,
      preview: previewText(mail),
      hasAttachments: mail.hasAttachments,
    });
  }

  const albums: Album[] = [];

  for (const [groupId, group] of grouped) {
    group.mails.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
    const hue = hueFromString(group.sender.key);
    albums.push({
      id: groupId.replace(/[^a-zA-Z0-9_-]/g, '_'),
      tier: group.tier,
      title: group.sender.label,
      subtitle: group.sender.email,
      senderKey: group.sender.key,
      hue,
      count: group.mails.length,
      reason: group.reason,
      mails: group.mails,
    });
  }

  const tierOrder: Record<Tier, number> = { DELETE: 0, REVIEW: 1, KEEP: 2 };
  albums.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || b.count - a.count);

  const stats = {
    DELETE: albums.filter((a) => a.tier === 'DELETE').reduce((s, a) => s + a.count, 0),
    REVIEW: albums.filter((a) => a.tier === 'REVIEW').reduce((s, a) => s + a.count, 0),
    KEEP: albums.filter((a) => a.tier === 'KEEP').reduce((s, a) => s + a.count, 0),
  };

  const payload = {
    builtAt: new Date().toISOString(),
    provider,
    email: getMailConfig(provider).email,
    stats,
    albumCount: albums.length,
    albums,
  };

  writeFileSync(resolve(outDir, 'album.json'), JSON.stringify(payload, null, 2), 'utf8');

  return payload;
}

function main() {
  const provider = parseArgs();
  const payload = buildAlbum(provider);
  const outDir = getOutDir(provider);
  console.log(`相簿索引: ${resolve(outDir, 'album.json')}`);
  console.log(`  建议删除: ${payload.stats.DELETE} 封`);
  console.log(`  待确认: ${payload.stats.REVIEW} 封`);
  console.log(`  保留: ${payload.stats.KEEP} 封`);
}

main();
