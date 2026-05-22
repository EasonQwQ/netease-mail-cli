const ACCOUNTS = {
  qq: { dataPath: '/data/mails-qq', label: 'QQ 邮箱' },
  '163': { dataPath: '/data/mails', label: '163 邮箱' },
};

const TIER_META = {
  DELETE: { title: '建议删除', desc: 'AI 判定：营销 / 验证码 / 过期通知', laneClass: 'tier-DELETE' },
  REVIEW: { title: '待你确认', desc: '拿不准的，翻一翻再决定', laneClass: 'tier-REVIEW' },
  KEEP: { title: '珍藏夹', desc: '账单 / 合同 / 重要往来', laneClass: 'tier-KEEP' },
};

const state = {
  account: 'qq',
  album: null,
  openAlbum: null,
  marks: new Set(),
  selectedUid: null,
};

function dataPath() {
  return ACCOUNTS[state.account].dataPath;
}

function loadMarks() {
  try {
    const raw = localStorage.getItem(`marks:${state.account}`);
    state.marks = new Set(raw ? JSON.parse(raw) : []);
  } catch {
    state.marks = new Set();
  }
}

function saveMarks() {
  localStorage.setItem(`marks:${state.account}`, JSON.stringify([...state.marks]));
}

function escapeHtml(t) {
  return String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return '未知日期';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10) || '未知';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
}

function polaroidColor(hue) {
  return `hsl(${hue} 45% 88%)`;
}

function polaroidAccent(hue, tier) {
  if (tier === 'DELETE') return '#ef4444';
  if (tier === 'REVIEW') return '#f59e0b';
  return `hsl(${hue} 55% 42%)`;
}

function getWebMailLinks(account, mail) {
  const subject = encodeURIComponent(mail.subject || '');
  const fromRaw = (mail.from || '').match(/<([^>]+)>/)?.[1] || mail.from || '';
  const sender = encodeURIComponent(fromRaw);

  if (account === 'qq') {
    const links = [
      {
        label: '在 QQ 邮箱搜索此主题',
        url: `https://mail.qq.com/cgi-bin/mail_list?folderid=1&page=0&Fun=searchmail&searchmode=subject&subject=${subject}&sender=${sender}`,
        primary: true,
        hint: '最稳妥：登录后按主题定位，核对网页正文',
      },
      {
        label: 'QQ 邮箱 UID 直达',
        url: `https://mail.qq.com/cgi-bin/readmail?folderid=1&mailid=${mail.uid}&t=readmail`,
        hint: `IMAP UID ${mail.uid}，部分邮件可直达`,
      },
      {
        label: 'QQ 邮箱（新版）',
        url: 'https://wx.mail.qq.com/',
        hint: '打开后可在顶部搜索主题',
      },
    ];
    if (mail.messageId) {
      const mid = encodeURIComponent(mail.messageId.replace(/^<|>$/g, ''));
      links.unshift({
        label: 'Message-ID 直达',
        url: `https://mail.qq.com/cgi-bin/readmail?folderid=1&mailid=${mid}&t=readmail`,
        primary: true,
        hint: '按邮件 Message-ID 打开',
      });
    }
    return links;
  }

  return [
    {
      label: '在 163 邮箱搜索主题',
      url: `https://mail.163.com/`,
      primary: true,
      hint: '登录后在收件箱搜索主题核对',
    },
    {
      label: '163 UID 尝试',
      url: `https://mail.163.com/js6/main.jsp#module=mbox.ReadMailModule&uid=${mail.uid}`,
      hint: `UID ${mail.uid}`,
    },
  ];
}

