/**
 * 🚀 DocReview Studio — Interactive Web Workspace Controller
 * Điều phối Rà soát Bôi đen (Inline Highlights), Track Changes, Chấm điểm 5 Trục SVG Radar,
 * So sánh Phiên bản (Word Diff), Cổng Phê duyệt (Sign-Off Gate) & Xuất/Nhập .DOCX/.MD
 */

const state = {
  clientId: `cli-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`,
  profiles: [],
  governance: { customProfiles: [], glossaryRules: [] },
  presence: [],
  aiConfig: { hasOpenAI: false, hasGemini: false },
  documents: [],
  currentDoc: null,
  activeMode: 'review', // 'review' | 'edit' | 'diff'
  activeTab: 'quality', // 'quality' | 'comments' | 'suggestions' | 'approval'
  commentFilter: 'ALL',
  diffLayout: 'unified', // 'unified' | 'split'
  lastDiffResult: null,
  selectedQuote: '',
  isEditorDirty: false,
  sseSource: null,
  isSpeakingTts: false,
  cmdFilteredItems: [],
  cmdSelectedIndex: 0
};

// ============================================================================
// TIỆN ÍCH CHUNG & GỌI API
// ============================================================================

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(msg, type = 'info') {
  const wrap = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : ''}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, 3400);
}

function getActivePersona() {
  const sel = document.getElementById('personaSelect').value;
  if (sel === 'CUSTOM') {
    const raw = document.getElementById('customPersonaInput').value.trim();
    if (raw.includes('|')) {
      const [author, role] = raw.split('|').map((s) => s.trim());
      return { author: author || 'Reviewer', role: role || 'Reviewer' };
    }
    return { author: raw || 'Reviewer', role: 'Guest Reviewer' };
  }
  const [author, role] = sel.split('|');
  return { author, role };
}

async function apiFetch(url, options = {}) {
  const opts = { ...options };
  opts.headers = { 'X-Client-Id': state.clientId, ...(opts.headers || {}) };
  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
    opts.headers = { 'Content-Type': 'application/json', ...opts.headers };
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({ ok: false, error: 'Phản hồi không hợp lệ' }));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `Lỗi HTTP ${res.status}`);
    err.code = data.code;
    err.gate = data.gate;
    throw err;
  }
  return data;
}

function formatTimeShort(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit'
    });
  } catch {
    return iso;
  }
}

// ============================================================================
// KHỞI ĐỘNG & TẢI DỮ LIỆU
// ============================================================================

async function initApp() {
  const savedTheme = localStorage.getItem('docreview_theme') || 'light';
  setTheme(savedTheme);

  bindGlobalEvents();

  try {
    const [healthData, govData, docsData] = await Promise.all([
      apiFetch('/api/health'),
      apiFetch('/api/governance'),
      apiFetch('/api/documents')
    ]);

    state.aiConfig = healthData.aiConfig || {};
    state.governance = govData.governance || { customProfiles: [], glossaryRules: [] };
    state.profiles = govData.profiles || [];
    state.documents = docsData.documents || [];

    populateProfileSelects();
    renderDocList();

    if (state.documents.length > 0) {
      await selectDocument(state.documents[0].id);
    }

    connectRealtimeSSE();
  } catch (err) {
    showToast(`Không thể khởi tạo dữ liệu: ${err.message}`, 'error');
  }
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('docreview_theme', theme);
  document.getElementById('btnThemeToggle').textContent = theme === 'dark' ? '☀️' : '🌙';
  if (state.currentDoc) {
    renderRadarChart(state.currentDoc.qualityReport.axes);
  }
}

function populateProfileSelects() {
  const optionsHtml = state.profiles
    .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.icon)} ${escapeHtml(p.name)}</option>`)
    .join('');
  document.getElementById('profileSelect').innerHTML = optionsHtml;
  document.getElementById('newDocProfile').innerHTML = optionsHtml;
}

async function selectDocument(docId) {
  if (state.isEditorDirty) {
    const ok = window.confirm('Bạn có thay đổi trong trình soạn thảo chưa lưu. Chuyển tài liệu và bỏ qua nháp chưa lưu?');
    if (!ok) return;
    state.isEditorDirty = false;
    document.getElementById('unsavedDot').classList.add('hidden');
  }

  try {
    const data = await apiFetch(`/api/documents/${encodeURIComponent(docId)}`);
    state.currentDoc = data.document;
    state.lastDiffResult = null;
    renderDocList();
    renderCurrentDocument();
    reportPresence();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================================
// REALTIME SSE COLLABORATION & LIVE PRESENCE
// ============================================================================

function connectRealtimeSSE() {
  if (state.sseSource) {
    state.sseSource.close();
  }
  const persona = getActivePersona();
  const qs = new URLSearchParams({
    clientId: state.clientId,
    author: persona.author,
    role: persona.role,
    docId: state.currentDoc?.id || '',
    mode: state.activeMode
  });

  const es = new EventSource(`/api/events?${qs.toString()}`);
  state.sseSource = es;

  es.addEventListener('connected', (ev) => {
    try {
      const payload = JSON.parse(ev.data);
      state.presence = payload.presence || [];
      renderPresenceBar();
    } catch {}
  });

  es.addEventListener('presence:update', (ev) => {
    try {
      const payload = JSON.parse(ev.data);
      state.presence = payload.presence || [];
      renderPresenceBar();
    } catch {}
  });

  es.addEventListener('doc:updated', (ev) => {
    try {
      const payload = JSON.parse(ev.data);
      if (payload.documents) {
        state.documents = payload.documents;
        renderDocList();
      }
      if (payload.document && state.currentDoc && payload.docId === state.currentDoc.id) {
        state.currentDoc = payload.document;
        renderCurrentDocument();
        showToast(`⚡ [Trực tuyến] ${payload.actor}: ${payload.summaryAction}`);
      } else if (!payload.docId && state.documents.length > 0 && !state.documents.some((d) => d.id === state.currentDoc?.id)) {
        selectDocument(state.documents[0].id);
      }
    } catch {}
  });

  es.addEventListener('governance:updated', async (ev) => {
    try {
      const payload = JSON.parse(ev.data);
      if (payload.governance) state.governance = payload.governance;
      if (payload.profiles) {
        state.profiles = payload.profiles;
        populateProfileSelects();
      }
      if (payload.documents) state.documents = payload.documents;
      renderGovernanceModalLists();
      if (state.currentDoc) {
        const refreshed = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}`);
        state.currentDoc = refreshed.document;
        renderCurrentDocument();
      }
      renderDocList();
    } catch {}
  });
}

function reportPresence() {
  if (!state.sseSource) return;
  const persona = getActivePersona();
  apiFetch('/api/presence', {
    method: 'POST',
    body: {
      clientId: state.clientId,
      author: persona.author,
      role: persona.role,
      docId: state.currentDoc?.id || '',
      mode: state.activeMode
    }
  }).catch(() => {});
}

function renderPresenceBar() {
  const viewers = state.presence || [];
  const sameDocViewers = state.currentDoc
    ? viewers.filter((v) => v.docId === state.currentDoc.id)
    : viewers;
  const textEl = document.getElementById('presenceText');
  const barEl = document.getElementById('livePresenceBar');

  const names = [...new Set(sameDocViewers.map((v) => v.author))];
  if (sameDocViewers.length > 1) {
    textEl.textContent = `${sameDocViewers.length} phiên đang xem (${names.slice(0, 3).join(', ')})`;
  } else {
    textEl.textContent = `${Math.max(1, viewers.length)} trực tuyến`;
  }
  barEl.title =
    viewers
      .map((v) => `• ${v.author} (${v.role}) — chế độ ${v.mode}`)
      .join('\n') || 'Đồng bộ thời gian thực qua SSE';
}

function syncWorkspaceState(document, documents) {
  if (documents) state.documents = documents;
  if (document) state.currentDoc = document;
  renderDocList();
  if (state.currentDoc) {
    renderCurrentDocument();
  }
}

// ============================================================================
// RENDER SIDEBAR DANH SÁCH TÀI LIỆU
// ============================================================================

function renderDocList() {
  const query = document.getElementById('docSearchInput').value.trim().toLowerCase();
  const filtered = state.documents.filter(
    (d) =>
      !query ||
      d.title.toLowerCase().includes(query) ||
      (d.owner || '').toLowerCase().includes(query)
  );

  document.getElementById('docCountLabel').textContent = String(state.documents.length);
  const profIconMap = Object.fromEntries(state.profiles.map((p) => [p.id, p.icon]));

  const statusLabels = {
    DRAFT: 'Nháp',
    IN_REVIEW: 'Đang review',
    CHANGES_REQUESTED: 'Cần sửa',
    APPROVED: 'Đã duyệt'
  };

  const container = document.getElementById('docListContainer');
  if (filtered.length === 0) {
    container.innerHTML = `<div style="padding:18px;text-align:center;color:var(--text-muted);font-size:12.5px;">Không tìm thấy tài liệu phù hợp.</div>`;
    return;
  }

  container.innerHTML = filtered
    .map((doc) => {
      const isActive = state.currentDoc && state.currentDoc.id === doc.id;
      const scoreClass =
        doc.overallScore >= 85 ? 'score-high' : doc.overallScore >= 68 ? 'score-mid' : 'score-low';

      return `<div class="doc-item ${isActive ? 'active' : ''}" data-doc-id="${escapeHtml(doc.id)}">
        <div class="doc-item-top">
          <div class="doc-item-title">${escapeHtml(profIconMap[doc.profileId] || '📄')} ${escapeHtml(doc.title)}</div>
          <span class="doc-score-chip ${scoreClass}">${doc.overallScore}đ • ${escapeHtml(doc.grade)}</span>
        </div>
        <div class="doc-item-meta">
          <span class="mini-pill">${escapeHtml(statusLabels[doc.status] || doc.status)}</span>
          ${doc.sealStatus === 'VALID' ? `<span class="mini-pill" style="color:var(--success);border-color:var(--success);">🔒 SHA-256</span>` : ''}
          ${doc.sealStatus === 'TAMPERED' ? `<span class="mini-pill mini-pill-danger">🚨 Lệch niêm phong!</span>` : ''}
          ${doc.openBlockers > 0 ? `<span class="mini-pill mini-pill-danger">🔴 ${doc.openBlockers} Blocker</span>` : ''}
          ${doc.pendingSuggestions > 0 ? `<span class="mini-pill">✏️ ${doc.pendingSuggestions} Đề xuất</span>` : ''}
          <span>${doc.wordCount} từ</span>
        </div>
      </div>`;
    })
    .join('');

  container.querySelectorAll('.doc-item').forEach((el) => {
    el.addEventListener('click', () => selectDocument(el.dataset.docId));
  });
}

// ============================================================================
// RENDER TÀI LIỆU HIỆN TẠI (CENTER + RIGHT INSPECTOR)
// ============================================================================

function renderCurrentDocument() {
  const doc = state.currentDoc;
  if (!doc) return;
  const q = doc.qualityReport;
  const gate = doc.readinessGate;

  // Header metadata
  document.getElementById('docTitleInput').value = doc.title;
  document.getElementById('profileSelect').value = doc.profileId;
  document.getElementById('docOwnerLabel').textContent = doc.owner || '—';
  document.getElementById('docStatsLabel').textContent = `${q.stats.wordCount} từ • ${q.stats.paragraphCount} đoạn (~${q.stats.readingTimeMin}p đọc)`;
  document.getElementById('versionCountBadge').textContent = String((doc.versions || []).length);

  const statusBadge = document.getElementById('docStatusBadge');
  const statusMap = {
    DRAFT: ['BẢN NHÁP (DRAFT)', 'status-draft'],
    IN_REVIEW: ['ĐANG RÀ SOÁT (IN REVIEW)', 'status-in_review'],
    CHANGES_REQUESTED: ['YÊU CẦU SỬA (CHANGES REQUESTED)', 'status-changes_requested'],
    APPROVED: ['ĐÃ PHÊ DUYỆT (APPROVED)', 'status-approved']
  };
  const [stText, stCls] = statusMap[doc.status] || [doc.status, 'status-draft'];
  statusBadge.textContent = stText;
  statusBadge.className = `status-badge ${stCls}`;

  const gateChip = document.getElementById('gateSummaryChip');
  if (gate.canApproveCleanly) {
    gateChip.className = 'gate-chip gate-ok';
    gateChip.textContent = '🟢 Cổng phê duyệt: Đạt chuẩn sạch';
  } else {
    gateChip.className = 'gate-chip gate-warn';
    gateChip.textContent = `🟠 Chờ xử lý: ${gate.openBlockersCount} Blocker • ${gate.pendingSuggestionsCount} Track Change • ${gate.criticalFindingsCount} Lỗi nặng`;
  }

  // Đồng bộ trình soạn thảo nguồn nếu chưa dirty
  if (!state.isEditorDirty) {
    document.getElementById('sourceTextarea').value = doc.content;
    updateLiveEditorCounter();
  }

  // Render Canvas, Diff Selectors & 4 Tabs bên phải
  renderReviewCanvas(doc);
  populateDiffSelectors(doc);
  if (state.activeMode === 'diff') {
    runVersionDiff();
  }

  // Badges trên tab phải
  const openCommentsCount = (doc.comments || []).filter((c) => c.status !== 'RESOLVED').length;
  const pendingSugCount = (doc.suggestions || []).filter((s) => s.status === 'PENDING').length;

  document.getElementById('badgeQualityScore').textContent = `${q.overallScore}`;
  document.getElementById('badgeOpenComments').textContent = `${openCommentsCount}`;
  document.getElementById('badgePendingSug').textContent = `${pendingSugCount}`;

  renderQualityInspector(doc);
  renderCommentsInspector(doc);
  renderSuggestionsInspector(doc);
  renderApprovalInspector(doc);
  renderSealStatus(doc);
  renderPresenceBar();
}

