export type MailRow = {
  uid: number;
  date: string;
  from: string;
  subject: string;
};

export type Tier = 'DELETE' | 'KEEP' | 'REVIEW';

/** 粗筛：只看发件人/主题，明显的不读正文 */
export function coarseClassify(row: MailRow): Tier {
  const addr = row.from.toLowerCase();
  const subj = row.subject.toLowerCase();
  const text = `${row.from} ${row.subject}`.toLowerCase();

  const keepHints = [
    'customer invoice', 'payment confirmation', 'invoice overdue',
    'invoice', 'receipt', '账单', '合同', 'offer letter', '录用', '面试',
    '工资', 'statement', '订单确认', '行程单', 'boarding', 'itinerary',
    '报销', '转账', '汇款', '还款',
  ];
  if (keepHints.some((h) => text.includes(h))) return 'KEEP';

  const deleteDomains = [
    'notifications@github.com', 'message.cmbchina.com', 'codepen.io',
    'discord.com', 'quora.com', 'myprotein.com', 'n.myprotein.com',
    'designbyhumans.com', 'explore.pinterest.com', 'coffeehall.cn',
    'edmsend.csdn.net', 'white.csdn.net', 'accts.epicgames.com',
    'club@tencent.com', 'qzone@tencent.com',
  ];
  if (deleteDomains.some((d) => addr.includes(d))) return 'DELETE';

  const deleteHints = [
    'verification code', 'email verification', 'verify your email',
    '验证码', 'dependabot', 'unsubscribe', 'newsletter', '信用管家',
    '限时闪促', '闪促', 'giveaway', 'webinar', 'pins waiting',
    '黄钻', 'qq会员', '万元红包', '共享万元', '找回小程序', '请激活你的微信',
    '邮箱接收消息验证', '微信接收消息验证', '短信审核结果', '审核结果通知',
    '好友申请，可在企业微信', '促销', '订阅', 'digest',
    '播放铃声', '已找到', '查找', 'find my', 'play a sound',
    'left behind', '分离', '定位通知',
    'failed production deployment', 'failed preview deployment', 'failed  deployment',
  ];
  if (deleteHints.some((h) => text.includes(h))) {
    if (row.subject.includes('验证码组件')) return 'KEEP';
    return 'DELETE';
  }

  const reviewDomains = [
    'apple.com', 'tencent.com', '163.com', 'amazon.com', 'icloud.com',
    'insideapple', 'qq.com', 'huawei.com', 'alipay.com', 'cmbchina.com',
    'ssl-mail.com', 'airbnb.com', 'anthropic.com',
  ];
  if (reviewDomains.some((d) => addr.includes(d))) return 'REVIEW';

  if (subj.includes('invoice') || subj.includes('bill') || subj.includes('payment')) {
    return 'REVIEW';
  }

  const year = Number(row.date.slice(0, 4));
  if (year && year <= 2020) return 'DELETE';

  return 'REVIEW';
}

/** 精排：读过正文后再判 */
export function fineClassify(row: MailRow, body: string): 'DELETE' | 'KEEP' {
  const text = `${row.subject}\n${body}`.toLowerCase();

  const keepHints = [
    'invoice', 'receipt', '账单', 'balance due', 'due date', 'payment confirmation',
    '合同', 'offer', '录用', '面试', '工资', '订单号', 'order number',
    'tax', 'statement', '报销', '转账', '汇款', '还款', '逾期', '欠费',
    'amount due', 'total:', '合计', '金额',
  ];
  if (keepHints.some((h) => text.includes(h))) return 'KEEP';

  const deleteHints = [
    'verification code', '验证码', 'verify your email', 'confirm your email',
    'unsubscribe', '退订', 'click here to unsubscribe', '营销', '促销',
    'limited time', '限时', 'newsletter', 'weekly digest', '审核结果',
    '消息验证', '激活你的', '找回密码', 'reset your password',
    'your code is', 'expires in', '有效期', '此验证码',
    '播放铃声', '已找到', '停用"查找"', '停用“查找”', 'find my',
    'play a sound', 'sound played', 'located your', 'left behind',
  ];
  if (deleteHints.some((h) => text.includes(h))) return 'DELETE';

  // 设备/账号即时通知，无账单合同信息 → 删
  const notifyHints = ['铃声', '已找到', '查找', '定位', 'login attempt', 'new sign-in'];
  const importantHints = ['invoice', 'receipt', '账单', '合同', '订单', 'payment', '金额', 'offer'];
  if (notifyHints.some((h) => row.subject.includes(h)) && !importantHints.some((h) => text.includes(h))) {
    return 'DELETE';
  }

  if (body.length < 120 && (text.includes('验证') || text.includes('verify'))) {
    return 'DELETE';
  }

  return 'KEEP';
}