function renderWebMailLinks(account, mail) {
  const links = getWebMailLinks(account, mail);
  return `
    <div class="detail-links">
      <div class="detail-link-row" style="justify-content:space-between">
        <span class="detail-links-title">网页邮箱直达</span>
        <button type="button" class="btn btn-ghost" data-copy-subject style="font-size:0.72rem;padding:0.35rem 0.6rem">复制主题</button>
      </div>
      ${links
        .map(
          (l) => `
        <div class="detail-link-row">
          <a href="${l.url}" target="_blank" rel="noopener noreferrer" class="${l.primary ? 'detail-link-primary' : 'detail-link-secondary'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            ${escapeHtml(l.label)}
          </a>
        </div>
        <p class="detail-link-hint">${escapeHtml(l.hint)}</p>`,
        )
        .join('')}
      <p class="detail-meta-row">本地正文状态: ${escapeHtml(mail.bodyStatus || '未知')} · UID ${mail.uid}</p>
    </div>`;
}

function renderStats() {
  const s = state.album?.stats || { DELETE: 0, REVIEW: 0, KEEP: 0 };
  document.getElementById('stats-pills').innerHTML = `
    <span class="pill pill-delete">删 ${s.DELETE}</span>
    <span class="pill pill-review">疑 ${s.REVIEW}</span>
    <span class="pill pill-keep">留 ${s.KEEP}</span>
    <span class="pill" style="background:#27272a;color:#a1a1aa">${state.album?.albumCount || 0} 册</span>`;
}

function renderAlbumCover(album) {
  const samples = album.mails.slice(0, 3);
  const cards = samples
    .map((m, i) => {
      const subj = escapeHtml(m.subject.slice(0, 42));
      return `<div class="polaroid polaroid-${i + 1}" style="background:${polaroidColor(album.hue)}">
        <div style="font-weight:700;margin-bottom:4px">${escapeHtml(album.title.slice(0, 18))}</div>
        ${subj}
      </div>`;
    })
    .join('');

  return `
    <article class="album-cover ${TIER_META[album.tier].laneClass}" data-album-id="${album.id}">
      <div class="album-stack">${cards || '<div class="polaroid polaroid-1">空册</div>'}</div>
      <div class="album-meta">
        <h3>${escapeHtml(album.title)}</h3>
        <p>${escapeHtml(album.reason)}</p>
        <span class="badge-count">${album.count} 张</span>
      </div>
    </article>`;
}

function renderLanes() {
  const root = document.getElementById('lanes');
  const tiers = ['DELETE', 'REVIEW', 'KEEP'];

  root.innerHTML = tiers
    .map((tier) => {
      const albums = state.album.albums.filter((a) => a.tier === tier);
      const meta = TIER_META[tier];
      return `
        <section class="lane ${meta.laneClass}">
          <div class="lane-header">
            <h2>${meta.title}</h2>
            <span>${meta.desc} · ${albums.reduce((n, a) => n + a.count, 0)} 封</span>
          </div>
          <div class="lane-scroll">
            ${albums.map(renderAlbumCover).join('') || '<p class="lane-empty">这一栏是空的</p>'}
          </div>
        </section>`;
    })
    .join('');

  root.querySelectorAll('.album-cover').forEach((el) => {
    el.addEventListener('click', () => openAlbum(el.dataset.albumId));
  });
}

function findMailMeta(uid) {
  for (const album of state.album?.albums || []) {
    const mail = album.mails.find((m) => m.uid === uid);
    if (mail) return { ...mail, albumTitle: album.title, albumId: album.id };
  }
  return null;
}

function getMarkedMails() {
  return [...state.marks]
    .map((uid) => {
      const meta = findMailMeta(uid);
      if (meta) return meta;
      return {
        uid,
        subject: `邮件 UID ${uid}`,
        from: '（索引中未找到，可能已同步删除）',
        date: '',
        albumTitle: '—',
        albumId: null,
      };
    })
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
}

function updateFab() {
  const fab = document.getElementById('fab');
  const n = state.marks.size;
  if (n === 0) {
    fab.classList.add('hidden');
    closeMarkedSheet();
    return;
  }
  fab.classList.remove('hidden');
  document.getElementById('fab-count-num').textContent = String(n);

  if (!document.getElementById('marked-sheet').classList.contains('hidden')) {
    renderMarkedSheet();
  }
}

