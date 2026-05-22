import type { MessageStructureObject } from 'imapflow';

export function findTextPart(node: MessageStructureObject): string | null {
  if (node.type === 'text/plain' && node.part) return node.part;
  for (const child of node.childNodes || []) {
    const part = findTextPart(child);
    if (part) return part;
  }
  return null;
}

export function findHtmlPart(node: MessageStructureObject): string | null {
  if (node.type === 'text/html' && node.part) return node.part;
  for (const child of node.childNodes || []) {
    const part = findHtmlPart(child);
    if (part) return part;
  }
  return null;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
