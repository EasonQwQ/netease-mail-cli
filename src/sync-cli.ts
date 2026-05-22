import { syncMailbox } from './mail-sync.js';
import type { MailProvider } from './config.js';

const provider: MailProvider = process.argv.includes('--provider') && process.argv[process.argv.indexOf('--provider') + 1] === 'qq' ? 'qq' : '163';

const result = await syncMailbox(provider);
console.log(result);