function renderMarkedSheet() {
  const list = document.getElementById('marked-sheet-list');
  const mails = getMarkedMails();
  document.getElementById('marked-sheet-sub').textContent = `共 ${mails.length} 封 · 点击可查看详情`;

  if (mails.length === 0) {
    list.innerHTML = '<p class="marked-sheet-empty">暂无标记</p>';
    return;
  }

  list.innerHTML = mails
    .map(
      (m) => `
    <div class="marked-row" data-uid="${m.uid}">
      <div class="marked-row-body">
        <h4>${escapeHtml(m.subject)}</h4>
        <p>${escapeHtml(m.from)} · ${formatDate(m.date)}</p>
        <div class="marked-row-album">来自：${escapeHtml(m.albumTitle)}</div>
      </div>
      <button type="button" class="marked-row-unmark" data-unmark="${m.uid}" aria-label="取消标记" title="取消标记">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`,
    )
    .join('');

  list.querySelectorAll('.marked-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-unmark]')) return;
      const uid = Number(row.dataset.uid);
      const meta = findMailMeta(uid);
      if (meta?.albumId) {
        openAlbum(meta.albumId);
        showDetail(uid);
      } else {
        showDetail(uid);
      }
    });
  });

  list.querySelectorAll('[data-unmark]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.marks.delete(Number(btn.dataset.unmark));
      saveMarks();
      updateFab();
      renderCardGrid();
    });
  });
}

function openMarkedSheet() {
  const sheet = document.getElementById('marked-sheet');
  sheet.classList.remove('hidden');
  sheet.setAttribute('aria-hidden', 'false');
  document.getElementById('btn-show-marked').setAttribute('aria-expanded', 'true');
  renderMarkedSheet();
  updateScrollLock();
}

function closeMarkedSheet() {
  const sheet = document.getElementById('marked-sheet');
  if (sheet.classList.contains('hidden')) return;
  sheet.classList.add('hidden');
  sheet.setAttribute('aria-hidden', 'true');
  document.getElementById('btn-show-marked')?.setAttribute('aria-expanded', 'false');
  updateScrollLock();
}

function renderCardGrid() {
  const album = state.openAlbum;
  if (!album) return;

  const grid = document.getElementById('card-grid');
  grid.innerHTML = album.mails
    .map(
      (m) => `
    <div class="mail-card ${state.marks.has(m.uid) ? 'marked-delete' : ''}" data-uid="${m.uid}" tabindex="0">
      <h4>${escapeHtml(m.subject)}</h4>
      <div class="from">${escapeHtml(m.from)}</div>
      <div class="preview">${escapeHtml(m.preview || '（无预览）')}</div>
      <div class="date">${formatDate(m.date)} · ${escapeHtml(m.reason)}</div>
    </div>`,
    )
    .join('');

  grid.querySelectorAll('.mail-card').forEach((card) => {
    card.addEventListener('click', () => showDetail(Number(card.dataset.uid)));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        toggleMark(Number(card.dataset.uid));
        card.classList.toggle('marked-delete', state.marks.has(Number(card.dataset.uid)));
        updateFab();
      }
    });
  });
}

function openAlbum(id) {
  const album = state.album.albums.find((a) => a.id === id);
  if (!album) return;
  state.openAlbum = album;

  document.getElementById('lb-title').textContent = album.title;
  document.getElementById('lb-sub').textContent = `${album.subtitle} · ${album.count} 封 · ${album.reason}`;
  document.getElementById('lightbox').classList.add('open');
  document.getElementById('lightbox').setAttribute('aria-hidden', 'false');
  renderCardGrid();
  updateScrollLock();
}

