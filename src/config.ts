import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '.env') });

export type MailProvider = '163' | 'qq';

export type MailConfig = {
  provider: MailProvider;
  email: string;
  authCode: string;
  imapHost: string;
  imapPort: number;
  trashFolder?: string;
};

const PROVIDER_DEFAULTS: Record<
  MailProvider,
  { imapHost: string; imapPort: number; trashFolder?: string }
> = {
  '163': { imapHost: 'imap.163.com', imapPort: 993 },
  qq: { imapHost: 'imap.qq.com', imapPort: 993, trashFolder: 'Deleted Messages' },
};

export function getMailConfig(provider: MailProvider = '163'): MailConfig {
  if (provider === 'qq') {
    const email = process.env.QQ_EMAIL?.trim();
    const authCode = process.env.QQ_AUTH_CODE?.trim();

    if (!email || !authCode) {
      throw new Error('请在 .env 中配置 QQ_EMAIL 和 QQ_AUTH_CODE');
    }

    return {
      provider,
      email,
      authCode,
      imapHost: process.env.QQ_IMAP_HOST?.trim() || PROVIDER_DEFAULTS.qq.imapHost,
      imapPort: Number(process.env.QQ_IMAP_PORT || PROVIDER_DEFAULTS.qq.imapPort),
      trashFolder: PROVIDER_DEFAULTS.qq.trashFolder,
    };
  }

  const email = process.env.NETEASE_EMAIL?.trim();
  const authCode = process.env.NETEASE_AUTH_CODE?.trim();

  if (!email || !authCode) {
    throw new Error('请在 .env 中配置 NETEASE_EMAIL 和 NETEASE_AUTH_CODE（可参考 .env.example）');
  }

  return {
    provider,
    email,
    authCode,
    imapHost: process.env.NETEASE_IMAP_HOST?.trim() || PROVIDER_DEFAULTS['163'].imapHost,
    imapPort: Number(process.env.NETEASE_IMAP_PORT || PROVIDER_DEFAULTS['163'].imapPort),
  };
}