function renderSealStatus(doc) {
  const seal = doc.sealVerification;
  const topBanner = document.getElementById('sealStatusBanner');
  const detailCard = document.getElementById('sealDetailCard');

  if (!seal || !seal.isSealed) {
    topBanner.classList.add('hidden');
    detailCard.classList.add('hidden');
    return;
  }

  topBanner.classList.remove('hidden');
  detailCard.classList.remove('hidden');

  if (seal.status === 'VALID') {
    topBanner.className = 'seal-banner seal-valid';
    topBanner.innerHTML = `
      <div>
        <strong>🔒 ${escapeHtml(seal.label)}</strong> — Mã con dấu: <code>${escapeHtml(seal.sealId)}</code> • SHA-256: <code>${escapeHtml(
      seal.sealedContentSha256.slice(0, 18)
    )}...</code>
      </div>
      <span style="font-weight:600;font-size:11.5px;">Ký bởi ${escapeHtml(seal.sealedBy)} (${formatTimeShort(seal.sealedAt)})</span>
    `;

    detailCard.className = 'seal-detail-card seal-valid';
    detailCard.innerHTML = `
      <div style="font-weight:800;color:var(--success);">🔒 Con dấu Niêm phong SHA-256 Đang Hiệu lực</div>
      <div style="margin-top:3px;color:var(--text-secondary);">${escapeHtml(seal.message)}</div>
      <div class="hash-mono">
        <div><strong>Seal ID:</strong> ${escapeHtml(seal.sealId)}</div>
        <div><strong>SHA-256:</strong> ${escapeHtml(seal.sealedContentSha256)}</div>
      </div>
    `;
  } else {
    topBanner.className = 'seal-banner seal-tampered';
    topBanner.innerHTML = `
      <div>
        <strong>🚨 ${escapeHtml(seal.label)}</strong> — Phát hiện văn bản hiện tại lệch mã băm SHA-256 so với bản được ký duyệt!
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button type="button" id="btnDiffSealedBanner" class="btn btn-xs btn-outline" style="background:var(--bg-surface);">🔍 Xem Diff sửa ngầm</button>
        ${
          seal.hasRestoreSnapshot
            ? `<button type="button" id="btnRestoreSealedBanner" class="btn btn-xs btn-primary">⏪ Khôi phục bản Niêm phong</button>`
            : ''
        }
      </div>
    `;

    detailCard.className = 'seal-detail-card seal-tampered';
    detailCard.innerHTML = `
      <div style="font-weight:800;color:var(--danger);">🚨 CẢNH BÁO MẤT TÍNH TOÀN VẸN SAU PHÊ DUYỆT</div>
      <div style="margin-top:3px;color:var(--text-secondary);">${escapeHtml(seal.message)}</div>
      <div class="hash-mono">
        <div><strong>SHA-256 Đã duyệt:</strong> ${escapeHtml(seal.sealedContentSha256.slice(0, 28))}...</div>
        <div><strong>SHA-256 Hiện tại:</strong> ${escapeHtml(seal.liveContentSha256.slice(0, 28))}...</div>
      </div>
      <div class="card-actions">
        <button type="button" id="btnDiffSealedCard" class="btn btn-xs btn-outline">🔍 Đối chiếu từ bị sửa</button>
        ${
          seal.hasRestoreSnapshot
            ? `<button type="button" id="btnRestoreSealedCard" class="btn btn-xs btn-primary">⏪ Khôi phục nguyên trạng</button>`
            : ''
        }
      </div>
    `;

    const jumpToSealDiff = () => {
      switchStageMode('diff');
      document.getElementById('diffBaseSelect').value = 'SEALED_SNAPSHOT';
      document.getElementById('diffTargetSelect').value = 'CURRENT';
      runVersionDiff();
    };

    const triggerRestoreSeal = async () => {
      if (!window.confirm('Khôi phục nguyên trạng văn bản về đúng bản gốc đã niêm phong SHA-256?')) return;
      const { author } = getActivePersona();
      try {
        const res = await apiFetch(`/api/documents/${encodeURIComponent(doc.id)}/restore-seal`, {
          method: 'POST',
          body: { actor: author }
        });
        syncWorkspaceState(res.document, res.documents);
        showToast('🔒 Đã khôi phục 100% nguyên trạng bản Đã Niêm Phong SHA-256!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    };

    document.getElementById('btnDiffSealedBanner')?.addEventListener('click', jumpToSealDiff);
    document.getElementById('btnDiffSealedCard')?.addEventListener('click', jumpToSealDiff);
    document.getElementById('btnRestoreSealedBanner')?.addEventListener('click', triggerRestoreSeal);
    document.getElementById('btnRestoreSealedCard')?.addEventListener('click', triggerRestoreSeal);
  }
}

// ============================================================================
// BỘ DỰNG TRANG GIẤY REVIEW (MARKDOWN + INLINE HIGHLIGHTS + TRACK CHANGES)
// ============================================================================

function formatInlineMarkdownAndAnnotations(rawLine, openComments, pendingSuggestions, showInlineDiff) {
  // Bước 1: Đặt các token giữ chỗ an toàn cho Track Changes và Comments trước khi escape HTML
  const placeholders = [];
  let working = String(rawLine || '');

  if (showInlineDiff) {
    for (const sug of pendingSuggestions) {
      if (sug.originalText && working.includes(sug.originalText)) {
        const token = `\u0000TC_${placeholders.length}\u0000`;
        placeholders.push({
          token,
          html: `<span class="inline-track-wrap" title="Đề xuất bởi ${escapeHtml(sug.author)}: ${escapeHtml(
            sug.reason || 'Chỉnh sửa câu chữ'
          )}"><del class="inline-del">${escapeHtml(sug.originalText)}</del> <ins class="inline-ins">${escapeHtml(
            sug.suggestedText
          )}</ins><button type="button" class="inline-tc-btn inline-tc-accept" data-tc-accept="${escapeHtml(
            sug.id
          )}" title="Chấp nhận đề xuất này">✓</button><button type="button" class="inline-tc-btn inline-tc-reject" data-tc-reject="${escapeHtml(
            sug.id
          )}" title="Từ chối đề xuất này">✕</button></span>`
        });
        working = working.replace(sug.originalText, token);
      }
    }
  }

  for (const cmt of openComments) {
    if (cmt.quote && cmt.quote.length >= 4 && working.includes(cmt.quote)) {
      const token = `\u0000CM_${placeholders.length}\u0000`;
      const catCls =
        cmt.category === 'BLOCKER'
          ? 'hl-blocker'
          : cmt.category === 'QUESTION'
          ? 'hl-question'
          : 'hl-clarity';
      placeholders.push({
        token,
        html: `<mark class="hl-comment ${catCls}" data-jump-comment="${escapeHtml(
          cmt.id
        )}" title="${escapeHtml(cmt.author)} (${escapeHtml(cmt.category)}): ${escapeHtml(cmt.text)}">${escapeHtml(
          cmt.quote
        )}</mark>`
      });
      working = working.replace(cmt.quote, token);
    }
  }

  // Bước 2: Escape HTML phần còn lại & format Markdown inline (**bold**, *italic*, `code`, [link](url))
  let safe = escapeHtml(working);
  safe = safe
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Bước 3: Khôi phục các thẻ HTML Track Change & Comment đã escape sẵn
  for (const item of placeholders) {
    safe = safe.split(item.token).join(item.html);
  }
  return safe;
}

function renderMermaidDiagramSvg(codeBody) {
  const lines = String(codeBody || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(flowchart|graph)\s+/i.test(l));

  const nodesMap = new Map();
  const edges = [];

  const ensureNode = (rawToken) => {
    const t = rawToken.trim();
    const m = t.match(/^([A-Za-z0-9_-]+)(?:\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\})?$/);
    if (!m) {
      const fallbackId = t.slice(0, 24);
      if (!nodesMap.has(fallbackId)) nodesMap.set(fallbackId, fallbackId);
      return fallbackId;
    }
    const id = m[1];
    const label = (m[2] || m[3] || m[4] || id).trim();
    if (!nodesMap.has(id) || nodesMap.get(id) === id) {
      nodesMap.set(id, label);
    }
    return id;
  };

  for (const line of lines) {
    // Khớp dạng: A[Label] -->|Edge| B[Label] hoặc A -> B
    const edgeMatch = line.match(/^(.+?)\s*(?:-->|->|==>)\s*(?:\|([^|]+)\|\s*)?(.+)$/);
    if (edgeMatch) {
      const fromId = ensureNode(edgeMatch[1]);
      const edgeLabel = (edgeMatch[2] || '').trim();
      const toId = ensureNode(edgeMatch[3]);
      edges.push({ fromId, toId, edgeLabel });
    }
  }

  const nodeEntries = Array.from(nodesMap.entries());
  if (nodeEntries.length < 2) {
    return `<pre>${escapeHtml(codeBody)}</pre>`;
  }

  // Bố cục lưới ngang tối đa 3 nút mỗi hàng để vừa khít trang giấy
  const cols = Math.min(3, nodeEntries.length);
  const boxW = 190;
  const boxH = 48;
  const gapX = 76;
  const gapY = 66;
  const padX = 20;
  const padY = 20;

  const coords = new Map();
  nodeEntries.forEach(([id, label], idx) => {
    const row = Math.floor(idx / cols);
    const colInRow = row % 2 === 0 ? idx % cols : cols - 1 - (idx % cols);
    const x = padX + colInRow * (boxW + gapX);
    const y = padY + row * (boxH + gapY);
    coords.set(id, { x, y, cx: x + boxW / 2, cy: y + boxH / 2, label });
  });

  const totalRows = Math.ceil(nodeEntries.length / cols);
  const svgW = padX * 2 + cols * boxW + (cols - 1) * gapX;
  const svgH = padY * 2 + totalRows * boxH + (totalRows - 1) * gapY;

  const edgesSvg = edges
    .map((e) => {
      const a = coords.get(e.fromId);
      const b = coords.get(e.toId);
      if (!a || !b) return '';
      let x1 = a.cx;
      let y1 = a.cy;
      let x2 = b.cx;
      let y2 = b.cy;

      if (Math.abs(a.y - b.y) < 5) {
        if (b.x > a.x) {
          x1 = a.x + boxW;
          x2 = b.x - 6;
        } else {
          x1 = a.x;
          x2 = b.x + boxW + 6;
        }
      } else {
        y1 = a.y + boxH;
        y2 = b.y - 6;
      }

      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;

      return `<g>
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#2563eb" stroke-width="2" marker-end="url(#drArrow)" />
        ${
          e.edgeLabel
            ? `<rect x="${mx - 44}" y="${my - 18}" width="88" height="16" rx="4" fill="#eff6ff" />
               <text x="${mx}" y="${my - 7}" text-anchor="middle" font-size="10" font-weight="600" fill="#1d4ed8">${escapeHtml(
                e.edgeLabel.slice(0, 18)
              )}</text>`
            : ''
        }
      </g>`;
    })
    .join('');

  const nodesSvg = nodeEntries
    .map(([id]) => {
      const n = coords.get(id);
      return `<g>
        <rect x="${n.x}" y="${n.y}" width="${boxW}" height="${boxH}" rx="10" fill="#eff6ff" stroke="#2563eb" stroke-width="1.8" />
        <text x="${n.cx}" y="${n.cy + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="#0f172a">${escapeHtml(
        n.label.slice(0, 26)
      )}</text>
      </g>`;
    })
    .join('');

  return `<div class="diagram-box">
    <div class="diagram-caption">⬡ Sơ đồ Luồng Kiến trúc Tương tác (Rendered SVG)</div>
    <svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="max-width:100%;height:auto;">
      <defs>
        <marker id="drArrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L7,3 z" fill="#2563eb" />
        </marker>
      </defs>
      ${edgesSvg}
      ${nodesSvg}
    </svg>
  </div>`;
}

function renderBlockHtml(rawBlock, openComments, pendingSuggestions, showInlineDiff) {
  const trimmed = rawBlock.trim();

  if (trimmed.startsWith('```')) {
    const langMatch = trimmed.match(/^```(\w+)/);
    const lang = langMatch ? langMatch[1].toLowerCase() : '';
    const codeBody = trimmed.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '');
    if (lang === 'mermaid' || lang === 'diagram') {
      return renderMermaidDiagramSvg(codeBody);
    }
    return `<pre>${escapeHtml(codeBody)}</pre>`;
  }

  // Bảng Markdown
  if (trimmed.startsWith('|') && trimmed.includes('|')) {
    const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
    const rows = [];
    lines.forEach((line, idx) => {
      const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      if (idx === 1 && cells.every((c) => /^:?-{2,}:?$/.test(c))) return;
      rows.push(cells);
    });
    if (rows.length > 0) {
      const headHtml = `<tr>${rows[0]
        .map((c) => `<th>${formatInlineMarkdownAndAnnotations(c, openComments, pendingSuggestions, showInlineDiff)}</th>`)
        .join('')}</tr>`;
      const bodyHtml = rows
        .slice(1)
        .map(
          (r) =>
            `<tr>${r
              .map((c) => `<td>${formatInlineMarkdownAndAnnotations(c, openComments, pendingSuggestions, showInlineDiff)}</td>`)
              .join('')}</tr>`
        )
        .join('');
      return `<table class="md-table"><thead>${headHtml}</thead><tbody>${bodyHtml}</tbody></table>`;
    }
  }

  // Tiêu đề đơn dòng
  const hMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
  if (hMatch && !trimmed.includes('\n')) {
    const lvl = Math.min(3, hMatch[1].length);
    return `<h${lvl}>${formatInlineMarkdownAndAnnotations(
      hMatch[2],
      openComments,
      pendingSuggestions,
      showInlineDiff
    )}</h${lvl}>`;
  }

  // Danh sách nhiều dòng
  const lines = trimmed.split('\n');
  if (lines.every((l) => /^[-*+]\s+/.test(l.trim()))) {
    return `<ul>${lines
      .map(
        (l) =>
          `<li>${formatInlineMarkdownAndAnnotations(
            l.trim().replace(/^[-*+]\s+/, ''),
            openComments,
            pendingSuggestions,
            showInlineDiff
          )}</li>`
      )
      .join('')}</ul>`;
  }
  if (lines.every((l) => /^\d+\.\s+/.test(l.trim()))) {
    return `<ol>${lines
      .map(
        (l) =>
          `<li>${formatInlineMarkdownAndAnnotations(
            l.trim().replace(/^\d+\.\s+/, ''),
            openComments,
            pendingSuggestions,
            showInlineDiff
          )}</li>`
      )
      .join('')}</ol>`;
  }

  // Đoạn thông thường (hỗ trợ xuống dòng mềm bên trong khối)
  const joined = lines
    .map((l) => formatInlineMarkdownAndAnnotations(l, openComments, pendingSuggestions, showInlineDiff))
    .join('<br/>');
  return `<p>${joined}</p>`;
}

function splitMarkdownBlocksClient(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let buf = [];
  let inFence = false;

  const flush = () => {
    const joined = buf.join('\n').trim();
    if (joined) blocks.push(joined);
    buf = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (!inFence) {
        flush();
        inFence = true;
        buf.push(line);
      } else {
        buf.push(line);
        inFence = false;
        flush();
      }
      continue;
    }
    if (inFence) {
      buf.push(line);
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      flush();
      blocks.push(trimmed);
      continue;
    }
    buf.push(line);
  }
  flush();
  return blocks;
}

function renderReviewCanvas(doc) {
  const canvas = document.getElementById('reviewCanvas');
  const showInlineDiff = document.getElementById('chkShowInlineDiff').checked;
  const showHeatmap = document.getElementById('chkReadabilityHeatmap').checked;
  const blocks = splitMarkdownBlocksClient(doc.content);

  // Render Readability Badge & Outline TOC
  const rInfo = doc.readability || { readabilityScore: 90, avgSentenceWords: 18, outline: [], paragraphHeatmaps: [] };
  const rBadge = document.getElementById('readabilityBadge');
  if (rBadge) {
    rBadge.textContent = `📖 Dễ đọc: ${rInfo.readabilityScore}/100 (TB ${rInfo.avgSentenceWords} từ/câu)`;
    rBadge.title = `${rInfo.readabilityLabel || ''} • ${rInfo.hardSentencesCount || 0} câu dài >40 từ`;
  }

  const tocList = document.getElementById('outlineTocList');
  if (tocList) {
    if (!rInfo.outline || rInfo.outline.length === 0) {
      tocList.innerHTML = `<div style="font-size:11.5px;color:var(--text-muted);">Chưa có tiêu đề mục (#).</div>`;
    } else {
      tocList.innerHTML = rInfo.outline
        .map(
          (item) => `<button type="button" class="toc-item toc-lvl-${Math.min(3, item.level)}" data-toc-para="${
            item.paraIndex
          }">
            ${escapeHtml(item.title)}
          </button>`
        )
        .join('');
      tocList.querySelectorAll('[data-toc-para]').forEach((btn) => {
        btn.addEventListener('click', () => scrollToParagraph(Number(btn.dataset.tocPara)));
      });
    }
  }

  const heatmapByPara = new Map((rInfo.paragraphHeatmaps || []).map((p) => [p.paraIndex, p]));
  const openComments = (doc.comments || []).filter((c) => c.status !== 'RESOLVED');
  const pendingSuggestions = (doc.suggestions || []).filter((s) => s.status === 'PENDING');
  const findingsByPara = new Map();
  for (const f of doc.qualityReport.findings || []) {
    if (!findingsByPara.has(f.paragraphIndex)) findingsByPara.set(f.paragraphIndex, []);
    findingsByPara.get(f.paragraphIndex).push(f);
  }

  canvas.innerHTML = blocks
    .map((rawBlock, i) => {
      const pNum = i + 1;
      const pFindings = findingsByPara.get(pNum) || [];
      const hasCrit = pFindings.some((f) => f.severity === 'CRITICAL');
      const dotHtml =
        pFindings.length > 0
          ? `<span class="para-finding-dot" data-jump-finding-para="${pNum}" title="${escapeHtml(
              pFindings.map((f) => `[${f.severity}] ${f.title}`).join(' • ')
            )}">${hasCrit ? '🔴' : '🟠'}</span>`
          : '';

      const pHeat = heatmapByPara.get(pNum);
      let heatCls = '';
      let heatTip = '';
      if (showHeatmap && pHeat && (pHeat.level === 'HARD' || pHeat.level === 'DENSE')) {
        heatCls = pHeat.level === 'HARD' ? 'heatmap-hard' : 'heatmap-dense';
        const worstSent = (pHeat.sentences || []).find((s) => s.grade === pHeat.level);
        heatTip = worstSent ? `title="🎨 ${escapeHtml(worstSent.reason)}"` : '';
      }

      return `<div class="doc-block ${heatCls}" id="doc-para-${pNum}" data-para-index="${pNum}" ${heatTip}>
        <span class="para-num">¶${pNum}</span>
        ${dotHtml}
        ${renderBlockHtml(rawBlock, openComments, pendingSuggestions, showInlineDiff)}
      </div>`;
    })
    .join('');

  if (state.activeMode === 'analytics') {
    loadAndRenderAnalyticsHub();
  }

  // Gắn sự kiện click lên highlight bình luận
  canvas.querySelectorAll('[data-jump-comment]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      switchInspectorTab('comments');
      const cid = el.dataset.jumpComment;
      setTimeout(() => {
        const card = document.getElementById(`comment-card-${cid}`);
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.style.outline = '2px solid var(--primary)';
          setTimeout(() => (card.style.outline = ''), 1600);
        }
      }, 60);
    });
  });

  // Gắn sự kiện click nút ✓ / ✕ Track Change trực tiếp trên mặt giấy
  canvas.querySelectorAll('[data-tc-accept]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDecideSuggestion(btn.dataset.tcAccept, 'ACCEPT');
    });
  });
  canvas.querySelectorAll('[data-tc-reject]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDecideSuggestion(btn.dataset.tcReject, 'REJECT');
    });
  });

  // Gắn sự kiện click chấm đỏ/cam cảnh báo bên lề phải
  canvas.querySelectorAll('[data-jump-finding-para]').forEach((dot) => {
    dot.addEventListener('click', () => {
      switchInspectorTab('quality');
    });
  });
}