function updateScrollLock() {
  const detailOpen = document.getElementById('detail-panel').classList.contains('open');
  const lightboxOpen = document.getElementById('lightbox').classList.contains('open');
  const confirmOpen = !document.getElementById('confirm-modal').classList.contains('hidden');
  const markedOpen = !document.getElementById('marked-sheet').classList.contains('hidden');
  const backdrop = document.getElementById('detail-backdrop');

  document.body.classList.toggle('scroll-lock', detailOpen || lightboxOpen || confirmOpen || markedOpen);
  document.body.classList.toggle('detail-open', detailOpen);
  backdrop?.classList.toggle('visible', detailOpen);
  backdrop?.setAttribute('aria-hidden', detailOpen ? 'false' : 'true');
}

function closeDetailPanel() {
  document.getElementById('detail-panel').classList.remove('open');
  state.selectedUid = null;
  updateScrollLock();
}

function closeAlbum() {
  state.openAlbum = null;
  closeDetailPanel();
  document.getElementById('lightbox').classList.remove('open');
  document.getElementById('lightbox').setAttribute('aria-hidden', 'true');
  updateScrollLock();
}

function toggleMark(uid) {
  if (state.marks.has(uid)) state.marks.delete(uid);
  else state.marks.add(uid);
  saveMarks();
  updateFab();
}

function markAlbumDelete() {
  if (!state.openAlbum) return;
  for (const m of state.openAlbum.mails) state.marks.add(m.uid);
  saveMarks();
  renderCardGrid();
  updateFab();
}

async function showDetail(uid) {
  state.selectedUid = uid;
  const panel = document.getElementById('detail-panel');
  const body = document.getElementById('detail-body');
  panel.classList.add('open');
  updateScrollLock();

  const mail = state.openAlbum?.mails.find((m) => m.uid === uid);
  document.getElementById('detail-title').textContent = mail?.subject?.slice(0, 40) || `UID ${uid}`;
  body.innerHTML = '<p style="color:#a1a1aa">加载正文…</p>';

  const res = await fetch(`${dataPath()}/${uid}.json`);
  if (!res.ok) {
    body.innerHTML = '<p>无法加载</p>';
    return;
  }
  const full = await res.json();
  const html = full.bodyHtml?.trim();
  const text = full.bodyText?.trim();

  document.getElementById('detail-title').textContent = full.subject;
  const bodyStatus = full.bodyStatus || (html || text ? 'ok' : 'empty');
  body.innerHTML = `
    <p style="color:#a1a1aa;font-size:0.75rem">${escapeHtml(full.from)}<br>${formatDate(full.date)}</p>
    ${renderWebMailLinks(state.account, { ...full, bodyStatus })}
    <div style="margin:0 1rem 1rem 0;display:flex;gap:0.5rem;flex-wrap:wrap">
      <button type="button" class="btn btn-danger" id="detail-delete-now">删除此封</button>
      <button type="button" class="btn btn-ghost" id="detail-mark-del">标记</button>
      <button type="button" class="btn btn-keep" id="detail-unmark">取消标记</button>
    </div>
    <div class="mail-html">${html || `<pre style="white-space:pre-wrap">${escapeHtml(text || '（本地无正文，请用上方链接到 QQ 邮箱核对）')}</pre>`}</div>`;

  body.querySelector('[data-copy-subject]')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(full.subject || '');
    showToast('主题已复制，可在 QQ 邮箱搜索框粘贴', 'ok');
  });

  document.getElementById('detail-mark-del').onclick = () => {
    state.marks.add(uid);
    saveMarks();
    updateFab();
    renderCardGrid();
  };
  document.getElementById('detail-unmark').onclick = () => {
    state.marks.delete(uid);
    saveMarks();
    updateFab();
    renderCardGrid();
  };
  document.getElementById('detail-delete-now').onclick = () => deleteOne(uid);
}

let confirmResolve = null;

function confirmDialog({ title = '确认删除', message = '', confirmText = '确认删除' } = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-ok').textContent = confirmText;

    confirmResolve = resolve;
    modal.classList.remove('hidden');
    updateScrollLock();
    document.getElementById('confirm-ok').focus();
  });
}

