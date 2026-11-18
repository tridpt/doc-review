/**
 * 📋✍️ DocReview Studio v3.0 — Ecosystem Document Intelligence, Realtime Review & Governance Hub (Port 4185)
 * - Chấm điểm chất lượng 5 trục (4 bộ chuẩn mặc định + Trình tạo Bộ tiêu chí riêng Custom Rubrics)
 * - Từ điển Thuật ngữ chuẩn (Glossary Enforcer: tự phát hiện từ sai quy ước & chuẩn hóa hàng loạt 1-Click)
 * - Cộng tác Thời gian thực qua SSE (Live Presence Avatars & Đồng bộ tức thì nhiều tab không cần F5)
 * - Niêm phong Mật mã Chữ ký số SHA-256 + HMAC-SHA256 chống sửa ngầm sau phê duyệt (Tamper-Evident Seal)
 * - Nhập / Xuất đa định dạng thuần Node.js: .DOCX (kèm word/comments.xml), .PDF, .MD, .TXT & Biên bản HTML/JSON
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const { REVIEW_PROFILES, evaluateDocument } = require('./lib/quality-engine');
const { compareVersions } = require('./lib/diff-engine');
const { parseDocxBuffer, buildDocxBuffer, escapeXml } = require('./lib/docx-codec');
const { parsePdfBuffer } = require('./lib/pdf-codec');
const { DocumentStore } = require('./lib/store');
const { RealtimeHub } = require('./lib/realtime-hub');
const { getEnvApiConfig, runAiDeepReview } = require('./lib/ai-reviewer');
const { redactDocumentPii, restoreDocumentPii } = require('./lib/pii-vault');
const {
  bridgeToContractShield,
  bridgeToOmniTrace,
  computeWorkspaceAnalytics
} = require('./lib/ecosystem-bridge');

function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}
loadDotEnv();

const PORT = Number(process.env.PORT || 4185);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_DATA_FILE = path.join(__dirname, 'data', 'documents.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Client-Id'
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, maxBytes = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Dữ liệu tải lên vượt quá giới hạn 20MB.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Định dạng JSON gửi lên không hợp lệ.'));
      }
    });
    req.on('error', reject);
  });
}

function buildAllProfilesPayload(governanceState) {
  const builtIn = Object.values(REVIEW_PROFILES).map((p) => ({
    id: p.id,
    name: p.name,
    icon: p.icon,
    isCustom: false,
    description: p.description,
    requiredSections: p.requiredSections.map((s) => ({ id: s.id, label: s.label }))
  }));

  const custom = (governanceState?.customProfiles || []).map((cp) => ({
    id: cp.id,
    name: cp.name,
    icon: cp.icon || '🧩',
    isCustom: true,
    description: cp.description || '',
    forbiddenPhrases: cp.forbiddenPhrases || [],
    requiredSections: (cp.requiredSections || []).map((s) => ({
      id: s.id,
      label: s.label,
      keywords: s.keywords || []
    }))
  }));

  return [...builtIn, ...custom];
}

function buildHtmlCertificate(doc) {
  const q = doc.qualityReport || evaluateDocument(doc.content, doc.profileId);
  const seal = doc.sealVerification;
  const statusMap = {
    DRAFT: 'Bản nháp (Draft)',
    IN_REVIEW: 'Đang rà soát (In Review)',
    CHANGES_REQUESTED: 'Yêu cầu chỉnh sửa (Changes Requested)',
    APPROVED: 'ĐÃ PHÊ DUYỆT CHÍNH THỨC (APPROVED)'
  };

  let sealHtml = '';
  if (seal && seal.isSealed) {
    const isOk = seal.status === 'VALID';
    sealHtml = `<div style="border:2px solid ${isOk ? '#059669' : '#dc2626'};background:${
      isOk ? '#ecfdf5' : '#fef2f2'
    };border-radius:12px;padding:16px 18px;margin-bottom:24px;">
      <div style="font-weight:800;font-size:15px;color:${isOk ? '#065f46' : '#991b1b'};">
        ${isOk ? '🔒' : '🚨'} ${escapeXml(seal.label)}
      </div>
      <div style="font-size:13.5px;margin-top:4px;color:#334155;">${escapeXml(seal.message)}</div>
      <div style="margin-top:10px;font-family:Consolas,monospace;font-size:12px;background:#fff;padding:10px;border-radius:8px;border:1px solid #cbd5e1;word-break:break-all;">
        <div><strong>Mã con dấu (Seal ID):</strong> ${escapeXml(seal.sealId)} • Ký lúc: ${escapeXml(
      new Date(seal.sealedAt).toLocaleString('vi-VN')
    )}</div>
        <div><strong>SHA-256 Bản Niêm Phong:</strong> ${escapeXml(seal.sealedContentSha256)}</div>
        <div><strong>SHA-256 Bản Hiện Hành:</strong> ${escapeXml(seal.liveContentSha256)}</div>
        <div><strong>Chữ ký HMAC-SHA256:</strong> ${escapeXml(seal.hmacSignature)}</div>
      </div>
    </div>`;
  }

  const approvalsRows =
    (doc.approvals || []).length > 0
      ? doc.approvals
          .map(
            (a) => `<tr>
              <td><strong>${escapeXml(a.reviewer)}</strong></td>
              <td>${escapeXml(a.role)}</td>
              <td><span class="badge badge-${escapeXml(a.decision.toLowerCase())}">${escapeXml(a.decision)}</span></td>
              <td>${escapeXml(a.note || '—')}</td>
              <td>${escapeXml(new Date(a.decidedAt).toLocaleString('vi-VN'))}</td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="5" style="text-align:center;color:#64748b;">Chưa có chữ ký phê duyệt nào được ghi nhận.</td></tr>';

  const findingsRows =
    q.findings.length > 0
      ? q.findings
          .map(
            (f) => `<tr>
              <td><strong>${escapeXml(f.severity)}</strong></td>
              <td>${escapeXml(f.axis)}</td>
              <td><strong>${escapeXml(f.title)}</strong><br/><span style="color:#475569;font-size:13px;">${escapeXml(f.message)}</span></td>
              <td>¶${f.paragraphIndex}</td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="4" style="text-align:center;color:#059669;">Không phát hiện lỗi chất lượng nào — Tài liệu đạt chuẩn sạch 100%.</td></tr>';

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <title>Biên Bản Nghiệm Thu & Niêm Phong Số — ${escapeXml(doc.title)}</title>
  <style>
    body { font-family: "Segoe UI", Roboto, Arial, sans-serif; color: #0f172a; max-width: 940px; margin: 32px auto; padding: 0 24px; line-height: 1.6; }
    .header { border-bottom: 3px solid #1d4ed8; padding-bottom: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-start; }
    .score-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 14px 20px; text-align: center; min-width: 150px; }
    .score-num { font-size: 34px; font-weight: 800; color: #1d4ed8; line-height: 1.1; }
    .meta-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 24px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin-bottom: 24px; font-size: 14px; }
    h2 { color: #1e3a8a; font-size: 18px; margin-top: 28px; border-left: 4px solid #2563eb; padding-left: 10px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px; }
    th, td { border: 1px solid #cbd5e1; padding: 10px 12px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; color: #1e293b; }
    .badge { padding: 3px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; }
    .badge-approved { background: #dcfce7; color: #166534; }
    .badge-changes_requested { background: #fee2e2; color: #991b1b; }
    .badge-in_review { background: #fef3c7; color: #92400e; }
    .print-btn { background: #1d4ed8; color: #fff; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: 600; }
    @media print { .no-print { display: none; } body { margin: 0; } }
  </style>
</head>
<body>
  <div class="no-print" style="text-align:right;margin-bottom:12px;">
    <button class="print-btn" onclick="window.print()">🖨️ In Biên Bản / Lưu PDF</button>
  </div>
  <div class="header">
    <div>
      <div style="font-size:12px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.08em;">DocReview Studio v2.0 — Chứng Nhận Kiểm Định & Niêm Phong SHA-256</div>
      <h1 style="margin:6px 0 8px;font-size:24px;">${escapeXml(doc.title)}</h1>
      <div style="color:#475569;font-size:14px;">Trạng thái hiện hành: <strong>${escapeXml(statusMap[doc.status] || doc.status)}</strong></div>
    </div>
    <div class="score-box">
      <div class="score-num">${q.overallScore}/100</div>
      <div style="font-weight:700;color:#1e40af;margin-top:4px;">Hạng ${escapeXml(q.grade)}</div>
    </div>
  </div>

  ${sealHtml}

  <div class="meta-grid">
    <div><strong>Chủ sở hữu tài liệu:</strong> ${escapeXml(doc.owner || '—')}</div>
    <div><strong>Bộ tiêu chuẩn đánh giá:</strong> ${escapeXml(q.profileName)}</div>
    <div><strong>Phiên bản mới nhất:</strong> ${escapeXml(doc.versions?.[doc.versions.length - 1]?.label || 'v1.0')}</div>
    <div><strong>Thời điểm xuất biên bản:</strong> ${escapeXml(new Date().toLocaleString('vi-VN'))}</div>
    <div><strong>Quy mô văn bản:</strong> ${q.stats.wordCount} từ • ${q.stats.paragraphCount} khối đoạn (~${q.stats.readingTimeMin} phút đọc)</div>
    <div><strong>Tình trạng rà soát:</strong> ${(doc.comments || []).filter((c) => c.status !== 'RESOLVED').length} bình luận mở • ${(doc.suggestions || []).filter((s) => s.status === 'PENDING').length} đề xuất chờ duyệt</div>
  </div>

  <h2>1. Điểm Thành Phần 5 Trục Chất Lượng</h2>
  <table>
    <thead>
      <tr>
        <th>Cấu trúc & Đầy đủ</th>
        <th>Độ rõ ràng & Định lượng</th>
        <th>Nhất quán & Thuật ngữ</th>
        <th>Khả năng Thực thi</th>
        <th>An toàn & Bảo mật</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>${q.axes.STRUCTURE}/100</strong></td>
        <td><strong>${q.axes.CLARITY}/100</strong></td>
        <td><strong>${q.axes.CONSISTENCY}/100</strong></td>
        <td><strong>${q.axes.ACTIONABILITY}/100</strong></td>
        <td><strong>${q.axes.SAFETY}/100</strong></td>
      </tr>
    </tbody>
  </table>

  <h2>2. Bảng Xác Nhận Phê Duyệt (Reviewer Sign-Offs)</h2>
  <table>
    <thead>
      <tr>
        <th>Người rà soát</th>
        <th>Vai trò</th>
        <th>Quyết định</th>
        <th>Ghi chú thẩm định</th>
        <th>Thời gian ký</th>
      </tr>
    </thead>
    <tbody>${approvalsRows}</tbody>
  </table>

  <h2>3. Kết Quả Kiểm Định Tự Động (${q.findings.length} mục)</h2>
  <table>
    <thead>
      <tr>
        <th>Mức độ</th>
        <th>Trục</th>
        <th>Chi tiết phát hiện</th>
        <th>Vị trí</th>
      </tr>
    </thead>
    <tbody>${findingsRows}</tbody>
  </table>
</body>
</html>`;
}

function sanitizeFileName(name, fallback = 'DocReview_Export') {
  const ascii = String(name || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return ascii || fallback;
}

function createAppServer(customDataFile = DEFAULT_DATA_FILE) {
  const store = new DocumentStore(customDataFile);
  const realtimeHub = new RealtimeHub();

  const notifyDocMutation = (req, docId, actor, summaryAction, docObj = null) => {
    const senderClientId = req.headers['x-client-id'] || null;
    realtimeHub.broadcast(
      'doc:updated',
      {
        docId,
        actor: actor || 'Reviewer',
        summaryAction,
        document: docObj || (docId ? store.getDocument(docId) : null),
        documents: store.listDocuments()
      },
      senderClientId
    );
  };

  const notifyGovernanceMutation = (req, summaryAction) => {
    const senderClientId = req.headers['x-client-id'] || null;
    realtimeHub.broadcast(
      'governance:updated',
      {
        summaryAction,
        governance: store.governanceStore.getState(),
        profiles: buildAllProfilesPayload(store.governanceStore.getState()),
        documents: store.listDocuments()
      },
      senderClientId
    );
  };

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Client-Id'
      });
      return res.end();
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    try {
      // 1. Health & Config
      if (pathname === '/api/health' && req.method === 'GET') {
        const allProfiles = buildAllProfilesPayload(store.governanceStore.getState());
        return sendJson(res, 200, {
          ok: true,
          service: 'DocReview Studio v3.0',
          version: '3.0.0',
          port: PORT,
          documentCount: store.documents.length,
          profilesCount: allProfiles.length,
          onlineReviewers: realtimeHub.clients.size,
          aiConfig: getEnvApiConfig()
        });
      }

      if (pathname === '/api/analytics' && req.method === 'GET') {
        return sendJson(res, 200, {
          ok: true,
          analytics: computeWorkspaceAnalytics(store)
        });
      }

      // 2. Realtime SSE Stream & Presence
      if (pathname === '/api/events' && req.method === 'GET') {
        const clientId = parsedUrl.searchParams.get('clientId') || `cli-${Date.now()}`;
        const author = parsedUrl.searchParams.get('author') || 'Reviewer';
        const role = parsedUrl.searchParams.get('role') || 'Reviewer';
        const docId = parsedUrl.searchParams.get('docId') || '';
        const mode = parsedUrl.searchParams.get('mode') || 'review';
        return realtimeHub.addClient({ clientId, author, role, docId, mode, res });
      }

      if (pathname === '/api/presence' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const presence = realtimeHub.updatePresence(body);
        return sendJson(res, 200, { ok: true, presence });
      }

      // 3. Profiles & Governance (Custom Rubrics + Glossary Enforcer)
      if (pathname === '/api/profiles' && req.method === 'GET') {
        return sendJson(res, 200, {
          ok: true,
          profiles: buildAllProfilesPayload(store.governanceStore.getState())
        });
      }

      if (pathname === '/api/governance' && req.method === 'GET') {
        const govState = store.governanceStore.getState();
        return sendJson(res, 200, {
          ok: true,
          governance: govState,
          profiles: buildAllProfilesPayload(govState)
        });
      }

      if (pathname === '/api/governance/profiles' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const saved = store.governanceStore.saveCustomProfile(body);
        const govState = store.governanceStore.getState();
        notifyGovernanceMutation(req, `Đã lưu bộ tiêu chí tùy chỉnh "${saved.name}"`);
        return sendJson(res, 201, {
          ok: true,
          profile: saved,
          governance: govState,
          profiles: buildAllProfilesPayload(govState),
          documents: store.listDocuments()
        });
      }

      const customProfDelMatch = pathname.match(/^\/api\/governance\/profiles\/([^/]+)$/);
      if (customProfDelMatch && req.method === 'DELETE') {
        const pid = decodeURIComponent(customProfDelMatch[1]);
        store.governanceStore.deleteCustomProfile(pid);
        const govState = store.governanceStore.getState();
        notifyGovernanceMutation(req, 'Đã xóa bộ tiêu chí tùy chỉnh');
        return sendJson(res, 200, {
          ok: true,
          governance: govState,
          profiles: buildAllProfilesPayload(govState),
          documents: store.listDocuments()
        });
      }

      if (pathname === '/api/governance/glossary' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const rule = store.governanceStore.addGlossaryRule(body);
        const govState = store.governanceStore.getState();
        notifyGovernanceMutation(req, `Thêm quy tắc thuật ngữ "${rule.wrongTerm}" ➔ "${rule.preferredTerm}"`);
        return sendJson(res, 201, {
          ok: true,
          rule,
          governance: govState,
          documents: store.listDocuments()
        });
      }

      const glossItemMatch = pathname.match(/^\/api\/governance\/glossary\/([^/]+)$/);
      if (glossItemMatch && req.method === 'PATCH') {
        const body = await readJsonBody(req);
        const rule = store.governanceStore.toggleGlossaryRule(
          decodeURIComponent(glossItemMatch[1]),
          body.enabled
        );
        const govState = store.governanceStore.getState();
        notifyGovernanceMutation(req, `Cập nhật quy tắc thuật ngữ "${rule.wrongTerm}"`);
        return sendJson(res, 200, { ok: true, rule, governance: govState, documents: store.listDocuments() });
      }

      if (glossItemMatch && req.method === 'DELETE') {
        store.governanceStore.deleteGlossaryRule(decodeURIComponent(glossItemMatch[1]));
        const govState = store.governanceStore.getState();
        notifyGovernanceMutation(req, 'Đã xóa quy tắc thuật ngữ');
        return sendJson(res, 200, { ok: true, governance: govState, documents: store.listDocuments() });
      }

      // 4. List & Create Documents
      if (pathname === '/api/documents' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true, documents: store.listDocuments() });
      }

      if (pathname === '/api/documents' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const doc = store.createDocument(body);
        notifyDocMutation(req, doc.id, body.owner, `Tạo mới tài liệu "${doc.title}"`, doc);
        return sendJson(res, 201, { ok: true, document: doc, documents: store.listDocuments() });
      }

      if (pathname === '/api/documents/reset-demo' && req.method === 'POST') {
        const documents = store.resetDemoWorkspace();
        notifyDocMutation(req, documents[0]?.id, 'System', 'Khôi phục 4 hồ sơ mẫu Demo');
        return sendJson(res, 200, { ok: true, documents });
      }

      // 5. Import .DOCX / .PDF / .MD / .TXT
      if (pathname === '/api/import-file' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const fileName = String(body.fileName || 'Tai_lieu.md');
        const base64Data = String(body.base64Data || '').replace(/^data:[^;]+;base64,/, '');
        if (!base64Data) {
          return sendJson(res, 400, { ok: false, error: 'Không nhận được dữ liệu tệp tải lên.' });
        }
        const buf = Buffer.from(base64Data, 'base64');
        const lower = fileName.toLowerCase();

        let markdown = '';
        let importedComments = [];

        if (lower.endsWith('.docx')) {
          const parsed = parseDocxBuffer(buf);
          markdown = parsed.markdown;
          importedComments = parsed.importedComments || [];
        } else if (lower.endsWith('.pdf')) {
          const parsedPdf = parsePdfBuffer(buf);
          markdown = parsedPdf.markdown;
        } else {
          markdown = buf.toString('utf8').replace(/^\uFEFF/, '');
        }

        if (!markdown.trim()) {
          return sendJson(res, 400, { ok: false, error: 'Tệp tải lên không có nội dung văn bản đọc được.' });
        }

        const inferredTitle =
          body.title ||
          (markdown.match(/^#\s+(.+)$/m)?.[1] || fileName.replace(/\.(docx|pdf|md|markdown|txt)$/i, '')).trim();

        const created = store.createDocument({
          title: inferredTitle,
          profileId: body.profileId || 'PRD_SPEC',
          content: markdown,
          owner: body.owner || 'Người tải tệp',
          importedComments
        });

        notifyDocMutation(req, created.id, body.owner, `Nhập tệp "${fileName}"`, created);

        return sendJson(res, 201, {
          ok: true,
          importedCommentsCount: importedComments.length,
          document: created,
          documents: store.listDocuments()
        });
      }

      // 6. Document-scoped routes (/api/documents/:id...)
      const docRouteMatch = pathname.match(/^\/api\/documents\/([^/]+)(?:\/(.*))?$/);
      if (docRouteMatch) {
        const docId = decodeURIComponent(docRouteMatch[1]);
        const subPath = docRouteMatch[2] || '';

        if (!subPath && req.method === 'GET') {
          const doc = store.getDocument(docId);
          if (!doc) return sendJson(res, 404, { ok: false, error: 'Không tìm thấy tài liệu.' });
          return sendJson(res, 200, { ok: true, document: doc });
        }

        if (!subPath && req.method === 'PUT') {
          const body = await readJsonBody(req);
          const doc = store.updateDocument(docId, body);
          notifyDocMutation(req, docId, body.actor, 'Cập nhật nội dung / cấu hình tài liệu', doc);
          return sendJson(res, 200, { ok: true, document: doc, documents: store.listDocuments() });
        }

        if (!subPath && req.method === 'DELETE') {
          store.deleteDocument(docId);
          notifyDocMutation(req, null, 'Reviewer', 'Xóa tài liệu khỏi kho');
          return sendJson(res, 200, { ok: true, documents: store.listDocuments() });
        }

        // Glossary Auto-Normalize 1-Click
        if (subPath === 'normalize-glossary' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const result = store.normalizeDocumentGlossary(docId, body);
          notifyDocMutation(
            req,
            docId,
            body.actor,
            `Chuẩn hóa tự động ${result.replacementsCount} thuật ngữ`,
            result.document
          );
          return sendJson(res, 200, { ok: true, ...result, documents: store.listDocuments() });
        }

        // Cryptographic Seal Verify & Restore
        if (subPath === 'verify-seal' && req.method === 'GET') {
          const doc = store.getDocument(docId);
          if (!doc) return sendJson(res, 404, { ok: false, error: 'Không tìm thấy tài liệu.' });
          return sendJson(res, 200, { ok: true, sealVerification: doc.sealVerification });
        }

        if (subPath === 'restore-seal' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const doc = store.restoreSealedContent(docId, body);
          notifyDocMutation(req, docId, body.actor, 'Khôi phục bản gốc Niêm phong SHA-256', doc);
          return sendJson(res, 200, { ok: true, document: doc, documents: store.listDocuments() });
        }

        // Reversible PII Vault (Redact & Restore)
        if (subPath === 'pii/redact' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const result = store.redactPiiToVault(docId, body);
          notifyDocMutation(
            req,
            docId,
            body.actor,
            `Ẩn ${result.redactedCount} thông tin nhạy cảm vào Két sắt PII`,
            result.document
          );
          return sendJson(res, 200, { ok: true, ...result, documents: store.listDocuments() });
        }

        if (subPath === 'pii/restore' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const result = store.restorePiiFromVault(docId, body);
          notifyDocMutation(
            req,
            docId,
            body.actor,
            `Khôi phục ${result.restoredCount} thông tin nhạy cảm từ Két sắt PII`,
            result.document
          );
          return sendJson(res, 200, { ok: true, ...result, documents: store.listDocuments() });
        }

        // Cross-App Ecosystem Bridges (ContractShield 4175 & OmniTrace OSINT 4090)
        if (subPath === 'bridge/contract-shield' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const doc = store.getDocument(docId);
          if (!doc) return sendJson(res, 404, { ok: false, error: 'Không tìm thấy tài liệu.' });

          const bridgeRes = await bridgeToContractShield(doc, Number(body.port || 4175));
          let importedCount = 0;

          if (bridgeRes.connected && bridgeRes.report && body.importFindings !== false) {
            for (const f of (bridgeRes.report.findings || []).slice(0, 5)) {
              store.addComment(docId, {
                author: 'ContractShield Bridge',
                role: 'Legal Auditor (Port 4175)',
                category: f.severity === 'CRITICAL' ? 'BLOCKER' : 'CLARITY',
                quote: f.matchedText || '',
                text: `[${f.legalBasis}] ${f.title}: ${f.explanation}`
              });
              importedCount++;
            }
          }

          const updatedDoc = store.getDocument(docId);
          if (importedCount > 0) {
            notifyDocMutation(
              req,
              docId,
              'ContractShield (4175)',
              `Đồng bộ ${importedCount} cảnh báo pháp lý từ ContractShield`,
              updatedDoc
            );
          }

          return sendJson(res, 200, {
            ok: true,
            bridge: bridgeRes,
            importedCount,
            document: updatedDoc,
            documents: store.listDocuments()
          });
        }

        if (subPath === 'bridge/omnitrace' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const doc = store.getDocument(docId);
          if (!doc) return sendJson(res, 404, { ok: false, error: 'Không tìm thấy tài liệu.' });

          const bridgeRes = await bridgeToOmniTrace(doc, Number(body.port || 4090));
          return sendJson(res, 200, {
            ok: true,
            bridge: bridgeRes
          });
        }

        // Comments
        if (subPath === 'comments' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const result = store.addComment(docId, body);
          notifyDocMutation(
            req,
            docId,
            body.author,
            `Thêm bình luận [${result.comment.category}]`,
            result.document
          );
          return sendJson(res, 201, { ok: true, ...result, documents: store.listDocuments() });
        }

        const commentReplyMatch = subPath.match(/^comments\/([^/]+)\/replies$/);
        if (commentReplyMatch && req.method === 'POST') {
          const body = await readJsonBody(req);
          const result = store.replyComment(docId, decodeURIComponent(commentReplyMatch[1]), body);
          notifyDocMutation(req, docId, body.author, 'Phản hồi trong luồng bình luận', result.document);
          return sendJson(res, 201, { ok: true, ...result });
        }

        const commentPatchMatch = subPath.match(/^comments\/([^/]+)$/);
        if (commentPatchMatch && req.method === 'PATCH') {
          const body = await readJsonBody(req);
          const doc = store.setCommentStatus(docId, decodeURIComponent(commentPatchMatch[1]), body);
          notifyDocMutation(req, docId, body.actor, `Đổi trạng thái bình luận ➔ ${body.status}`, doc);
          return sendJson(res, 200, { ok: true, document: doc, documents: store.listDocuments() });
        }

        // Track Changes (Suggestions)
        if (subPath === 'suggestions' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const result = store.addSuggestion(docId, body);
          notifyDocMutation(req, docId, body.author, 'Gửi đề xuất Track Change mới', result.document);
          return sendJson(res, 201, { ok: true, ...result, documents: store.listDocuments() });
        }

        if (subPath === 'suggestions/accept-all' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const result = store.acceptAllPendingSuggestions(docId, body);
          notifyDocMutation(
            req,
            docId,
            body.actor,
            `Duyệt hàng loạt ${result.appliedCount} Track Changes`,
            result.document
          );
          return sendJson(res, 200, { ok: true, ...result, documents: store.listDocuments() });
        }

        const sugDecideMatch = subPath.match(/^suggestions\/([^/]+)\/decide$/);
        if (sugDecideMatch && req.method === 'POST') {
          const body = await readJsonBody(req);
          const doc = store.decideSuggestion(docId, decodeURIComponent(sugDecideMatch[1]), body);
          notifyDocMutation(req, docId, body.actor, `Xử lý Track Change (${body.decision})`, doc);
          return sendJson(res, 200, { ok: true, document: doc, documents: store.listDocuments() });
        }

        // Versions & Diff (including SEALED_SNAPSHOT diff!)
        if (subPath === 'versions' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const result = store.createSnapshot(docId, body);
          notifyDocMutation(req, docId, body.author, `Lưu mốc "${result.version.label}"`, result.document);
          return sendJson(res, 201, { ok: true, ...result, documents: store.listDocuments() });
        }

        const verRestoreMatch = subPath.match(/^versions\/([^/]+)\/restore$/);
        if (verRestoreMatch && req.method === 'POST') {
          const body = await readJsonBody(req);
          const doc = store.restoreVersion(docId, decodeURIComponent(verRestoreMatch[1]), body);
          notifyDocMutation(req, docId, body.actor, 'Khôi phục phiên bản cũ', doc);
          return sendJson(res, 200, { ok: true, document: doc, documents: store.listDocuments() });
        }

        if (subPath === 'diff' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const doc = store.getDocument(docId);
          if (!doc) return sendJson(res, 404, { ok: false, error: 'Không tìm thấy tài liệu.' });

          const resolveVerContent = (verRef) => {
            if (!verRef || verRef === 'CURRENT') {
              return { label: 'Bản thảo hiện hành (Working Draft)', content: doc.content };
            }
            if (verRef === 'SEALED_SNAPSHOT' && doc.cryptographicSeal?.sealedContentSnapshot !== undefined) {
              return {
                label: `🔒 Bản gốc Niêm phong (${doc.cryptographicSeal.sealId})`,
                content: doc.cryptographicSeal.sealedContentSnapshot
              };
            }
            const found = (doc.versions || []).find((v) => v.id === verRef);
            if (!found) throw new Error(`Không tìm thấy mốc phiên bản ${verRef}.`);
            return { label: found.label, content: found.content };
          };

          const base = resolveVerContent(body.baseVersionId || doc.versions?.[0]?.id || 'CURRENT');
          const target = resolveVerContent(body.targetVersionId || 'CURRENT');
          const diff = compareVersions(base.content, target.content);

          return sendJson(res, 200, {
            ok: true,
            baseLabel: base.label,
            targetLabel: target.label,
            diff
          });
        }

        // Sign-off / Approval Gate + SHA-256 Seal
        if (subPath === 'signoff' && req.method === 'POST') {
          const body = await readJsonBody(req);
          try {
            const doc = store.submitSignOff(docId, body);
            notifyDocMutation(req, docId, body.reviewer, `Ký thẩm định: ${body.decision}`, doc);
            return sendJson(res, 200, { ok: true, document: doc, documents: store.listDocuments() });
          } catch (err) {
            if (err.code === 'GATE_BLOCKED') {
              return sendJson(res, 409, { ok: false, code: 'GATE_BLOCKED', error: err.message, gate: err.gate });
            }
            throw err;
          }
        }

        // Optional AI Deep Review (có hỗ trợ Tự động che PII tạm thời trước khi gửi lên Cloud LLM!)
        if (subPath === 'ai-review' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const doc = store.getDocument(docId);
          if (!doc) return sendJson(res, 404, { ok: false, error: 'Không tìm thấy tài liệu.' });

          const maskBeforeAi = body.maskPiiBeforeAi !== false;
          let contentForAi = doc.content;
          let ephemeralVault = [];

          if (maskBeforeAi) {
            const shielded = redactDocumentPii(doc.content, 'TOKEN_VAULT', doc.piiVault || []);
            contentForAi = shielded.redactedText;
            ephemeralVault = shielded.vault;
          }

          const aiResult = await runAiDeepReview({
            title: doc.title,
            profileName: doc.qualityReport.profileName,
            content: contentForAi,
            provider: body.provider || 'auto',
            apiKey: body.apiKey || '',
            model: body.model || ''
          });

          const restoreIfNeeded = (txt) =>
            maskBeforeAi && ephemeralVault.length > 0
              ? restoreDocumentPii(txt, ephemeralVault).restoredText
              : txt;

          if (body.autoApplyToWorkspace !== false) {
            for (const c of aiResult.comments) {
              store.addComment(docId, {
                author: 'AI Reviewer',
                role: aiResult.modelLabel,
                category: c.category,
                quote: restoreIfNeeded(c.quote),
                text: restoreIfNeeded(c.text)
              });
            }
            for (const s of aiResult.suggestions) {
              try {
                store.addSuggestion(docId, {
                  author: 'AI Reviewer',
                  role: aiResult.modelLabel,
                  originalText: restoreIfNeeded(s.originalText),
                  suggestedText: restoreIfNeeded(s.suggestedText),
                  reason: s.reason
                });
              } catch {}
            }
          }

          const updatedDoc = store.getDocument(docId);
          notifyDocMutation(req, docId, 'AI Reviewer', 'Hoàn tất phân tích AI Deep Review', updatedDoc);

          return sendJson(res, 200, {
            ok: true,
            aiResult,
            document: updatedDoc,
            documents: store.listDocuments()
          });
        }

        // Export .DOCX
        if (subPath === 'export-docx' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const doc = store.getDocument(docId);
          if (!doc) return sendJson(res, 404, { ok: false, error: 'Không tìm thấy tài liệu.' });

          const docxBuf = buildDocxBuffer({
            title: doc.title,
            markdown: doc.content,
            comments: doc.comments || [],
            includeComments: body.includeComments !== false,
            includeCertificate: body.includeCertificate !== false,
            qualityReport: doc.qualityReport,
            approvals: doc.approvals || [],
            status: doc.status,
            versionLabel: doc.versions?.[doc.versions.length - 1]?.label || 'v1.0',
            sealVerification: doc.sealVerification
          });

          const safeName = sanitizeFileName(doc.title, 'DocReview_Document');
          res.writeHead(200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition': `attachment; filename="${safeName}.docx"`,
            'Content-Length': docxBuf.length
          });
          return res.end(docxBuf);
        }

        // Export Printable HTML Certificate
        if (subPath === 'export-certificate' && req.method === 'GET') {
          const doc = store.getDocument(docId);
          if (!doc) return sendJson(res, 404, { ok: false, error: 'Không tìm thấy tài liệu.' });
          const html = buildHtmlCertificate(doc);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(html);
        }
      }

      // Static Assets
      let filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname);
      const resolvedPath = path.resolve(filePath);
      if (!resolvedPath.startsWith(path.resolve(PUBLIC_DIR))) {
        res.writeHead(403);
        return res.end('Forbidden');
      }

      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
        const ext = path.extname(resolvedPath).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        return fs.createReadStream(resolvedPath).pipe(res);
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
    } catch (err) {
      sendJson(res, 400, { ok: false, error: err.message || 'Lỗi xử lý yêu cầu.' });
    }
  });

  server.on('close', () => {
    realtimeHub.closeAll();
  });

  return { server, store, realtimeHub };
}

if (require.main === module) {
  const { server } = createAppServer();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`📋✍️  DocReview Studio v3.0 đang hoạt động tại http://localhost:${PORT}`);
  });
}

module.exports = {
  createAppServer
};