function scrollToParagraph(paraIndex) {
  if (state.activeMode !== 'review') {
    switchStageMode('review');
  }
  const block = document.getElementById(`doc-para-${paraIndex}`);
  if (block) {
    block.scrollIntoView({ behavior: 'smooth', block: 'center' });
    block.classList.add('flash-focus');
    setTimeout(() => block.classList.remove('flash-focus'), 1800);
  }
}

function scrollToQuoteInCanvas(quote) {
  if (!quote || !state.currentDoc) return;
  const blocks = splitMarkdownBlocksClient(state.currentDoc.content);
  const idx = blocks.findIndex((b) => b.includes(quote) || b.replace(/\*\*|\*|`/g, '').includes(quote));
  if (idx !== -1) {
    scrollToParagraph(idx + 1);
  }
}

// ============================================================================
// RENDER INSPECTOR TAB 1: CHẤT LƯỢNG & BIỂU ĐỒ SVG RADAR 5 TRỤC
// ============================================================================

function renderRadarChart(axes) {
  const svg = document.getElementById('radarSvg');
  const labels = [
    { key: 'STRUCTURE', name: 'Cấu trúc' },
    { key: 'CLARITY', name: 'Rõ ràng' },
    { key: 'CONSISTENCY', name: 'Nhất quán' },
    { key: 'ACTIONABILITY', name: 'Thực thi' },
    { key: 'SAFETY', name: 'An toàn' }
  ];

  const cx = 110;
  const cy = 96;
  const maxR = 62;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const gridStroke = isDark ? '#334155' : '#cbd5e1';
  const labelColor = isDark ? '#cbd5e1' : '#475569';

  const getPoint = (idx, radius) => {
    const angle = -Math.PI / 2 + (idx * 2 * Math.PI) / 5;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  };

  const rings = [0.35, 0.7, 1.0]
    .map((scale) => {
      const pts = labels.map((_, i) => getPoint(i, maxR * scale).join(',')).join(' ');
      return `<polygon points="${pts}" fill="none" stroke="${gridStroke}" stroke-width="1" />`;
    })
    .join('');

  const spokes = labels
    .map((item, i) => {
      const [x, y] = getPoint(i, maxR);
      const [lx, ly] = getPoint(i, maxR + 18);
      return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${gridStroke}" stroke-width="1" />
              <text x="${lx}" y="${ly + 3}" text-anchor="middle" font-size="10" font-weight="600" fill="${labelColor}">${item.name}</text>`;
    })
    .join('');

  const dataPts = labels
    .map((item, i) => {
      const val = Math.max(0, Math.min(100, axes[item.key] || 0));
      return getPoint(i, (val / 100) * maxR).join(',');
    })
    .join(' ');

  svg.innerHTML = `
    ${rings}
    ${spokes}
    <polygon points="${dataPts}" fill="rgba(37, 99, 235, 0.25)" stroke="#2563eb" stroke-width="2" />
  `;
}