function closeConfirm(result) {
  const modal = document.getElementById('confirm-modal');
  if (modal.classList.contains('hidden')) return;

  modal.classList.add('hidden');
  updateScrollLock();
  if (confirmResolve) {
    confirmResolve(result);
    confirmResolve = null;
  }
}

function showToast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), 4000);
}

function setLoading(on, msg = '删除中…') {
  const el = document.getElementById('loading-overlay');
  document.getElementById('loading-msg').textContent = msg;
  el.classList.toggle('hidden', !on);
}

async function apiDelete(uids, confirmMsg) {
  const list = [...new Set(uids)];
  if (list.length === 0) {
    showToast('没有选中任何邮件', 'err');
    return null;
  }

  const ok = await confirmDialog({
    title: '确认删除',
    message: confirmMsg || `确定删除 ${list.length} 封邮件？`,
    confirmText: `删除 ${list.length} 封`,
  });
  if (!ok) return null;

  setLoading(true, `正在删除 ${list.length} 封…`);
  try {
    const res = await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: state.account, uids: list }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    for (const uid of list) state.marks.delete(uid);
    saveMarks();
    updateFab();

    await reloadAlbum();
    closeDetailPanel();
    showToast(`已删除 ${data.deleted} 封`, 'ok');
    return data;
  } catch (err) {
    showToast(`删除失败: ${err.message}`, 'err');
    return null;
  } finally {
    setLoading(false);
  }
}

async function deleteOpenAlbum() {
  if (!state.openAlbum) return;
  const uids = state.openAlbum.mails.map((m) => m.uid);
  await apiDelete(
    uids,
    `将删除整册「${state.openAlbum.title}」中的全部 ${uids.length} 封邮件。`,
  );
}

async function deleteMarked() {
  const mails = getMarkedMails();
  const preview = mails
    .slice(0, 3)
    .map((m) => `· ${m.subject.slice(0, 30)}`)
    .join('\n');
  const more = mails.length > 3 ? `\n…等共 ${mails.length} 封` : '';
  await apiDelete([...state.marks], `将删除以下邮件：\n${preview}${more}`);
}

async function deleteOne(uid) {
  const mail = state.openAlbum?.mails.find((m) => m.uid === uid);
  const subj = mail?.subject?.slice(0, 48) || `UID ${uid}`;
  await apiDelete([uid], `将删除「${subj}」这封邮件。`);
}

