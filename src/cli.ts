import { getMailConfig, type MailProvider } from './config.js';
import { deleteMessages, deleteMessagesByUids, searchMessages, withMailClient } from './mail-client.js';

type Command = 'list' | 'delete';

type CliOptions = {
  provider: MailProvider;
  mailbox: string;
  from?: string;
  subject?: string;
  before?: string;
  limit?: number;
  offset?: number;
  confirm: boolean;
  uids?: number[];
};

function printUsage() {
  console.log(`
邮箱 CLI（IMAP，支持 163 / QQ）

用法:
  pnpm list   [--provider 163|qq] [--mailbox INBOX] [--from xxx] [--subject xxx] [--before YYYY-MM-DD] [--limit 20]
  pnpm delete [--provider 163|qq] [--mailbox INBOX] [--from xxx] [--subject xxx] [--before YYYY-MM-DD] [--limit 20] [--confirm]

说明:
  - --provider 默认 163；QQ 邮箱用 --provider qq
  - delete 默认只预览，不会真删；加上 --confirm 才会删除
  - 授权码写在项目根目录 .env 里，参考 .env.example
`);
}

function parseArgs(argv: string[]): { command: Command | null; options: CliOptions } {
  const [, , commandRaw, ...rest] = argv;
  const command = commandRaw === 'list' || commandRaw === 'delete' ? commandRaw : null;

  const options: CliOptions = {
    provider: '163',
    mailbox: 'INBOX',
    confirm: false,
  };

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const next = rest[i + 1];

    switch (arg) {
      case '--provider':
        if (next === '163' || next === 'qq') {
          options.provider = next;
        }
        i += 1;
        break;
      case '--mailbox':
        options.mailbox = next;
        i += 1;
        break;
      case '--from':
        options.from = next;
        i += 1;
        break;
      case '--subject':
        options.subject = next;
        i += 1;
        break;
      case '--before':
        options.before = next;
        i += 1;
        break;
      case '--limit':
        options.limit = Number(next);
        i += 1;
        break;
      case '--offset':
        options.offset = Number(next);
        i += 1;
        break;
      case '--confirm':
        options.confirm = true;
        break;
      case '--uid':
        options.uids = options.uids || [];
        options.uids.push(Number(next));
        i += 1;
        break;
      default:
        break;
    }
  }

  return { command, options };
}

function printMessages(messages: Awaited<ReturnType<typeof searchMessages>>) {
  if (messages.length === 0) {
    console.log('没有匹配的邮件。');
    return;
  }

  console.log(`共 ${messages.length} 封:\n`);
  for (const message of messages) {
    console.log(`- UID ${message.uid}`);
    console.log(`  时间: ${message.date}`);
    console.log(`  发件人: ${message.from}`);
    console.log(`  主题: ${message.subject}`);
    console.log('');
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv);

  if (!command) {
    printUsage();
    process.exit(command === null ? 1 : 0);
  }

  const mailConfig = getMailConfig(options.provider);
  console.log(`当前邮箱: ${mailConfig.email} (${options.provider})\n`);

  if (command === 'list') {
    const messages = await withMailClient(mailConfig, (client) => searchMessages(client, options));
    printMessages(messages);
    return;
  }

  if (options.uids && options.uids.length > 0) {
    if (!options.confirm) {
      console.log('这是预览模式，没有删除任何邮件。');
      console.log('确认删除请重新运行并加上 --confirm');
      return;
    }
    const deleted = await withMailClient(mailConfig, (client) =>
      deleteMessagesByUids(client, mailConfig, options.uids!),
    );
    console.log(`已删除 ${deleted} 封邮件。`);
    return;
  }

  const messages = await withMailClient(mailConfig, (client) => searchMessages(client, options));
  printMessages(messages);

  if (messages.length === 0) {
    return;
  }

  if (!options.confirm) {
    console.log('这是预览模式，没有删除任何邮件。');
    console.log('确认删除请重新运行并加上 --confirm');
    return;
  }

  const deleted = await withMailClient(mailConfig, (client) =>
    deleteMessages(client, mailConfig, options),
  );
  console.log(`已删除 ${deleted.length} 封邮件。`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`错误: ${message}`);
  process.exit(1);
});