function renderQualityInspector(doc) {
  const q = doc.qualityReport;
  document.getElementById('overallScoreNum').textContent = String(q.overallScore);
  document.getElementById('overallGradeText').textContent = q.grade;
  document.getElementById('qualityVerdictText').textContent = q.verdict;

  const circle = document.getElementById('scoreCircle');
  const gCls = q.grade.startsWith('A')
    ? 'grade-a'
    : q.grade === 'B'
    ? 'grade-b'
    : q.grade === 'C'
    ? 'grade-c'
    : 'grade-d';
  circle.className = `score-circle ${gCls}`;

  renderRadarChart(q.axes);

  const axisMeta = [
    ['STRUCTURE', '📐 Cấu trúc & Đủ mục'],
    ['CLARITY', '💡 Rõ ràng & Định lượng'],
    ['CONSISTENCY', '🔗 Nhất quán & Logic'],
    ['ACTIONABILITY', '⚡ Khả năng Thực thi'],
    ['SAFETY', '🛡️ An toàn Bảo mật']
  ];
  document.getElementById('axisBarsContainer').innerHTML = axisMeta
    .map(([key, label]) => {
      const val = q.axes[key] || 0;
      return `<div class="axis-row">
        <span>${label}</span>
        <div class="axis-track"><div class="axis-fill" style="width:${val}%"></div></div>
        <strong style="text-align:right">${val}</strong>
      </div>`;
    })
    .join('');

  // Checklist mục bắt buộc
  const missingSecs = q.sectionChecklist.filter((s) => !s.passed);
  const btnInsertMissing = document.getElementById('btnInsertMissingSecs');
  btnInsertMissing.classList.toggle('hidden', missingSecs.length === 0);

  document.getElementById('sectionChecklistContainer').innerHTML = q.sectionChecklist
    .map(
      (sec) => `<div class="check-item ${sec.passed ? '' : 'missing'}">
        <span>${sec.passed ? '✅' : '⚠️'}</span>
        <span>${escapeHtml(sec.label)}</span>
      </div>`
    )
    .join('');

  // Danh sách Findings & Nút Chuẩn hóa Thuật ngữ 1-Click
  document.getElementById('findingsTotalLabel').textContent = String(q.findings.length);
  const btnNormGlossary = document.getElementById('btnAutoNormalizeGlossary');
  const glossaryCount = q.counts.glossary || 0;
  btnNormGlossary.classList.toggle('hidden', glossaryCount === 0);
  if (glossaryCount > 0) {
    btnNormGlossary.textContent = `✨ Chuẩn hóa Thuật ngữ (${glossaryCount})`;
  }
  const fContainer = document.getElementById('findingsListContainer');

  if (q.findings.length === 0) {
    fContainer.innerHTML = `<div class="review-card" style="text-align:center;color:var(--success);font-weight:700;">🎉 Tuyệt vời! Không phát hiện lỗi cấu trúc, câu chữ mơ hồ hay rủi ro rò rỉ dữ liệu nào.</div>`;
    return;
  }

  fContainer.innerHTML = q.findings
    .map((f, idx) => {
      const cardCls =
        f.severity === 'CRITICAL' ? 'card-critical' : f.severity === 'WARNING' ? 'card-warning' : 'card-info';
      const canQuickFix = Boolean(f.suggestedFix && f.quote && doc.content.includes(f.quote));

      return `<div class="review-card ${cardCls}">
        <div class="card-top">
          <span class="sev-tag sev-${escapeHtml(f.severity)}">${escapeHtml(f.severity)} • ¶${f.paragraphIndex}</span>
          <button type="button" class="link-btn" data-goto-para="${f.paragraphIndex}">Nhảy tới ¶${f.paragraphIndex} ↗</button>
        </div>
        <div style="font-weight:700;margin-bottom:4px;">${escapeHtml(f.title)}</div>
        <div style="color:var(--text-secondary);line-height:1.48;">${escapeHtml(f.message)}</div>
        ${f.quote ? `<div class="quote-box" data-goto-para="${f.paragraphIndex}">“${escapeHtml(f.quote.slice(0, 110))}”</div>` : ''}
        <div class="card-actions">
          ${
            canQuickFix
              ? `<button type="button" class="btn btn-xs btn-success" data-finding-autofix="${idx}">⚡ Sửa ngay</button>
                 <button type="button" class="btn btn-xs btn-outline" data-finding-tosug="${idx}">✏️ Đẩy sang Track Change</button>`
              : ''
          }
          <button type="button" class="btn btn-xs btn-outline" data-finding-tocomment="${idx}">💬 Gắn thành Bình luận</button>
        </div>
      </div>`;
    })
    .join('');

  fContainer.querySelectorAll('[data-goto-para]').forEach((el) => {
    el.addEventListener('click', () => scrollToParagraph(Number(el.dataset.gotoPara)));
  });

  fContainer.querySelectorAll('[data-finding-autofix]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const f = q.findings[Number(btn.dataset.findingAutofix)];
      if (!f || !f.suggestedFix || !doc.content.includes(f.quote)) return;
      const updatedContent = doc.content.replace(f.quote, f.suggestedFix);
      const { author } = getActivePersona();
      try {
        const res = await apiFetch(`/api/documents/${encodeURIComponent(doc.id)}`, {
          method: 'PUT',
          body: { content: updatedContent, actor: author }
        });
        syncWorkspaceState(res.document, res.documents);
        showToast('Đã áp dụng bản sửa tự động và tính lại điểm!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  fContainer.querySelectorAll('[data-finding-tosug]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const f = q.findings[Number(btn.dataset.findingTosug)];
      if (!f) return;
      const persona = getActivePersona();
      try {
        const res = await apiFetch(`/api/documents/${encodeURIComponent(doc.id)}/suggestions`, {
          method: 'POST',
          body: {
            author: persona.author,
            role: persona.role,
            originalText: f.quote,
            suggestedText: f.suggestedFix,
            reason: f.title
          }
        });
        syncWorkspaceState(res.document, res.documents);
        switchInspectorTab('suggestions');
        showToast('Đã chuyển thành đề xuất Track Change!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  fContainer.querySelectorAll('[data-finding-tocomment]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const f = q.findings[Number(btn.dataset.findingTocomment)];
      if (!f) return;
      const persona = getActivePersona();
      try {
        const res = await apiFetch(`/api/documents/${encodeURIComponent(doc.id)}/comments`, {
          method: 'POST',
          body: {
            author: persona.author,
            role: persona.role,
            category: f.severity === 'CRITICAL' ? 'BLOCKER' : 'CLARITY',
            quote: f.quote || '',
            text: `${f.title} — ${f.message}`
          }
        });
        syncWorkspaceState(res.document, res.documents);
        switchInspectorTab('comments');
        showToast('Đã tạo luồng bình luận từ cảnh báo chất lượng!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

// ============================================================================
// RENDER INSPECTOR TAB 2: BÌNH LUẬN NỘI TUYẾN & THREADS
// ============================================================================

function renderCommentsInspector(doc) {
  const allComments = doc.comments || [];
  const filtered = allComments.filter((c) => {
    if (state.commentFilter === 'OPEN') return c.status !== 'RESOLVED';
    if (state.commentFilter === 'BLOCKER') return c.category === 'BLOCKER' && c.status !== 'RESOLVED';
    if (state.commentFilter === 'RESOLVED') return c.status === 'RESOLVED';
    return true;
  });

  const container = document.getElementById('commentsListContainer');
  if (filtered.length === 0) {
    container.innerHTML = `<div style="padding:18px;text-align:center;color:var(--text-muted);font-size:12.5px;">Không có bình luận nào trong bộ lọc này. Hãy bôi đen văn bản để gắn nhận xét!</div>`;
    return;
  }

  container.innerHTML = filtered
    .map((c) => {
      const resolved = c.status === 'RESOLVED';
      const cardType =
        c.category === 'BLOCKER' ? 'card-blocker' : c.category === 'QUESTION' ? 'card-question' : 'card-clarity';
      const repliesHtml = (c.replies || [])
        .map(
          (r) => `<div class="reply-item">
            <strong>${escapeHtml(r.author)}</strong> <span class="card-role">(${escapeHtml(r.role)})</span>: ${escapeHtml(r.text)}
          </div>`
        )
        .join('');

      return `<div id="comment-card-${escapeHtml(c.id)}" class="review-card ${cardType} ${resolved ? 'card-resolved' : ''}">
        <div class="card-top">
          <div>
            <span class="card-author">${escapeHtml(c.author)}</span>
            <span class="card-role">• ${escapeHtml(c.role)}</span>
          </div>
          <span class="sev-tag sev-${escapeHtml(c.category)}">${escapeHtml(c.category)}</span>
        </div>
        ${
          c.quote
            ? `<div class="quote-box" data-jump-quote="${escapeHtml(c.quote)}">❝ ${escapeHtml(c.quote)} ❞</div>`
            : ''
        }
        <div style="line-height:1.5;margin-top:4px;">${escapeHtml(c.text)}</div>
        <div class="card-actions">
          <button type="button" class="btn btn-xs ${resolved ? 'btn-outline' : 'btn-success'}" data-toggle-resolve="${escapeHtml(
            c.id
          )}" data-next-status="${resolved ? 'OPEN' : 'RESOLVED'}">
            ${resolved ? '↺ Mở lại' : '✓ Đánh dấu Đã giải quyết'}
          </button>
          <span style="margin-left:auto;font-size:10.5px;color:var(--text-muted);align-self:center;">${formatTimeShort(
            c.createdAt
          )}</span>
        </div>

        <div class="replies-list">
          ${repliesHtml}
          <form class="reply-form" data-reply-comment="${escapeHtml(c.id)}">
            <input type="text" name="replyText" placeholder="Viết phản hồi thảo luận..." required />
            <button type="submit" class="btn btn-xs btn-secondary">Gửi</button>
          </form>
        </div>
      </div>`;
    })
    .join('');

  container.querySelectorAll('[data-jump-quote]').forEach((qEl) => {
    qEl.addEventListener('click', () => scrollToQuoteInCanvas(qEl.dataset.jumpQuote));
  });

  container.querySelectorAll('[data-toggle-resolve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { author } = getActivePersona();
      try {
        const res = await apiFetch(
          `/api/documents/${encodeURIComponent(doc.id)}/comments/${encodeURIComponent(btn.dataset.toggleResolve)}`,
          {
            method: 'PATCH',
            body: { status: btn.dataset.nextStatus, actor: author }
          }
        );
        syncWorkspaceState(res.document, res.documents);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  container.querySelectorAll('[data-reply-comment]').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.elements.replyText;
      const text = input.value.trim();
      if (!text) return;
      const persona = getActivePersona();
      try {
        const res = await apiFetch(
          `/api/documents/${encodeURIComponent(doc.id)}/comments/${encodeURIComponent(form.dataset.replyComment)}/replies`,
          {
            method: 'POST',
            body: { author: persona.author, role: persona.role, text }
          }
        );
        syncWorkspaceState(res.document, null);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

// ============================================================================
// RENDER INSPECTOR TAB 3: TRACK CHANGES (SUGGESTED EDITS)
// ============================================================================

async function handleDecideSuggestion(sugId, decision) {
  if (!state.currentDoc) return;
  const { author } = getActivePersona();
  try {
    const res = await apiFetch(
      `/api/documents/${encodeURIComponent(state.currentDoc.id)}/suggestions/${encodeURIComponent(sugId)}/decide`,
      {
        method: 'POST',
        body: { decision, actor: author }
      }
    );
    syncWorkspaceState(res.document, res.documents);
    showToast(
      decision === 'ACCEPT'
        ? '✅ Đã chấp nhận Track Change và cập nhật thẳng vào văn bản!'
        : 'Đã từ chối đề xuất sửa đổi.',
      'success'
    );
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderSuggestionsInspector(doc) {
  const suggestions = doc.suggestions || [];
  const pendingCount = suggestions.filter((s) => s.status === 'PENDING').length;

  const btnAll = document.getElementById('btnAcceptAllSug');
  btnAll.classList.toggle('hidden', pendingCount === 0);
  btnAll.textContent = `✅ Duyệt tất cả (${pendingCount})`;

  const container = document.getElementById('suggestionsListContainer');
  if (suggestions.length === 0) {
    container.innerHTML = `<div style="padding:18px;text-align:center;color:var(--text-muted);font-size:12.5px;">Chưa có đề xuất Track Change nào. Quét chọn một câu trên tài liệu rồi bấm "✏️ Đề xuất sửa".</div>`;
    return;
  }

  container.innerHTML = suggestions
    .map((s) => {
      const isPending = s.status === 'PENDING';
      return `<div class="review-card ${isPending ? 'card-warning' : 'card-resolved'}">
        <div class="card-top">
          <div>
            <span class="card-author">${escapeHtml(s.author)}</span>
            <span class="card-role">• ${escapeHtml(s.role)}</span>
          </div>
          <span class="sev-tag ${s.status === 'ACCEPTED' ? 'sev-ACCEPTED' : s.status === 'REJECTED' ? 'sev-BLOCKER' : 'sev-CLARITY'}">${escapeHtml(
            s.status
          )}</span>
        </div>
        <div class="sug-diff-box" data-jump-sug="${escapeHtml(s.originalText)}" style="cursor:pointer;">
          <div><del class="inline-del">${escapeHtml(s.originalText)}</del></div>
          <div style="margin-top:4px;"><ins class="inline-ins">${escapeHtml(s.suggestedText)}</ins></div>
        </div>
        ${s.reason ? `<div style="font-size:11.5px;color:var(--text-secondary);">💡 Lý do: ${escapeHtml(s.reason)}</div>` : ''}
        ${
          isPending
            ? `<div class="card-actions">
                <button type="button" class="btn btn-xs btn-success" data-sug-decide="ACCEPT" data-sug-id="${escapeHtml(
                  s.id
                )}">✅ Chấp nhận sửa</button>
                <button type="button" class="btn btn-xs btn-outline" data-sug-decide="REJECT" data-sug-id="${escapeHtml(
                  s.id
                )}">✕ Từ chối</button>
              </div>`
            : `<div style="font-size:11px;color:var(--text-muted);margin-top:6px;">Xử lý bởi ${escapeHtml(
                s.decidedBy || '—'
              )} lúc ${formatTimeShort(s.decidedAt)}</div>`
        }
      </div>`;
    })
    .join('');

  container.querySelectorAll('[data-jump-sug]').forEach((box) => {
    box.addEventListener('click', () => scrollToQuoteInCanvas(box.dataset.jumpSug));
  });

  container.querySelectorAll('[data-sug-decide]').forEach((btn) => {
    btn.addEventListener('click', () => handleDecideSuggestion(btn.dataset.sugId, btn.dataset.sugDecide));
  });
}

// ============================================================================
// RENDER INSPECTOR TAB 4: PHÊ DUYỆT & NHẬT KÝ KIỂM TOÁN
// ============================================================================

function renderApprovalInspector(doc) {
  const gate = doc.readinessGate;
  const gateCard = document.getElementById('readinessGateCard');
  const overrideWrap = document.getElementById('overrideGateWrap');

  if (gate.canApproveCleanly) {
    gateCard.className = 'gate-card ready';
    gateCard.innerHTML = `<strong>🟢 Đủ điều kiện Phê duyệt Chuẩn (Clean Gate)</strong>
      <div style="margin-top:4px;color:var(--text-secondary);">0 Blocker mở • 0 Track Changes tồn đọng • 0 lỗi Critical. Có thể ký APPROVED ngay!</div>`;
    overrideWrap.classList.add('hidden');
    document.getElementById('chkForceOverride').checked = false;
  } else {
    gateCard.className = 'gate-card blocked';
    gateCard.innerHTML = `<strong>🟠 Cổng Kiểm Soát Đang Chặn Phê Duyệt Sạch</strong>
      <ul style="margin:6px 0 0;padding-left:18px;color:var(--text-secondary);">
        ${gate.blockReasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}
      </ul>`;
    overrideWrap.classList.remove('hidden');
  }

  // Danh sách chữ ký
  const appContainer = document.getElementById('approvalsListContainer');
  const approvals = doc.approvals || [];
  if (approvals.length === 0) {
    appContainer.innerHTML = `<div style="font-size:12px;color:var(--text-muted);">Chưa có quyết định thẩm định nào được ký.</div>`;
  } else {
    appContainer.innerHTML = approvals
      .map(
        (a) => `<div class="review-card ${a.decision === 'APPROVED' ? 'card-info' : 'card-critical'}">
          <div class="card-top">
            <div>
              <span class="card-author">${escapeHtml(a.reviewer)}</span>
              <span class="card-role">• ${escapeHtml(a.role)}</span>
            </div>
            <span class="sev-tag ${a.decision === 'APPROVED' ? 'sev-ACCEPTED' : 'sev-BLOCKER'}">${escapeHtml(
              a.decision
            )}</span>
          </div>
          ${a.note ? `<div style="color:var(--text-secondary);">${escapeHtml(a.note)}</div>` : ''}
          <div style="font-size:10.5px;color:var(--text-muted);margin-top:4px;">
            ${formatTimeShort(a.decidedAt)} ${a.overriddenGate ? '• ⚠️ Phê duyệt ngoại lệ (Overridden)' : ''}
          </div>
        </div>`
      )
      .join('');
  }

  // Nhật ký kiểm toán
  const auditContainer = document.getElementById('auditLogContainer');
  auditContainer.innerHTML = (doc.auditLog || [])
    .slice(0, 25)
    .map(
      (ev) => `<div class="audit-item">
        <div><strong>${escapeHtml(ev.actor)}</strong> — ${escapeHtml(ev.action)}</div>
        <div class="audit-time">${formatTimeShort(ev.time)}</div>
      </div>`
    )
    .join('');
}

// ============================================================================
// VERSION DIFF VIEWER
// ============================================================================

function populateDiffSelectors(doc) {
  const versions = doc.versions || [];
  const baseSel = document.getElementById('diffBaseSelect');
  const targetSel = document.getElementById('diffTargetSelect');

  const sealOpt =
    doc.cryptographicSeal && typeof doc.cryptographicSeal.sealedContentSnapshot === 'string'
      ? `<option value="SEALED_SNAPSHOT">🔒 Bản gốc Đã Niêm Phong (${escapeHtml(doc.cryptographicSeal.sealId)})</option>`
      : '';

  const verOpts = versions
    .map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.label)} (${formatTimeShort(v.createdAt)})</option>`)
    .join('');

  baseSel.innerHTML = `${sealOpt}${verOpts}`;
  targetSel.innerHTML = `<option value="CURRENT">⚡ Bản thảo hiện hành (Working Draft)</option>${sealOpt}${verOpts}`;

  if (doc.sealVerification?.status === 'TAMPERED' && sealOpt) {
    baseSel.value = 'SEALED_SNAPSHOT';
  } else if (versions.length >= 1) {
    baseSel.value = versions[0].id;
  }
  targetSel.value = 'CURRENT';
}

async function runVersionDiff() {
  if (!state.currentDoc) return;
  const baseVersionId = document.getElementById('diffBaseSelect').value;
  const targetVersionId = document.getElementById('diffTargetSelect').value;

  try {
    const res = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}/diff`, {
      method: 'POST',
      body: { baseVersionId, targetVersionId }
    });
    state.lastDiffResult = res;
    renderDiffOutput(res);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderDiffOutput(diffPayload) {
  if (!diffPayload) return;
  const { diff, baseLabel, targetLabel } = diffPayload;
  const s = diff.summary;

  document.getElementById('diffSummaryBar').innerHTML = `
    <div class="diff-stat">Độ tương đồng: <strong>${s.similarityPct}%</strong></div>
    <div class="diff-stat" style="color:var(--success)">+ Thêm mới: <strong>+${s.addedWords} từ</strong></div>
    <div class="diff-stat" style="color:var(--danger)">− Lược bỏ: <strong>−${s.removedWords} từ</strong></div>
    <div class="diff-stat">Khối thay đổi: <strong>${s.changedBlocks}/${s.totalBlocks} đoạn</strong></div>
  `;

  const out = document.getElementById('diffOutputContainer');
  if (s.changedBlocks === 0) {
    out.innerHTML = `<div style="padding:24px;text-align:center;color:var(--success);font-weight:700;">✅ Hai phiên bản (${escapeHtml(
      baseLabel
    )} và ${escapeHtml(targetLabel)}) giống hệt nhau 100%!</div>`;
    return;
  }

  if (state.diffLayout === 'split') {
    out.innerHTML = diff.blocks
      .map((blk) => {
        const cls =
          blk.status === 'ADDED'
            ? 'diff-row-added'
            : blk.status === 'REMOVED'
            ? 'diff-row-removed'
            : blk.status === 'MODIFIED'
            ? 'diff-row-modified'
            : '';
        return `<div class="diff-row ${cls}">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:6px;">${escapeHtml(
            blk.status
          )} ${blk.oldIndex ? `• Gốc ¶${blk.oldIndex}` : ''} ${blk.newIndex ? `➔ Mới ¶${blk.newIndex}` : ''}</div>
          <div class="diff-split-grid">
            <div class="diff-col-box">${
              blk.status === 'MODIFIED'
                ? blk.tokens
                    .filter((t) => t.type !== 'added')
                    .map((t) =>
                      t.type === 'removed'
                        ? `<del class="inline-del">${escapeHtml(t.value)}</del>`
                        : escapeHtml(t.value)
                    )
                    .join('')
                : escapeHtml(blk.oldText || '—')
            }</div>
            <div class="diff-col-box">${
              blk.status === 'MODIFIED'
                ? blk.tokens
                    .filter((t) => t.type !== 'removed')
                    .map((t) =>
                      t.type === 'added'
                        ? `<ins class="inline-ins">${escapeHtml(t.value)}</ins>`
                        : escapeHtml(t.value)
                    )
                    .join('')
                : escapeHtml(blk.newText || '—')
            }</div>
          </div>
        </div>`;
      })
      .join('');
  } else {
    out.innerHTML = diff.blocks
      .map((blk) => {
        const cls =
          blk.status === 'ADDED'
            ? 'diff-row-added'
            : blk.status === 'REMOVED'
            ? 'diff-row-removed'
            : blk.status === 'MODIFIED'
            ? 'diff-row-modified'
            : '';
        const tokensHtml = blk.tokens
          .map((tok) => {
            if (tok.type === 'added') return `<ins class="inline-ins">${escapeHtml(tok.value)}</ins>`;
            if (tok.type === 'removed') return `<del class="inline-del">${escapeHtml(tok.value)}</del>`;
            return escapeHtml(tok.value);
          })
          .join('');
        return `<div class="diff-row ${cls}" style="white-space:pre-wrap;">${tokensHtml}</div>`;
      })
      .join('');
  }
}

// ============================================================================
// CHUYỂN MODE, TABS & SỰ KIỆN TƯƠNG TÁC TOÀN CỤC
// ============================================================================

function switchStageMode(mode) {
  if (mode !== 'review' && state.isSpeakingTts) {
    stopTtsProofreader();
  }
  state.activeMode = mode;
  document.querySelectorAll('.mode-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  document.getElementById('viewReview').classList.toggle('hidden', mode !== 'review');
  document.getElementById('viewEdit').classList.toggle('hidden', mode !== 'edit');
  document.getElementById('viewDiff').classList.toggle('hidden', mode !== 'diff');
  document.getElementById('viewAnalytics').classList.toggle('hidden', mode !== 'analytics');

  if (mode === 'diff') {
    runVersionDiff();
  } else if (mode === 'analytics') {
    loadAndRenderAnalyticsHub();
  }
  reportPresence();
}

function switchInspectorTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.insp-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.getElementById('tabQuality').classList.toggle('hidden', tab !== 'quality');
  document.getElementById('tabComments').classList.toggle('hidden', tab !== 'comments');
  document.getElementById('tabSuggestions').classList.toggle('hidden', tab !== 'suggestions');
  document.getElementById('tabApproval').classList.toggle('hidden', tab !== 'approval');
}

function updateLiveEditorCounter() {
  const txt = document.getElementById('sourceTextarea').value;
  const words = (txt.match(/\S+/g) || []).length;
  document.getElementById('liveEditorCounter').textContent = `${words} từ • ${txt.length} ký tự`;
}

function openCommentComposerWithQuote(quote = '') {
  switchInspectorTab('comments');
  state.selectedQuote = quote;
  const composer = document.getElementById('commentComposer');
  const qPreview = document.getElementById('commentQuotePreview');
  composer.classList.remove('hidden');
  if (quote) {
    qPreview.classList.remove('hidden');
    qPreview.textContent = `❝ ${quote} ❞`;
  } else {
    qPreview.classList.add('hidden');
  }
  document.getElementById('commentTextInput').focus();
}

function openSuggestComposerWithQuote(quote = '') {
  switchInspectorTab('suggestions');
  const composer = document.getElementById('suggestComposer');
  composer.classList.remove('hidden');
  document.getElementById('sugOriginalInput').value = quote;
  document.getElementById('sugProposedInput').value = quote;
  document.getElementById('sugProposedInput').focus();
}

async function handleUploadedFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const base64Data = String(reader.result || '');
    const { author } = getActivePersona();
    try {
      showToast(`Đang đọc và phân tích tệp "${file.name}"...`);
      const res = await apiFetch('/api/import-file', {
        method: 'POST',
        body: {
          fileName: file.name,
          base64Data,
          owner: author,
          profileId: state.currentDoc?.profileId || 'PRD_SPEC'
        }
      });
      syncWorkspaceState(res.document, res.documents);
      showToast(
        `Đã nạp thành công "${file.name}"${
          res.importedCommentsCount ? ` (kèm ${res.importedCommentsCount} chú thích gốc từ Word!)` : '!'
        }`,
        'success'
      );
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
  reader.readAsDataURL(file);
}

async function handleExportAction(type) {
  const doc = state.currentDoc;
  if (!doc) return;
  document.getElementById('exportDropdown').classList.add('hidden');

  if (type === 'docx-full' || type === 'docx-clean') {
    try {
      const resp = await fetch(`/api/documents/${encodeURIComponent(doc.id)}/export-docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          includeComments: type === 'docx-full',
          includeCertificate: type === 'docx-full'
        })
      });
      if (!resp.ok) throw new Error('Không thể kết xuất tệp .docx');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.title.slice(0, 45).replace(/[\\/:*?"<>|]/g, '_')}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Đã xuất tệp Microsoft Word (.docx) thành công!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  } else if (type === 'md') {
    const blob = new Blob([doc.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.title.slice(0, 45).replace(/[\\/:*?"<>|]/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Đã tải tệp Markdown (.md)!', 'success');
  } else if (type === 'certificate') {
    window.open(`/api/documents/${encodeURIComponent(doc.id)}/export-certificate`, '_blank');
  } else if (type === 'json') {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.title.slice(0, 40).replace(/[\\/:*?"<>|]/g, '_')}_AuditBundle.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Đã xuất gói Hồ sơ Kiểm toán JSON!', 'success');
  }
}

function bindGlobalEvents() {
  // Theme toggle
  document.getElementById('btnThemeToggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    setTheme(cur === 'dark' ? 'light' : 'dark');
  });

  // Persona selector
  document.getElementById('personaSelect').addEventListener('change', (e) => {
    document.getElementById('customPersonaInput').classList.toggle('hidden', e.target.value !== 'CUSTOM');
    reportPresence();
  });
  document.getElementById('customPersonaInput').addEventListener('change', reportPresence);

  // 1-Click Glossary Normalization
  document.getElementById('btnAutoNormalizeGlossary').addEventListener('click', async () => {
    if (!state.currentDoc) return;
    const { author } = getActivePersona();
    try {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}/normalize-glossary`, {
        method: 'POST',
        body: { actor: author }
      });
      syncWorkspaceState(res.document, res.documents);
      showToast(`✨ Đã tự động chuẩn hóa ${res.replacementsCount} thuật ngữ trong văn bản!`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Governance Modal (Glossary Enforcer & Custom Rubrics)
  document.getElementById('btnOpenGovernance').addEventListener('click', async () => {
    try {
      const res = await apiFetch('/api/governance');
      state.governance = res.governance;
      state.profiles = res.profiles;
      populateProfileSelects();
      if (state.currentDoc) document.getElementById('profileSelect').value = state.currentDoc.profileId;
      renderGovernanceModalLists();
      document.getElementById('modalGovernance').classList.remove('hidden');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.querySelectorAll('[data-govtab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.govtab;
      document.querySelectorAll('[data-govtab]').forEach((b) => b.classList.toggle('active', b === btn));
      document.getElementById('govPaneGlossary').classList.toggle('hidden', tab !== 'glossary');
      document.getElementById('govPaneRubric').classList.toggle('hidden', tab !== 'rubric');
    });
  });

  document.getElementById('formAddGlossary').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/governance/glossary', {
        method: 'POST',
        body: {
          wrongTerm: document.getElementById('glWrongInput').value,
          preferredTerm: document.getElementById('glPreferredInput').value,
          caseSensitive: document.getElementById('glCaseSensitive').checked
        }
      });
      state.governance = res.governance;
      state.documents = res.documents;
      document.getElementById('glWrongInput').value = '';
      document.getElementById('glPreferredInput').value = '';
      renderGovernanceModalLists();
      if (state.currentDoc) {
        const docRes = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}`);
        syncWorkspaceState(docRes.document, state.documents);
      }
      showToast('📖 Đã thêm quy tắc Từ điển Thuật ngữ mới!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('formSaveCustomRubric').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawLines = document
      .getElementById('crSectionsInput')
      .value.split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const requiredSections = rawLines.map((line, idx) => {
      const [labelPart, kwPart] = line.split('|');
      const label = (labelPart || '').trim();
      const keywords = kwPart
        ? kwPart
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean)
        : [label];
      return { id: `csec-${idx + 1}`, label, keywords };
    });

    try {
      const res = await apiFetch('/api/governance/profiles', {
        method: 'POST',
        body: {
          icon: document.getElementById('crIconInput').value,
          name: document.getElementById('crNameInput').value,
          requiredSections,
          forbiddenPhrases: document.getElementById('crForbiddenInput').value
        }
      });
      state.governance = res.governance;
      state.profiles = res.profiles;
      state.documents = res.documents;
      populateProfileSelects();
      if (state.currentDoc) document.getElementById('profileSelect').value = state.currentDoc.profileId;
      document.getElementById('crNameInput').value = '';
      document.getElementById('crSectionsInput').value = '';
      document.getElementById('crForbiddenInput').value = '';
      renderGovernanceModalLists();
      showToast(`🧩 Đã tạo bộ tiêu chí "${res.profile.name}"!`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Search docs
  document.getElementById('docSearchInput').addEventListener('input', renderDocList);

  // Reset demo
  document.getElementById('btnResetDemo').addEventListener('click', async () => {
    if (!window.confirm('Khôi phục lại 4 hồ sơ mẫu ban đầu của DocReview Studio?')) return;
    try {
      const res = await apiFetch('/api/documents/reset-demo', { method: 'POST' });
      state.documents = res.documents;
      await selectDocument(state.documents[0].id);
      showToast('Đã khôi phục bộ 4 tài liệu mẫu!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Stage mode & Inspector tabs
  document.querySelectorAll('.mode-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchStageMode(btn.dataset.mode));
  });
  document.querySelectorAll('.insp-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchInspectorTab(btn.dataset.tab));
  });

  // Inline diff toggle
  document.getElementById('chkShowInlineDiff').addEventListener('change', () => {
    if (state.currentDoc) renderReviewCanvas(state.currentDoc);
  });

  // Floating selection toolbar on #reviewCanvas
  const selToolbar = document.getElementById('selectionToolbar');
  document.addEventListener('mouseup', (e) => {
    if (selToolbar.contains(e.target)) return;
    const sel = window.getSelection();
    const canvas = document.getElementById('reviewCanvas');
    if (!sel || sel.isCollapsed || !canvas.contains(sel.anchorNode)) {
      selToolbar.classList.add('hidden');
      return;
    }
    const text = sel.toString().trim();
    if (text.length < 3 || text.length > 600) {
      selToolbar.classList.add('hidden');
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    selToolbar.style.left = `${rect.left + rect.width / 2}px`;
    selToolbar.style.top = `${Math.max(58, rect.top)}px`;
    selToolbar.dataset.quote = text;
    selToolbar.classList.remove('hidden');
  });

  document.getElementById('btnQuickComment').addEventListener('click', () => {
    const quote = selToolbar.dataset.quote || '';
    selToolbar.classList.add('hidden');
    window.getSelection()?.removeAllRanges();
    openCommentComposerWithQuote(quote);
  });

  document.getElementById('btnQuickSuggest').addEventListener('click', () => {
    const quote = selToolbar.dataset.quote || '';
    selToolbar.classList.add('hidden');
    window.getSelection()?.removeAllRanges();
    openSuggestComposerWithQuote(quote);
  });

  // Document title & profile updates
  document.getElementById('docTitleInput').addEventListener('change', async (e) => {
    if (!state.currentDoc) return;
    const { author } = getActivePersona();
    try {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}`, {
        method: 'PUT',
        body: { title: e.target.value, actor: author }
      });
      syncWorkspaceState(res.document, res.documents);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('profileSelect').addEventListener('change', async (e) => {
    if (!state.currentDoc) return;
    const { author } = getActivePersona();
    try {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}`, {
        method: 'PUT',
        body: { profileId: e.target.value, actor: author }
      });
      syncWorkspaceState(res.document, res.documents);
      showToast('Đã chuyển bộ tiêu chuẩn đánh giá và chấm điểm lại!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btnDeleteDoc').addEventListener('click', async () => {
    if (!state.currentDoc) return;
    if (state.documents.length <= 1) {
      showToast('Cần giữ lại ít nhất 1 tài liệu trong không gian làm việc.', 'error');
      return;
    }
    if (!window.confirm(`Xóa tài liệu "${state.currentDoc.title}"?`)) return;
    try {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}`, {
        method: 'DELETE'
      });
      state.documents = res.documents;
      await selectDocument(state.documents[0].id);
      showToast('Đã xóa tài liệu.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Insert missing sections skeleton
  document.getElementById('btnInsertMissingSecs').addEventListener('click', async () => {
    const doc = state.currentDoc;
    if (!doc) return;
    const missing = doc.qualityReport.sectionChecklist.filter((s) => !s.passed);
    if (missing.length === 0) return;

    const appended = missing
      .map((m) => `## ${m.label}\nTrình bày chi tiết nội dung cho mục "${m.label}" tại đây.`)
      .join('\n\n');
    const nextContent = `${doc.content.trim()}\n\n${appended}`;
    const { author } = getActivePersona();
    try {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(doc.id)}`, {
        method: 'PUT',
        body: { content: nextContent, actor: author }
      });
      syncWorkspaceState(res.document, res.documents);
      showToast(`Đã chèn khung ${missing.length} đề mục còn thiếu vào cuối tài liệu!`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Source Editor events
  const srcArea = document.getElementById('sourceTextarea');
  srcArea.addEventListener('input', () => {
    state.isEditorDirty = true;
    document.getElementById('unsavedDot').classList.remove('hidden');
    updateLiveEditorCounter();
  });

  const saveSourceContent = async () => {
    if (!state.currentDoc) return;
    const { author } = getActivePersona();
    try {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}`, {
        method: 'PUT',
        body: { content: srcArea.value, actor: author }
      });
      state.isEditorDirty = false;
      document.getElementById('unsavedDot').classList.add('hidden');
      syncWorkspaceState(res.document, res.documents);
      showToast('💾 Đã lưu bản thảo và chấm điểm chất lượng mới!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  document.getElementById('btnSaveSource').addEventListener('click', saveSourceContent);
  document.getElementById('btnCancelEdit').addEventListener('click', () => {
    if (!state.currentDoc) return;
    srcArea.value = state.currentDoc.content;
    state.isEditorDirty = false;
    document.getElementById('unsavedDot').classList.add('hidden');
    updateLiveEditorCounter();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && state.activeMode === 'edit') {
      e.preventDefault();
      saveSourceContent();
    }
  });

  document.querySelectorAll('.fmt-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const start = srcArea.selectionStart;
      const end = srcArea.selectionEnd;
      const selected = srcArea.value.slice(start, end) || 'Nội dung';
      let insert = selected;
      const fmt = btn.dataset.fmt;
      if (fmt === 'h2') insert = `\n## ${selected}\n`;
      else if (fmt === 'h3') insert = `\n### ${selected}\n`;
      else if (fmt === 'bold') insert = `**${selected}**`;
      else if (fmt === 'italic') insert = `*${selected}*`;
      else if (fmt === 'bullet') insert = `\n- ${selected}`;
      else if (fmt === 'table') insert = `\n| Hạng mục | Mô tả | Chỉ tiêu |\n| --- | --- | --- |\n| Mục 1 | Chi tiết | >= 99% |\n`;
      else if (fmt === 'diagram') {
        insert = `\n\`\`\`mermaid\nflowchart LR\n  A[Bước 1: Tiếp nhận] -->|Xác thực| B[Bước 2: Xử lý]\n  B -->|Lưu vết| C[Bước 3: Hoàn tất]\n\`\`\`\n`;
      }

      srcArea.setRangeText(insert, start, end, 'end');
      srcArea.dispatchEvent(new Event('input'));
      srcArea.focus();
    });
  });

  // Comments composer & filter
  document.querySelectorAll('#commentFilterGroup .pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.commentFilter = btn.dataset.cfilter;
      document.querySelectorAll('#commentFilterGroup .pill-btn').forEach((b) =>
        b.classList.toggle('active', b === btn)
      );
      if (state.currentDoc) renderCommentsInspector(state.currentDoc);
    });
  });

  document.getElementById('btnAddGeneralComment').addEventListener('click', () => openCommentComposerWithQuote(''));
  document.getElementById('btnCloseCommentComposer').addEventListener('click', () => {
    document.getElementById('commentComposer').classList.add('hidden');
  });

  document.getElementById('commentComposer').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.currentDoc) return;
    const persona = getActivePersona();
    const category = document.getElementById('commentCategorySelect').value;
    const text = document.getElementById('commentTextInput').value.trim();
    if (!text) return;

    try {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}/comments`, {
        method: 'POST',
        body: {
          author: persona.author,
          role: persona.role,
          category,
          quote: state.selectedQuote || '',
          text
        }
      });
      document.getElementById('commentTextInput').value = '';
      state.selectedQuote = '';
      document.getElementById('commentComposer').classList.add('hidden');
      syncWorkspaceState(res.document, res.documents);
      showToast('💬 Đã gắn bình luận vào tài liệu!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Track Changes composer & Accept All
  document.getElementById('btnNewSuggestManual').addEventListener('click', () => openSuggestComposerWithQuote(''));
  document.getElementById('btnCloseSuggestComposer').addEventListener('click', () => {
    document.getElementById('suggestComposer').classList.add('hidden');
  });

  document.getElementById('suggestComposer').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.currentDoc) return;
    const persona = getActivePersona();
    try {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}/suggestions`, {
        method: 'POST',
        body: {
          author: persona.author,
          role: persona.role,
          originalText: document.getElementById('sugOriginalInput').value,
          suggestedText: document.getElementById('sugProposedInput').value,
          reason: document.getElementById('sugReasonInput').value
        }
      });
      document.getElementById('sugReasonInput').value = '';
      document.getElementById('suggestComposer').classList.add('hidden');
      syncWorkspaceState(res.document, res.documents);
      showToast('✏️ Đã tạo đề xuất Track Change!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btnAcceptAllSug').addEventListener('click', async () => {
    if (!state.currentDoc) return;
    const { author } = getActivePersona();
    try {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}/suggestions/accept-all`, {
        method: 'POST',
        body: { actor: author }
      });
      syncWorkspaceState(res.document, res.documents);
      showToast(`✅ Đã áp dụng ${res.appliedCount} đề xuất Track Changes!`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Diff controls
  document.getElementById('btnRunDiff').addEventListener('click', runVersionDiff);
  document.getElementById('diffBaseSelect').addEventListener('change', runVersionDiff);
  document.getElementById('diffTargetSelect').addEventListener('change', runVersionDiff);

  document.querySelectorAll('[data-difflayout]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.diffLayout = btn.dataset.difflayout;
      document.querySelectorAll('[data-difflayout]').forEach((b) => b.classList.toggle('active', b === btn));
      if (state.lastDiffResult) renderDiffOutput(state.lastDiffResult);
    });
  });

  document.getElementById('btnRestoreBase').addEventListener('click', async () => {
    if (!state.currentDoc) return;
    const verId = document.getElementById('diffBaseSelect').value;
    if (!verId) return;
    if (!window.confirm('Khôi phục nội dung tài liệu hiện tại về mốc phiên bản Base đang chọn?')) return;
    const { author } = getActivePersona();
    try {
      const res = await apiFetch(
        `/api/documents/${encodeURIComponent(state.currentDoc.id)}/versions/${encodeURIComponent(verId)}/restore`,
        { method: 'POST', body: { actor: author } }
      );
      syncWorkspaceState(res.document, res.documents);
      switchStageMode('review');
      showToast('⏪ Đã khôi phục phiên bản thành công!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Sign-off / Gate
  document.getElementById('gateSummaryChip').addEventListener('click', () => switchInspectorTab('approval'));
  document.getElementById('btnOpenSignOff').addEventListener('click', () => {
    switchInspectorTab('approval');
    document.getElementById('signNoteInput').focus();
  });

  document.getElementById('signOffForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.currentDoc) return;
    const persona = getActivePersona();
    const decision = document.getElementById('signDecisionSelect').value;
    const note = document.getElementById('signNoteInput').value.trim();
    const forceOverride = document.getElementById('chkForceOverride').checked;

    try {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}/signoff`, {
        method: 'POST',
        body: {
          reviewer: persona.author,
          role: persona.role,
          decision,
          note,
          forceOverride
        }
      });
      document.getElementById('signNoteInput').value = '';
      syncWorkspaceState(res.document, res.documents);
      showToast(`✍️ Đã ghi nhận chữ ký thẩm định (${decision})!`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Modals: New Doc, Snapshot, AI Review
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.closeModal).classList.add('hidden');
    });
  });

  document.getElementById('btnNewDoc').addEventListener('click', () => {
    document.getElementById('modalNewDoc').classList.remove('hidden');
    document.getElementById('newDocTitle').focus();
  });

  document.getElementById('formNewDoc').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('newDocTitle').value.trim();
    const profileId = document.getElementById('newDocProfile').value;
    const mode = document.getElementById('newDocTemplateMode').value;
    const prof = state.profiles.find((p) => p.id === profileId);
    const { author, role } = getActivePersona();

    let content = `# ${title}\n\n`;
    if (mode === 'skeleton' && prof) {
      content += prof.requiredSections
        .map((s, idx) => `## ${idx + 1}. ${s.label}\nNhập nội dung cụ thể cho phần "${s.label}" tại đây.`)
        .join('\n\n');
    }

    try {
      const res = await apiFetch('/api/documents', {
        method: 'POST',
        body: { title, profileId, content, owner: `${author} (${role})` }
      });
      document.getElementById('modalNewDoc').classList.add('hidden');
      document.getElementById('newDocTitle').value = '';
      syncWorkspaceState(res.document, res.documents);
      showToast('➕ Đã khởi tạo tài liệu mới!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btnQuickSnapshot').addEventListener('click', () => {
    if (!state.currentDoc) return;
    const nextIdx = (state.currentDoc.versions?.length || 1);
    document.getElementById('snapLabelInput').value = `v1.${nextIdx} — Bản cập nhật sau rà soát`;
    document.getElementById('modalSnapshot').classList.remove('hidden');
  });

  document.getElementById('formSnapshot').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.currentDoc) return;
    const { author } = getActivePersona();
    try {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}/versions`, {
        method: 'POST',
        body: {
          label: document.getElementById('snapLabelInput').value,
          note: document.getElementById('snapNoteInput').value,
          author
        }
      });
      document.getElementById('modalSnapshot').classList.add('hidden');
      document.getElementById('snapNoteInput').value = '';
      syncWorkspaceState(res.document, res.documents);
      showToast(`📸 Đã lưu mốc phiên bản "${res.version.label}"!`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btnAiReview').addEventListener('click', () => {
    const banner = document.getElementById('aiEnvStatusBanner');
    if (state.aiConfig.hasGemini || state.aiConfig.hasOpenAI) {
      banner.innerHTML = `✅ Đã phát hiện khóa cấu hình sẵn trong <code>.env</code> (${
        state.aiConfig.hasGemini ? 'Gemini' : 'OpenAI'
      }). Có thể chạy ngay!`;
    } else {
      banner.innerHTML = `ℹ️ Chưa khai báo khóa trong <code>.env</code>. Hãy dán khóa Gemini (<code>AIza...</code>) hoặc OpenAI (<code>sk-...</code>) bên dưới nếu muốn gọi LLM.`;
    }
    document.getElementById('modalAiReview').classList.remove('hidden');
  });

  document.getElementById('formAiReview').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.currentDoc) return;
    const btn = document.getElementById('btnSubmitAiReview');
    btn.disabled = true;
    btn.textContent = '⏳ Đang phân tích tài liệu bằng AI...';

    try {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}/ai-review`, {
        method: 'POST',
        body: {
          provider: document.getElementById('aiProviderSelect').value,
          apiKey: document.getElementById('aiApiKeyInput').value.trim(),
          maskPiiBeforeAi: document.getElementById('chkMaskPiiBeforeAi').checked,
          autoApplyToWorkspace: true
        }
      });
      document.getElementById('modalAiReview').classList.add('hidden');
      syncWorkspaceState(res.document, res.documents);
      showToast(
        `🤖 AI (${res.aiResult.modelLabel}) đã thêm ${res.aiResult.comments.length} bình luận & ${res.aiResult.suggestions.length} đề xuất sửa!`,
        'success'
      );
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '🚀 Chạy AI Phân Tích & Gắn Góp Ý';
    }
  });

  // File Import (Button + Drag & Drop)
  const fileInput = document.getElementById('fileInput');
  document.getElementById('btnImportFile').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) {
      handleUploadedFile(fileInput.files[0]);
      fileInput.value = '';
    }
  });

  const dropOverlay = document.getElementById('dropOverlay');
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropOverlay.classList.remove('hidden');
  });
  dropOverlay.addEventListener('dragleave', (e) => {
    if (e.target === dropOverlay) dropOverlay.classList.add('hidden');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dropOverlay.classList.add('hidden');
    if (e.dataTransfer?.files?.[0]) {
      handleUploadedFile(e.dataTransfer.files[0]);
    }
  });

  // Export Dropdown
  const exportBtn = document.getElementById('btnExportMenu');
  const exportMenu = document.getElementById('exportDropdown');
  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', () => exportMenu.classList.add('hidden'));
  exportMenu.querySelectorAll('[data-export]').forEach((item) => {
    item.addEventListener('click', () => handleExportAction(item.dataset.export));
  });

  // v3.0: Outline TOC, Readability Heatmap & Voice TTS Proofreader
  document.getElementById('btnToggleToc').addEventListener('click', () => {
    document.getElementById('outlineTocPanel').classList.toggle('hidden');
  });

  document.getElementById('chkReadabilityHeatmap').addEventListener('change', () => {
    if (state.currentDoc) renderReviewCanvas(state.currentDoc);
  });

  document.getElementById('btnToggleTts').addEventListener('click', () => {
    if (state.isSpeakingTts) stopTtsProofreader();
    else startTtsProofreader();
  });

  // v3.0: Reversible PII Vault & Cross-App Ecosystem Bridges
  document.getElementById('btnRedactPiiVault').addEventListener('click', async () => {
    if (!state.currentDoc) return;
    const { author } = getActivePersona();
    try {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}/pii/redact`, {
        method: 'POST',
        body: { mode: 'TOKEN_VAULT', actor: author }
      });
      syncWorkspaceState(res.document, res.documents);
      loadAndRenderAnalyticsHub();
      showToast(
        res.redactedCount > 0
          ? `🕵️ Đã ẩn ${res.redactedCount} thông tin nhạy cảm vào Két sắt PII!`
          : 'Không phát hiện thêm thông tin PII dạng rõ nào cần ẩn.',
        'success'
      );
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btnRestorePiiVault').addEventListener('click', async () => {
    if (!state.currentDoc) return;
    const { author } = getActivePersona();
    try {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}/pii/restore`, {
        method: 'POST',
        body: { actor: author }
      });
      syncWorkspaceState(res.document, res.documents);
      loadAndRenderAnalyticsHub();
      showToast(
        res.restoredCount > 0
          ? `🔓 Đã khôi phục nguyên bản ${res.restoredCount} thông tin từ Két sắt PII!`
          : 'Không có thẻ [PII_...] nào trong văn bản cần khôi phục.',
        'success'
      );
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btnBridgeContractShield').addEventListener('click', async () => {
    if (!state.currentDoc) return;
    const banner = document.getElementById('bridgeResultBanner');
    banner.classList.remove('hidden');
    banner.textContent = '⏳ Đang kết nối sang ContractShield (Port 4175) để kiểm toán pháp lý...';
    try {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}/bridge/contract-shield`, {
        method: 'POST',
        body: { importFindings: true }
      });
      if (res.bridge.connected && res.bridge.report) {
        syncWorkspaceState(res.document, res.documents);
        banner.innerHTML = `✅ <strong>ContractShield (Port 4175):</strong> Điểm An Toàn <strong>${
          res.bridge.report.safetyScore
        }/100 (Hạng ${escapeHtml(res.bridge.report.grade)})</strong> — Đã đồng bộ <strong>${
          res.importedCount
        }</strong> cảnh báo pháp lý vào luồng Bình luận! <a href="${escapeHtml(
          res.bridge.targetUrl
        )}" target="_blank" rel="noopener">Mở ContractShield ↗</a>`;
        showToast('⚖️ Đã đồng bộ kết quả kiểm toán từ ContractShield!', 'success');
      } else {
        banner.textContent = `ℹ️ ${res.bridge.message}`;
      }
    } catch (err) {
      banner.textContent = `⚠️ ${err.message}`;
    }
  });

  document.getElementById('btnBridgeOmniTrace').addEventListener('click', async () => {
    if (!state.currentDoc) return;
    const banner = document.getElementById('bridgeResultBanner');
    banner.classList.remove('hidden');
    banner.textContent = '⏳ Đang bóc tách IOC & đẩy sang Đồ thị OmniTrace OSINT (Port 4090)...';
    try {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}/bridge/omnitrace`, {
        method: 'POST',
        body: {}
      });
      const ex = res.bridge.extracted;
      banner.innerHTML = `${res.bridge.connected ? '✅' : 'ℹ️'} ${escapeHtml(
        res.bridge.message
      )}<br/><span style="font-size:11px;color:var(--text-muted);">Thực thể tìm thấy: ${
        ex.domains.length
      } Domain • ${ex.emails.length} Email • ${ex.phones.length} SĐT • ${ex.taxIds.length} MST</span>`;
      showToast('🕸️ Đã hoàn tất trích xuất & liên thông IOC sang OmniTrace!', 'success');
    } catch (err) {
      banner.textContent = `⚠️ ${err.message}`;
    }
  });

  // v3.0: Command Palette (Ctrl+K / Cmd+K)
  document.getElementById('btnCommandPalette').addEventListener('click', openCommandPalette);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCommandPalette();
      return;
    }
    const cmdModal = document.getElementById('modalCommandPalette');
    if (!cmdModal.classList.contains('hidden')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cmdModal.classList.add('hidden');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (state.cmdFilteredItems.length > 0) {
          state.cmdSelectedIndex = (state.cmdSelectedIndex + 1) % state.cmdFilteredItems.length;
          paintCommandItems();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (state.cmdFilteredItems.length > 0) {
          state.cmdSelectedIndex =
            (state.cmdSelectedIndex - 1 + state.cmdFilteredItems.length) % state.cmdFilteredItems.length;
          paintCommandItems();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const chosen = state.cmdFilteredItems[state.cmdSelectedIndex];
        if (chosen && typeof chosen.run === 'function') {
          cmdModal.classList.add('hidden');
          chosen.run();
        }
      }
    }
  });

  document.getElementById('cmdSearchInput').addEventListener('input', (e) => {
    filterCommandPalette(e.target.value);
  });

  document.getElementById('modalCommandPalette').addEventListener('click', (e) => {
    if (e.target.id === 'modalCommandPalette') {
      e.target.classList.add('hidden');
    }
  });
}

function renderGovernanceModalLists() {
  const glList = document.getElementById('glossaryRulesList');
  const rules = state.governance?.glossaryRules || [];

  if (rules.length === 0) {
    glList.innerHTML = `<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:12px;">Chưa có quy tắc thuật ngữ nào.</div>`;
  } else {
    glList.innerHTML = rules
      .map(
        (r) => `<div class="gov-item">
          <div>
            <del class="inline-del">${escapeHtml(r.wrongTerm)}</del>
            <strong style="margin:0 6px;color:var(--primary);">➔</strong>
            <ins class="inline-ins">${escapeHtml(r.preferredTerm)}</ins>
            ${r.caseSensitive ? '<span class="mini-pill" style="margin-left:6px;">Phân biệt HOA/thường</span>' : ''}
            ${r.note ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${escapeHtml(r.note)}</div>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
            <label class="toggle-inline" style="font-size:11.5px;">
              <input type="checkbox" data-toggle-gl="${escapeHtml(r.id)}" ${r.enabled ? 'checked' : ''} />
              <span>Bật</span>
            </label>
            <button type="button" class="btn-icon-subtle" data-del-gl="${escapeHtml(r.id)}" title="Xóa quy tắc">🗑️</button>
          </div>
        </div>`
      )
      .join('');
  }

  glList.querySelectorAll('[data-toggle-gl]').forEach((chk) => {
    chk.addEventListener('change', async () => {
      try {
        const res = await apiFetch(`/api/governance/glossary/${encodeURIComponent(chk.dataset.toggleGl)}`, {
          method: 'PATCH',
          body: { enabled: chk.checked }
        });
        state.governance = res.governance;
        state.documents = res.documents;
        if (state.currentDoc) {
          const docRes = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}`);
          syncWorkspaceState(docRes.document, state.documents);
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  glList.querySelectorAll('[data-del-gl]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const res = await apiFetch(`/api/governance/glossary/${encodeURIComponent(btn.dataset.delGl)}`, {
          method: 'DELETE'
        });
        state.governance = res.governance;
        state.documents = res.documents;
        renderGovernanceModalLists();
        if (state.currentDoc) {
          const docRes = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}`);
          syncWorkspaceState(docRes.document, state.documents);
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  // Custom Rubrics list
  const crList = document.getElementById('customRubricsList');
  const customProfiles = state.governance?.customProfiles || [];
  if (customProfiles.length === 0) {
    crList.innerHTML = `<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:12px;">Chưa có bộ tiêu chí tùy chỉnh nào. Hãy tạo mới ở khung bên trái!</div>`;
  } else {
    crList.innerHTML = customProfiles
      .map(
        (cp) => `<div class="gov-item" style="flex-direction:column;align-items:stretch;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${escapeHtml(cp.icon)} ${escapeHtml(cp.name)}</strong>
            <div style="display:flex;gap:6px;">
              <button type="button" class="btn btn-xs btn-outline" data-apply-cr="${escapeHtml(cp.id)}">Áp dụng ngay</button>
              <button type="button" class="btn-icon-subtle" data-del-cr="${escapeHtml(cp.id)}" title="Xóa bộ tiêu chí">🗑️</button>
            </div>
          </div>
          <div style="font-size:11.5px;color:var(--text-secondary);">
            ${(cp.requiredSections || []).length} đề mục bắt buộc${
          cp.forbiddenPhrases?.length ? ` • ${cp.forbiddenPhrases.length} cụm từ cấm` : ''
        }
          </div>
        </div>`
      )
      .join('');
  }

  crList.querySelectorAll('[data-apply-cr]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!state.currentDoc) return;
      const { author } = getActivePersona();
      try {
        const res = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}`, {
          method: 'PUT',
          body: { profileId: btn.dataset.applyCr, actor: author }
        });
        document.getElementById('modalGovernance').classList.add('hidden');
        syncWorkspaceState(res.document, res.documents);
        showToast('🧩 Đã áp dụng Bộ tiêu chí tùy chỉnh cho tài liệu hiện tại!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  crList.querySelectorAll('[data-del-cr]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const res = await apiFetch(`/api/governance/profiles/${encodeURIComponent(btn.dataset.delCr)}`, {
          method: 'DELETE'
        });
        state.governance = res.governance;
        state.profiles = res.profiles;
        state.documents = res.documents;
        populateProfileSelects();
        renderGovernanceModalLists();
        if (state.currentDoc) {
          const docRes = await apiFetch(`/api/documents/${encodeURIComponent(state.currentDoc.id)}`);
          syncWorkspaceState(docRes.document, state.documents);
        }
        showToast('Đã xóa bộ tiêu chí tùy chỉnh.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

window.addEventListener('DOMContentLoaded', initApp);


// ============================================================================
// 🔊 VOICE TTS PROOFREADER, 📊 ANALYTICS HUB & ⚡ COMMAND PALETTE (CTRL+K)
// ============================================================================

function stopTtsProofreader() {
  state.isSpeakingTts = false;
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  document.getElementById('btnToggleTts').textContent = '🔊 Đọc soát TTS';
  document.querySelectorAll('.doc-block.tts-speaking').forEach((el) => el.classList.remove('tts-speaking'));
}

function startTtsProofreader() {
  if (!('speechSynthesis' in window)) {
    showToast('Trình duyệt hiện tại không hỗ trợ Web Speech TTS.', 'error');
    return;
  }
  const segments = state.currentDoc?.readability?.ttsSegments || [];
  if (segments.length === 0) {
    showToast('Không có nội dung văn bản để đọc.', 'error');
    return;
  }

  window.speechSynthesis.cancel();
  state.isSpeakingTts = true;
  document.getElementById('btnToggleTts').textContent = '⏹️ Dừng đọc';

  const voices = window.speechSynthesis.getVoices();
  const viVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('vi')) || null;
  const rate = parseFloat(document.getElementById('ttsRateSelect').value || '1.05');

  let idx = 0;
  const speakNext = () => {
    if (!state.isSpeakingTts || idx >= segments.length) {
      stopTtsProofreader();
      return;
    }
    const seg = segments[idx++];
    document.querySelectorAll('.doc-block.tts-speaking').forEach((el) => el.classList.remove('tts-speaking'));
    const blk = document.getElementById(`doc-para-${seg.paraIndex}`);
    if (blk) {
      blk.classList.add('tts-speaking');
      blk.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    const utter = new SpeechSynthesisUtterance(seg.text);
    utter.lang = 'vi-VN';
    if (viVoice) utter.voice = viVoice;
    utter.rate = rate;
    utter.onend = speakNext;
    utter.onerror = () => stopTtsProofreader();
    window.speechSynthesis.speak(utter);
  };

  speakNext();
}

async function loadAndRenderAnalyticsHub() {
  const doc = state.currentDoc;
  if (doc) {
    const rawPii = doc.detectedPii || [];
    const vaultItems = doc.piiVault || [];
    document.getElementById('piiDetectedBadge').textContent = `${rawPii.length} PII rõ • ${vaultItems.length} trong Két`;

    const piiList = document.getElementById('piiVaultPreviewList');
    if (rawPii.length === 0 && vaultItems.length === 0) {
      piiList.innerHTML = `<div style="font-size:12px;color:var(--success);padding:6px 0;">✅ Không phát hiện dữ liệu cá nhân/nhạy cảm dạng rõ trong tài liệu này.</div>`;
    } else {
      const rawRows = rawPii
        .map(
          (p) => `<div class="pii-row">
            <span><strong>[${escapeHtml(p.type)}]</strong> ${escapeHtml(p.label)}</span>
            <code style="color:var(--danger);">${escapeHtml(p.maskedPreview)} (Đang lộ rõ)</code>
          </div>`
        )
        .join('');
      const vaultRows = vaultItems
        .map(
          (v) => `<div class="pii-row">
            <span><strong>${escapeHtml(v.token)}</strong> (${escapeHtml(v.label)})</span>
            <span style="color:var(--success);font-weight:600;">🔒 Đã cất Két (${escapeHtml(v.maskedPreview)})</span>
          </div>`
        )
        .join('');
      piiList.innerHTML = rawRows + vaultRows;
    }
  }

  try {
    const res = await apiFetch('/api/analytics');
    const a = res.analytics;
    document.getElementById('analyticsKpiGrid').innerHTML = `
      <div class="kpi-card">
        <div class="kpi-num">${a.totalDocs}</div>
        <div class="kpi-label">Tổng tài liệu trong kho</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num">${a.avgQualityScore}/100</div>
        <div class="kpi-label">Điểm chất lượng TB toàn kho</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" style="color:var(--success)">${a.sealedValidCount}</div>
        <div class="kpi-label">Hồ sơ Đã Niêm Phong SHA-256</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" style="color:var(--danger)">${a.totalOpenBlockers}</div>
        <div class="kpi-label">Điểm nghẽn Blocker đang mở</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" style="color:var(--warning)">${a.totalPendingSuggestions}</div>
        <div class="kpi-label">Track Changes chờ xử lý</div>
      </div>
    `;

    const rowsHtml = (a.bottleneckDocs || [])
      .map(
        (b) => `<tr data-jump-doc="${escapeHtml(b.id)}" style="cursor:pointer;">
          <td><strong>${escapeHtml(b.title)}</strong><br/><span style="font-size:11px;color:var(--text-muted);">${escapeHtml(
          b.owner || ''
        )}</span></td>
          <td><strong>${b.overallScore}/100</strong> (${escapeHtml(b.grade)})</td>
          <td>${escapeHtml(b.status)} ${
          b.sealStatus === 'VALID' ? '🔒' : b.sealStatus === 'TAMPERED' ? '🚨 Lệch Seal' : ''
        }</td>
          <td style="color:${b.openBlockers > 0 ? 'var(--danger)' : 'var(--text-muted)'};font-weight:700;">${
          b.openBlockers
        } Blocker</td>
          <td>${b.pendingSuggestions} đề xuất • ${b.criticalFindings} lỗi Critical</td>
        </tr>`
      )
      .join('');

    const wrap = document.getElementById('bottleneckTableWrap');
    wrap.innerHTML = `<table class="md-table">
      <thead>
        <tr>
          <th>Tài liệu & Chủ sở hữu</th>
          <th>Điểm Chất lượng</th>
          <th>Trạng thái & Niêm phong</th>
          <th>Blocker tồn đọng</th>
          <th>Chi tiết hàng đợi SLA</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;

    wrap.querySelectorAll('[data-jump-doc]').forEach((tr) => {
      tr.addEventListener('click', async () => {
        await selectDocument(tr.dataset.jumpDoc);
        switchStageMode('review');
      });
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function buildCommandCatalog() {
  const items = [
    {
      label: '📖 Chuyển sang chế độ Rà Soát & Bôi Đen',
      category: 'Chế độ xem',
      run: () => switchStageMode('review')
    },
    {
      label: '✏️ Mở trình Soạn Thảo Nguồn Markdown',
      category: 'Chế độ xem',
      run: () => switchStageMode('edit')
    },
    {
      label: '🔀 Mở bộ So Sánh Phiên Bản (Version Diff)',
      category: 'Chế độ xem',
      run: () => switchStageMode('diff')
    },
    {
      label: '📊 Mở Dashboard Thống Kê SLA, Két PII & Liên Thông',
      category: 'Quản trị',
      run: () => switchStageMode('analytics')
    },
    {
      label: '🎨 Bật / Tắt Ma trận Đọc hiểu (Readability Heatmap)',
      category: 'Công cụ Review',
      run: () => {
        const chk = document.getElementById('chkReadabilityHeatmap');
        chk.checked = !chk.checked;
        switchStageMode('review');
        if (state.currentDoc) renderReviewCanvas(state.currentDoc);
      }
    },
    {
      label: '🔊 Bật / Dừng Đọc soát bằng Giọng nói tiếng Việt (TTS)',
      category: 'Công cụ Review',
      run: () => {
        switchStageMode('review');
        if (state.isSpeakingTts) stopTtsProofreader();
        else startTtsProofreader();
      }
    },
    {
      label: '✨ Chuẩn hóa toàn bộ Thuật ngữ theo Từ điển (Glossary Enforcer)',
      category: 'Tự động hóa',
      run: () => document.getElementById('btnAutoNormalizeGlossary').click()
    },
    {
      label: '🕵️ Ẩn thông tin nhạy cảm (CCCD/SĐT/Email/STK) vào Két sắt PII',
      category: 'Bảo mật PII',
      run: () => {
        switchStageMode('analytics');
        document.getElementById('btnRedactPiiVault').click();
      }
    },
    {
      label: '🔓 Khôi phục 100% Dữ liệu gốc từ Két sắt PII',
      category: 'Bảo mật PII',
      run: () => {
        switchStageMode('analytics');
        document.getElementById('btnRestorePiiVault').click();
      }
    },
    {
      label: '⚖️ Đẩy tài liệu sang ContractShield (Port 4175) quét bẫy pháp lý',
      category: 'Liên thông AI_App',
      run: () => {
        switchStageMode('analytics');
        document.getElementById('btnBridgeContractShield').click();
      }
    },
    {
      label: '🕸️ Đẩy thực thể đối tác sang Đồ thị OmniTrace OSINT (Port 4090)',
      category: 'Liên thông AI_App',
      run: () => {
        switchStageMode('analytics');
        document.getElementById('btnBridgeOmniTrace').click();
      }
    },
    {
      label: '🛠️ Mở Quản trị Từ điển Thuật ngữ & Custom Rubric',
      category: 'Quản trị',
      run: () => document.getElementById('btnOpenGovernance').click()
    },
    {
      label: '🌓 Đổi giao diện Sáng / Tối (Light / Dark Theme)',
      category: 'Giao diện',
      run: () => document.getElementById('btnThemeToggle').click()
    }
  ];

  // Thêm các đề mục của tài liệu đang mở
  for (const sec of state.currentDoc?.readability?.outline || []) {
    items.push({
      label: `📑 Nhảy tới mục: ${sec.title} (¶${sec.paraIndex})`,
      category: 'Mục lục bài này',
      run: () => scrollToParagraph(sec.paraIndex)
    });
  }

  // Thêm danh sách toàn bộ tài liệu trong kho
  for (const d of state.documents || []) {
    items.push({
      label: `📄 Mở tài liệu: ${d.title} (${d.overallScore}đ)`,
      category: 'Kho tài liệu',
      run: () => selectDocument(d.id)
    });
  }

  return items;
}

function openCommandPalette() {
  const modal = document.getElementById('modalCommandPalette');
  const input = document.getElementById('cmdSearchInput');
  modal.classList.remove('hidden');
  input.value = '';
  filterCommandPalette('');
  input.focus();
}

function filterCommandPalette(query) {
  const q = String(query || '').trim().toLowerCase();
  const all = buildCommandCatalog();
  state.cmdFilteredItems = q
    ? all.filter((it) => it.label.toLowerCase().includes(q) || it.category.toLowerCase().includes(q))
    : all;
  state.cmdSelectedIndex = 0;
  paintCommandItems();
}

function paintCommandItems() {
  const listEl = document.getElementById('cmdResultsList');
  if (state.cmdFilteredItems.length === 0) {
    listEl.innerHTML = `<div style="padding:18px;text-align:center;color:var(--text-muted);font-size:13px;">Không tìm thấy lệnh phù hợp.</div>`;
    return;
  }

  listEl.innerHTML = state.cmdFilteredItems
    .slice(0, 20)
    .map(
      (item, idx) => `<div class="cmd-item ${idx === state.cmdSelectedIndex ? 'selected' : ''}" data-cmd-idx="${idx}">
        <span>${escapeHtml(item.label)}</span>
        <span class="cmd-item-cat">${escapeHtml(item.category)}</span>
      </div>`
    )
    .join('');

  listEl.querySelectorAll('[data-cmd-idx]').forEach((el) => {
    el.addEventListener('click', () => {
      const chosen = state.cmdFilteredItems[Number(el.dataset.cmdIdx)];
      if (chosen) {
        document.getElementById('modalCommandPalette').classList.add('hidden');
        chosen.run();
      }
    });
  });
}