function exportDeleteList() {
  const uids = [...state.marks];
  const payload = {
    provider: state.account,
    exportedAt: new Date().toISOString(),
    count: uids.length,
    uids,
    cliHint: `pnpm delete --provider ${state.account} --uid ${uids[0]} ... --confirm`,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `delete-queue-${state.account}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function reloadAlbum() {
  const res = await fetch(`${dataPath()}/album.json?t=${Date.now()}`);
  if (!res.ok) throw new Error('相簿加载失败');
  state.album = await res.json();
  renderStats();
  renderLanes();

  if (state.openAlbum) {
    const still = state.album.albums.find((a) => a.id === state.openAlbum.id);
    if (still && still.count > 0) {
      state.openAlbum = still;
      renderCardGrid();
    } else {
      closeAlbum();
      closeDetailPanel();
    }
  }
}

async function syncFromMailbox() {
  const btn = document.getElementById('btn-sync');
  btn.disabled = true;
  btn.classList.add('syncing');
  setLoading(true, '正在从邮箱同步…');

  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: state.account }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

    if (data.removedUids?.length) {
      for (const uid of data.removedUids) state.marks.delete(uid);
      saveMarks();
      updateFab();
    }

    await reloadAlbum();

    const parts = [];
    if (data.removed > 0) parts.push(`移除 ${data.removed} 封`);
    if (data.added > 0) parts.push(`新增 ${data.added} 封`);
    showToast(parts.length ? `同步完成：${parts.join('，')}` : '已是最新，无变化', 'ok');
  } catch (err) {
    showToast(`同步失败: ${err.message}`, 'err');
  } finally {
    btn.disabled = false;
    btn.classList.remove('syncing');
    setLoading(false);
  }
}

async function loadAccount(account) {
  state.account = account;
  loadMarks();
  document.querySelectorAll('[data-account]').forEach((b) => {
    b.classList.toggle('active', b.dataset.account === account);
  });

  document.getElementById('loading').style.display = 'flex';
  document.getElementById('lanes').innerHTML = '<div class="loading-screen" id="loading">正在整理相簿…</div>';

  const res = await fetch(`${dataPath()}/album.json?t=${Date.now()}`);
  if (!res.ok) {
    document.getElementById('lanes').innerHTML = `
      <div class="loading-screen">
        <div style="text-align:center">
          <p>还没有相簿索引</p>
          <p style="font-size:0.8rem;color:#71717a">请运行: pnpm build:album:${account === 'qq' ? 'qq' : '163'}</p>
        </div>
      </div>`;
    return;
  }

  state.album = await res.json();
  document.getElementById('account-label').textContent = `${ACCOUNTS[account].label} · AI 已分册`;
  renderStats();
  renderLanes();
  updateFab();
}

function bindUi() {
  document.querySelectorAll('[data-account]').forEach((btn) => {
    btn.addEventListener('click', () => {
      location.hash = btn.dataset.account === '163' ? '163' : 'qq';
      loadAccount(btn.dataset.account);
    });
  });

  document.getElementById('lb-close').addEventListener('click', closeAlbum);
  document.getElementById('lb-mark-all-delete').addEventListener('click', markAlbumDelete);
  document.getElementById('lb-delete-album').addEventListener('click', deleteOpenAlbum);
  document.getElementById('btn-execute-delete').addEventListener('click', deleteMarked);
  document.getElementById('btn-sync').addEventListener('click', syncFromMailbox);
  document.getElementById('detail-close').addEventListener('click', closeDetailPanel);
  document.getElementById('detail-backdrop').addEventListener('click', closeDetailPanel);
  document.getElementById('btn-clear-marks').addEventListener('click', () => {
    state.marks.clear();
    saveMarks();
    renderCardGrid();
    updateFab();
  });
  document.getElementById('btn-show-marked').addEventListener('click', () => {
    const sheet = document.getElementById('marked-sheet');
    if (sheet.classList.contains('hidden')) openMarkedSheet();
    else closeMarkedSheet();
  });
  document.getElementById('marked-sheet-close').addEventListener('click', closeMarkedSheet);
  document.getElementById('marked-sheet-backdrop').addEventListener('click', closeMarkedSheet);
  document.getElementById('btn-export-delete').addEventListener('click', exportDeleteList);
  document.getElementById('btn-execute-delete-sheet').addEventListener('click', () => {
    closeMarkedSheet();
    deleteMarked();
  });

  document.getElementById('confirm-ok').addEventListener('click', () => closeConfirm(true));
  document.querySelectorAll('[data-confirm-cancel]').forEach((el) => {
    el.addEventListener('click', () => closeConfirm(false));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    const confirmModal = document.getElementById('confirm-modal');
    const detailPanel = document.getElementById('detail-panel');
    const lightbox = document.getElementById('lightbox');

    if (!confirmModal.classList.contains('hidden')) {
      closeConfirm(false);
      e.preventDefault();
      return;
    }

    const markedSheet = document.getElementById('marked-sheet');
    if (!markedSheet.classList.contains('hidden')) {
      closeMarkedSheet();
      e.preventDefault();
      return;
    }

    if (detailPanel.classList.contains('open')) {
      closeDetailPanel();
      e.preventDefault();
      return;
    }

    if (lightbox.classList.contains('open')) {
      closeAlbum();
      e.preventDefault();
    }
  });
}

async function init() {
  bindUi();
  const account = location.hash === '#163' ? '163' : 'qq';
  await loadAccount(account);
}

init();
