/**
 * 🗄️ DocReview Studio — Local Persistent Workspace Store & Workflow State Machine
 * Quản lý Tài liệu, Luồng Bình luận (Threads), Track Changes (Accept/Reject),
 * Snapshot Phiên bản, Cổng Kiểm soát Phê duyệt (Readiness Gate) & Nhật ký Kiểm toán
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createSampleDocuments } = require('./sample-docs');
const { evaluateDocument } = require('./quality-engine');
const { GovernanceStore } = require('./governance-store');
const { loadOrCreateSealSecret, createCryptographicSeal, verifyDocumentSeal } = require('./seal');
const { scanPiiEntities, redactDocumentPii, restoreDocumentPii } = require('./pii-vault');
const { analyzeReadabilityAndOutline } = require('./readability-engine');

class DocumentStore {
  constructor(dataFilePath, governanceStore = null) {
    this.dataFilePath = dataFilePath;
    const dir = path.dirname(dataFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.governanceStore =
      governanceStore || new GovernanceStore(path.join(dir, 'governance.json'));
    this.sealSecret = loadOrCreateSealSecret(dir);
    this.documents = this._loadOrSeed();
  }

  _evalDocQuality(doc) {
    return evaluateDocument(doc.content, doc.profileId, this.governanceStore.getState());
  }

  _loadOrSeed() {
    if (fs.existsSync(this.dataFilePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.dataFilePath, 'utf8'));
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch {
        // Fallback khởi tạo lại mẫu nếu file hỏng
      }
    }
    const seeded = createSampleDocuments();
    this._persist(seeded);
    return seeded;
  }

  _persist(docs = this.documents) {
    const tmpPath = `${this.dataFilePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(docs, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.dataFilePath);
  }

  _recordAudit(doc, actor, action) {
    if (!Array.isArray(doc.auditLog)) doc.auditLog = [];
    doc.auditLog.unshift({
      id: `ev-${crypto.randomUUID().slice(0, 8)}`,
      time: new Date().toISOString(),
      actor: actor || 'Reviewer',
      action
    });
    if (doc.auditLog.length > 80) doc.auditLog.length = 80;
    doc.updatedAt = new Date().toISOString();
  }

  computeReadinessGate(doc, precomputedQuality = null) {
    const quality = precomputedQuality || this._evalDocQuality(doc);
    const openComments = (doc.comments || []).filter((c) => c.status !== 'RESOLVED');
    const openBlockers = openComments.filter((c) => c.category === 'BLOCKER');
    const pendingSuggestions = (doc.suggestions || []).filter((s) => s.status === 'PENDING');
    const criticalFindings = quality.findings.filter((f) => f.severity === 'CRITICAL');

    const blockReasons = [];
    if (openBlockers.length > 0) {
      blockReasons.push(`Còn ${openBlockers.length} bình luận mức Chặn phê duyệt (BLOCKER) chưa giải quyết`);
    }
    if (pendingSuggestions.length > 0) {
      blockReasons.push(`Còn ${pendingSuggestions.length} đề xuất sửa đổi (Track Changes) đang chờ Chấp nhận/Từ chối`);
    }
    if (criticalFindings.length > 0) {
      blockReasons.push(`Còn ${criticalFindings.length} lỗi chất lượng nghiêm trọng (CRITICAL) từ bộ kiểm định tự động`);
    }

    return {
      canApproveCleanly: blockReasons.length === 0,
      openCommentsCount: openComments.length,
      openBlockersCount: openBlockers.length,
      pendingSuggestionsCount: pendingSuggestions.length,
      criticalFindingsCount: criticalFindings.length,
      overallScore: quality.overallScore,
      grade: quality.grade,
      blockReasons
    };
  }

  enrichDocument(doc) {
    const qualityReport = this._evalDocQuality(doc);
    const readinessGate = this.computeReadinessGate(doc, qualityReport);
    const sealVerification = verifyDocumentSeal(doc, this.sealSecret);
    const readability = analyzeReadabilityAndOutline(doc.content);
    const detectedPii = scanPiiEntities(doc.content);
    return {
      ...doc,
      piiVault: Array.isArray(doc.piiVault) ? doc.piiVault : [],
      detectedPii,
      readability,
      qualityReport,
      readinessGate,
      sealVerification
    };
  }

  listDocuments() {
    return this.documents.map((doc) => {
      const quality = this._evalDocQuality(doc);
      const sealCheck = verifyDocumentSeal(doc, this.sealSecret);
      const openComments = (doc.comments || []).filter((c) => c.status !== 'RESOLVED').length;
      const openBlockers = (doc.comments || []).filter((c) => c.status !== 'RESOLVED' && c.category === 'BLOCKER').length;
      const pendingSuggestions = (doc.suggestions || []).filter((s) => s.status === 'PENDING').length;

      return {
        id: doc.id,
        title: doc.title,
        profileId: doc.profileId,
        status: doc.status,
        sealStatus: sealCheck.status, // UNSEALED | VALID | TAMPERED
        owner: doc.owner,
        updatedAt: doc.updatedAt,
        versionCount: (doc.versions || []).length,
        latestVersionLabel: doc.versions?.[doc.versions.length - 1]?.label || 'v1.0',
        overallScore: quality.overallScore,
        grade: quality.grade,
        wordCount: quality.stats.wordCount,
        openComments,
        openBlockers,
        pendingSuggestions,
        findingsCount: quality.counts.total
      };
    });
  }

  getDocument(id) {
    const doc = this.documents.find((d) => d.id === id);
    if (!doc) return null;
    return this.enrichDocument(doc);
  }

  createDocument({ title, profileId = 'PRD_SPEC', content = '', owner = 'Tác giả Tài liệu', importedComments = [] }) {
    const cleanTitle = String(title || 'Tài liệu Rà soát Mới').trim();
    const now = new Date().toISOString();
    const docContent =
      String(content || '').trim() ||
      `# ${cleanTitle}\n\n## 1. Bối cảnh & Mục tiêu\nMô tả ngắn gọn bài toán và mục tiêu cần đạt được.\n\n## 2. Nội dung chi tiết\nTrình bày các yêu cầu hoặc bước thực hiện cụ thể tại đây.`;

    const newDoc = {
      id: `doc-${crypto.randomUUID().slice(0, 8)}`,
      title: cleanTitle,
      profileId,
      status: 'DRAFT',
      owner,
      updatedAt: now,
      content: docContent,
      versions: [
        {
          id: `ver-${crypto.randomUUID().slice(0, 6)}`,
          label: 'v1.0 — Khởi tạo tài liệu',
          author: owner,
          createdAt: now,
          note: 'Phiên bản gốc ban đầu.',
          content: docContent
        }
      ],
      comments: Array.isArray(importedComments)
        ? importedComments.map((c) => ({
            id: `cmt-${crypto.randomUUID().slice(0, 8)}`,
            author: c.author || 'Word Reviewer',
            role: c.role || 'Reviewer',
            category: c.category || 'CLARITY',
            status: 'OPEN',
            quote: c.quote || '',
            text: c.text || '',
            createdAt: c.createdAt || now,
            replies: []
          }))
        : [],
      suggestions: [],
      approvals: [],
      auditLog: [
        {
          id: `ev-${crypto.randomUUID().slice(0, 8)}`,
          time: now,
          actor: owner,
          action: `Khởi tạo tài liệu "${cleanTitle}"${importedComments.length ? ` (kèm ${importedComments.length} chú thích gốc từ Word)` : ''}`
        }
      ]
    };

    this.documents.unshift(newDoc);
    this._persist();
    return this.enrichDocument(newDoc);
  }

  updateDocument(id, { title, profileId, content, status, actor = 'Tác giả' }) {
    const doc = this.documents.find((d) => d.id === id);
    if (!doc) throw new Error('Không tìm thấy tài liệu.');

    const changes = [];
    if (title !== undefined && String(title).trim() && String(title).trim() !== doc.title) {
      doc.title = String(title).trim();
      changes.push('đổi tiêu đề');
    }
    if (profileId !== undefined && profileId !== doc.profileId) {
      doc.profileId = profileId;
      changes.push(`chuyển bộ tiêu chí sang ${profileId}`);
    }
    if (content !== undefined && content !== doc.content) {
      doc.content = String(content);
      changes.push('cập nhật nội dung bản thảo');
    }
    if (status !== undefined && status !== doc.status) {
      doc.status = status;
      changes.push(`đổi trạng thái sang ${status}`);
    }

    if (changes.length > 0) {
      this._recordAudit(doc, actor, `Đã ${changes.join(', ')}`);
      this._persist();
    }
    return this.enrichDocument(doc);
  }

  deleteDocument(id) {
    const idx = this.documents.findIndex((d) => d.id === id);
    if (idx === -1) throw new Error('Không tìm thấy tài liệu cần xóa.');
    this.documents.splice(idx, 1);
    this._persist();
    return true;
  }

  resetDemoWorkspace() {
    this.documents = createSampleDocuments();
    this._persist();
    return this.listDocuments();
  }

  // ==========================================================================
  // BÌNH LUẬN NỘI TUYẾN (INLINE COMMENTS & REPLIES)
  // ==========================================================================

  addComment(docId, { author = 'Reviewer', role = 'Reviewer', category = 'CLARITY', quote = '', text }) {
    const doc = this.documents.find((d) => d.id === docId);
    if (!doc) throw new Error('Không tìm thấy tài liệu.');
    const cleanText = String(text || '').trim();
    if (!cleanText) throw new Error('Nội dung bình luận không được để trống.');

    const comment = {
      id: `cmt-${crypto.randomUUID().slice(0, 8)}`,
      author: String(author).trim(),
      role: String(role).trim(),
      category: ['BLOCKER', 'CLARITY', 'QUESTION', 'NITPICK', 'PRAISE'].includes(category) ? category : 'CLARITY',
      status: 'OPEN',
      quote: String(quote || '').trim(),
      text: cleanText,
      createdAt: new Date().toISOString(),
      replies: []
    };

    doc.comments.unshift(comment);
    if (doc.status === 'DRAFT') {
      doc.status = 'IN_REVIEW';
    }
    this._recordAudit(doc, comment.author, `Thêm bình luận [${comment.category}]${comment.quote ? ` tại "${comment.quote.slice(0, 38)}..."` : ''}`);
    this._persist();
    return { comment, document: this.enrichDocument(doc) };
  }

  replyComment(docId, commentId, { author = 'Reviewer', role = 'Reviewer', text }) {
    const doc = this.documents.find((d) => d.id === docId);
    if (!doc) throw new Error('Không tìm thấy tài liệu.');
    const comment = (doc.comments || []).find((c) => c.id === commentId);
    if (!comment) throw new Error('Không tìm thấy luồng bình luận.');
    const cleanText = String(text || '').trim();
    if (!cleanText) throw new Error('Nội dung phản hồi không được để trống.');

    if (!Array.isArray(comment.replies)) comment.replies = [];
    const reply = {
      id: `rep-${crypto.randomUUID().slice(0, 8)}`,
      author: String(author).trim(),
      role: String(role).trim(),
      text: cleanText,
      createdAt: new Date().toISOString()
    };
    comment.replies.push(reply);
    this._recordAudit(doc, reply.author, `Phản hồi trong luồng bình luận của ${comment.author}`);
    this._persist();
    return { reply, document: this.enrichDocument(doc) };
  }

  setCommentStatus(docId, commentId, { status, actor = 'Reviewer' }) {
    const doc = this.documents.find((d) => d.id === docId);
    if (!doc) throw new Error('Không tìm thấy tài liệu.');
    const comment = (doc.comments || []).find((c) => c.id === commentId);
    if (!comment) throw new Error('Không tìm thấy bình luận.');

    comment.status = status === 'RESOLVED' ? 'RESOLVED' : 'OPEN';
    comment.resolvedAt = comment.status === 'RESOLVED' ? new Date().toISOString() : null;
    comment.resolvedBy = comment.status === 'RESOLVED' ? actor : null;

    this._recordAudit(
      doc,
      actor,
      comment.status === 'RESOLVED'
        ? `Đánh dấu Đã giải quyết (Resolved) bình luận của ${comment.author}`
        : `Mở lại (Reopened) bình luận của ${comment.author}`
    );
    this._persist();
    return this.enrichDocument(doc);
  }

  // ==========================================================================
  // ĐỀ XUẤT SỬA ĐỔI — TRACK CHANGES (SUGGEST / ACCEPT / REJECT)
  // ==========================================================================

  addSuggestion(docId, { author = 'Reviewer', role = 'Reviewer', originalText, suggestedText, reason = '' }) {
    const doc = this.documents.find((d) => d.id === docId);
    if (!doc) throw new Error('Không tìm thấy tài liệu.');
    const orig = String(originalText || '').trim();
    const proposed = String(suggestedText ?? '').trim();

    if (!orig) throw new Error('Cần chọn đoạn văn bản gốc trong tài liệu để tạo đề xuất sửa (Track Change).');
    if (orig === proposed) throw new Error('Nội dung đề xuất mới trùng hệt văn bản gốc.');
    if (!doc.content.includes(orig)) {
      throw new Error('Đoạn văn bản gốc không khớp chính xác với nội dung hiện tại của tài liệu.');
    }

    const suggestion = {
      id: `sug-${crypto.randomUUID().slice(0, 8)}`,
      author: String(author).trim(),
      role: String(role).trim(),
      status: 'PENDING',
      originalText: orig,
      suggestedText: proposed,
      reason: String(reason || '').trim(),
      createdAt: new Date().toISOString()
    };

    doc.suggestions.unshift(suggestion);
    if (doc.status === 'DRAFT') {
      doc.status = 'IN_REVIEW';
    }
    this._recordAudit(doc, suggestion.author, `Gửi đề xuất sửa (Track Change): "${orig.slice(0, 36)}..."`);
    this._persist();
    return { suggestion, document: this.enrichDocument(doc) };
  }

  decideSuggestion(docId, suggestionId, { decision, actor = 'Tác giả' }) {
    const doc = this.documents.find((d) => d.id === docId);
    if (!doc) throw new Error('Không tìm thấy tài liệu.');
    const sug = (doc.suggestions || []).find((s) => s.id === suggestionId);
    if (!sug) throw new Error('Không tìm thấy đề xuất sửa đổi.');
    if (sug.status !== 'PENDING') {
      throw new Error(`Đề xuất này đã được xử lý trước đó (${sug.status}).`);
    }

    if (decision === 'ACCEPT') {
      const idx = doc.content.indexOf(sug.originalText);
      if (idx === -1) {
        throw new Error(
          'Không thể tự động áp dụng vì đoạn văn bản gốc đã bị chỉnh sửa khác đi. Hãy từ chối đề xuất này và sửa trực tiếp trong trình soạn thảo.'
        );
      }
      doc.content =
        doc.content.slice(0, idx) + sug.suggestedText + doc.content.slice(idx + sug.originalText.length);
      sug.status = 'ACCEPTED';
      sug.decidedAt = new Date().toISOString();
      sug.decidedBy = actor;

      // Tự động đóng bình luận BLOCKER/CLARITY neo đúng cùng câu nếu muốn? Giữ mở để người review xác nhận, nhưng ghi rõ nhật ký!
      this._recordAudit(doc, actor, `Chấp nhận (Accepted) đề xuất sửa của ${sug.author} và cập nhật văn bản`);
    } else if (decision === 'REJECT') {
      sug.status = 'REJECTED';
      sug.decidedAt = new Date().toISOString();
      sug.decidedBy = actor;
      this._recordAudit(doc, actor, `Từ chối (Rejected) đề xuất sửa của ${sug.author}`);
    } else {
      throw new Error('Quyết định không hợp lệ (chỉ nhận ACCEPT hoặc REJECT).');
    }

    this._persist();
    return this.enrichDocument(doc);
  }

  acceptAllPendingSuggestions(docId, { actor = 'Tác giả' }) {
    const doc = this.documents.find((d) => d.id === docId);
    if (!doc) throw new Error('Không tìm thấy tài liệu.');

    let appliedCount = 0;
    let skippedCount = 0;

    for (const sug of doc.suggestions || []) {
      if (sug.status !== 'PENDING') continue;
      const idx = doc.content.indexOf(sug.originalText);
      if (idx !== -1) {
        doc.content =
          doc.content.slice(0, idx) + sug.suggestedText + doc.content.slice(idx + sug.originalText.length);
        sug.status = 'ACCEPTED';
        sug.decidedAt = new Date().toISOString();
        sug.decidedBy = actor;
        appliedCount++;
      } else {
        skippedCount++;
      }
    }

    if (appliedCount > 0) {
      this._recordAudit(doc, actor, `Chấp nhận hàng loạt ${appliedCount} đề xuất Track Changes`);
      this._persist();
    }

    return {
      appliedCount,
      skippedCount,
      document: this.enrichDocument(doc)
    };
  }

  // ==========================================================================
  // QUẢN LÝ PHIÊN BẢN (SNAPSHOTS & RESTORE)
  // ==========================================================================

  createSnapshot(docId, { label, author = 'Tác giả', note = '' }) {
    const doc = this.documents.find((d) => d.id === docId);
    if (!doc) throw new Error('Không tìm thấy tài liệu.');

    const nextNum = (doc.versions?.length || 0) + 1;
    const snapLabel = String(label || `v1.${nextNum - 1} — Bản lưu mốc rà soát`).trim();
    const version = {
      id: `ver-${crypto.randomUUID().slice(0, 8)}`,
      label: snapLabel,
      author: String(author).trim(),
      createdAt: new Date().toISOString(),
      note: String(note || 'Lưu mốc phiên bản thủ công.').trim(),
      content: doc.content
    };

    if (!Array.isArray(doc.versions)) doc.versions = [];
    doc.versions.push(version);
    this._recordAudit(doc, version.author, `Đóng gói mốc phiên bản mới: "${version.label}"`);
    this._persist();
    return { version, document: this.enrichDocument(doc) };
  }

  restoreVersion(docId, versionId, { actor = 'Tác giả' }) {
    const doc = this.documents.find((d) => d.id === docId);
    if (!doc) throw new Error('Không tìm thấy tài liệu.');
    const ver = (doc.versions || []).find((v) => v.id === versionId);
    if (!ver) throw new Error('Không tìm thấy phiên bản cần khôi phục.');

    doc.content = ver.content;
    this._recordAudit(doc, actor, `Khôi phục nội dung tài liệu về mốc "${ver.label}"`);
    this._persist();
    return this.enrichDocument(doc);
  }

  // ==========================================================================
  // LUỒNG PHÊ DUYỆT & CỔNG NGHIỆM THU (SIGN-OFF & READINESS GATE)
  // ==========================================================================

  submitSignOff(docId, { reviewer, role = 'Approver', decision, note = '', forceOverride = false }) {
    const doc = this.documents.find((d) => d.id === docId);
    if (!doc) throw new Error('Không tìm thấy tài liệu.');
    const cleanReviewer = String(reviewer || '').trim();
    if (!cleanReviewer) throw new Error('Vui lòng nhập tên người phê duyệt.');

    if (!['APPROVED', 'CHANGES_REQUESTED', 'IN_REVIEW'].includes(decision)) {
      throw new Error('Quyết định phê duyệt không hợp lệ.');
    }

    const gate = this.computeReadinessGate(doc);
    if (decision === 'APPROVED' && !gate.canApproveCleanly && !forceOverride) {
      const err = new Error(
        `Chưa đủ điều kiện phê duyệt sạch: ${gate.blockReasons.join(' • ')}. Hãy xử lý triệt để hoặc tích chọn "Phê duyệt ngoại lệ có ghi chú" nếu cần bỏ qua.`
      );
      err.code = 'GATE_BLOCKED';
      err.gate = gate;
      throw err;
    }

    if (!Array.isArray(doc.approvals)) doc.approvals = [];
    const existingIdx = doc.approvals.findIndex(
      (a) => a.reviewer.toLowerCase() === cleanReviewer.toLowerCase()
    );

    const entry = {
      id: existingIdx !== -1 ? doc.approvals[existingIdx].id : `app-${crypto.randomUUID().slice(0, 8)}`,
      reviewer: cleanReviewer,
      role: String(role || 'Reviewer').trim(),
      decision,
      note: String(note || '').trim(),
      overriddenGate: Boolean(decision === 'APPROVED' && !gate.canApproveCleanly && forceOverride),
      decidedAt: new Date().toISOString()
    };

    if (existingIdx !== -1) {
      doc.approvals[existingIdx] = entry;
    } else {
      doc.approvals.push(entry);
    }

    // Cập nhật trạng thái tổng của tài liệu & Cấp con dấu Niêm phong SHA-256 khi đạt APPROVED
    if (decision === 'CHANGES_REQUESTED') {
      doc.status = 'CHANGES_REQUESTED';
    } else if (decision === 'APPROVED') {
      const anyRejected = doc.approvals.some((a) => a.decision === 'CHANGES_REQUESTED');
      doc.status = anyRejected ? 'CHANGES_REQUESTED' : 'APPROVED';
    } else {
      doc.status = 'IN_REVIEW';
    }

    let sealMsg = '';
    if (doc.status === 'APPROVED') {
      doc.cryptographicSeal = createCryptographicSeal(doc, cleanReviewer, this.sealSecret);
      sealMsg = ` • 🔒 Đã cấp dấu Niêm phong SHA-256 (${doc.cryptographicSeal.sealId})`;
    }

    this._recordAudit(
      doc,
      cleanReviewer,
      `Ký quyết định ${decision}${entry.overriddenGate ? ' (Phê duyệt ngoại lệ)' : ''}${
        entry.note ? `: "${entry.note.slice(0, 60)}"` : ''
      }${sealMsg}`
    );
    this._persist();
    return this.enrichDocument(doc);
  }

  restoreSealedContent(docId, { actor = 'Auditor' }) {
    const doc = this.documents.find((d) => d.id === docId);
    if (!doc) throw new Error('Không tìm thấy tài liệu.');
    if (!doc.cryptographicSeal || typeof doc.cryptographicSeal.sealedContentSnapshot !== 'string') {
      throw new Error('Tài liệu này chưa có bản lưu Niêm phong SHA-256 để khôi phục.');
    }

    doc.content = doc.cryptographicSeal.sealedContentSnapshot;
    doc.status = 'APPROVED';
    this._recordAudit(
      doc,
      actor,
      `⏪ Khôi phục nguyên trạng nội dung về bản Đã Niêm Phong SHA-256 (${doc.cryptographicSeal.sealId})`
    );
    this._persist();
    return this.enrichDocument(doc);
  }

  normalizeDocumentGlossary(docId, { actor = 'Tác giả' }) {
    const doc = this.documents.find((d) => d.id === docId);
    if (!doc) throw new Error('Không tìm thấy tài liệu.');
    const result = this.governanceStore.applyGlossaryNormalization(doc.content);
    if (result.replacementsCount > 0) {
      doc.content = result.content;
      this._recordAudit(
        doc,
        actor,
        `✨ Tự động chuẩn hóa ${result.replacementsCount} thuật ngữ theo Từ điển Quy ước (Glossary Enforcer)`
      );
      this._persist();
    }
    return {
      replacementsCount: result.replacementsCount,
      document: this.enrichDocument(doc)
    };
  }

  redactPiiToVault(docId, { mode = 'TOKEN_VAULT', actor = 'Security Officer' }) {
    const doc = this.documents.find((d) => d.id === docId);
    if (!doc) throw new Error('Không tìm thấy tài liệu.');
    const res = redactDocumentPii(doc.content, mode, doc.piiVault || []);
    if (res.redactedCount > 0) {
      doc.content = res.redactedText;
      doc.piiVault = res.vault;
      this._recordAudit(
        doc,
        actor,
        `🕵️ Đã ẩn ${res.redactedCount} thông tin nhạy cảm (PII) vào Két sắt Ánh xạ (${mode})`
      );
      this._persist();
    }
    return {
      redactedCount: res.redactedCount,
      document: this.enrichDocument(doc)
    };
  }

  restorePiiFromVault(docId, { actor = 'Security Officer' }) {
    const doc = this.documents.find((d) => d.id === docId);
    if (!doc) throw new Error('Không tìm thấy tài liệu.');
    const res = restoreDocumentPii(doc.content, doc.piiVault || []);
    if (res.restoredCount > 0) {
      doc.content = res.restoredText;
      this._recordAudit(
        doc,
        actor,
        `🔓 Đã khôi phục nguyên bản ${res.restoredCount} thông tin nhạy cảm từ Két sắt PII`
      );
      this._persist();
    }
    return {
      restoredCount: res.restoredCount,
      document: this.enrichDocument(doc)
    };
  }
}

module.exports = {
  DocumentStore
};
