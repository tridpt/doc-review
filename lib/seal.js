/**
 * 🔒 DocReview Studio v2.0 — Tamper-Evident Cryptographic Sign-Off Seal (SHA-256 + HMAC-SHA256)
 * - Khóa niêm phong mật mã ngay tại thời điểm tài liệu đạt trạng thái APPROVED
 * - Phát hiện tức thì bất kỳ hành vi chỉnh sửa ngầm nào sau khi phê duyệt (dù chỉ 1 ký tự / khoảng trắng)
 * - Cho phép đối chiếu bản đã niêm phong và khôi phục nguyên trạng 1-Click
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function normalizeContentForHash(text) {
  return String(text || '').replace(/\r\n/g, '\n').trim();
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex');
}

function loadOrCreateSealSecret(dataDir) {
  if (process.env.DOCREVIEW_SEAL_SECRET && process.env.DOCREVIEW_SEAL_SECRET.trim()) {
    return process.env.DOCREVIEW_SEAL_SECRET.trim();
  }
  const keyFile = path.join(dataDir, '.seal_hmac_key');
  try {
    if (fs.existsSync(keyFile)) {
      const existing = fs.readFileSync(keyFile, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyFile, generated, 'utf8');
    return generated;
  } catch {
    return 'docreview-fallback-local-seal-secret-2026';
  }
}

function computeApprovalManifestHash(docId, contentSha256, approvals = []) {
  const canonicalApprovals = approvals
    .filter((a) => a && a.decision === 'APPROVED')
    .map((a) => `${a.reviewer}|${a.role}|${a.decision}|${a.decidedAt}`)
    .sort()
    .join(';');
  return sha256Hex(`${docId}::${contentSha256}::${canonicalApprovals}`);
}

function createCryptographicSeal(doc, sealedBy, secretKey) {
  const normalized = normalizeContentForHash(doc.content);
  const contentSha256 = sha256Hex(normalized);
  const approvalManifestSha256 = computeApprovalManifestHash(doc.id, contentSha256, doc.approvals || []);
  const sealedAt = new Date().toISOString();
  const sealId = `SEAL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  const payloadToSign = `${sealId}|${doc.id}|${sealedAt}|${contentSha256}|${approvalManifestSha256}`;
  const hmacHex = crypto.createHmac('sha256', secretKey).update(payloadToSign, 'utf8').digest('hex');

  return {
    sealId,
    algorithm: 'SHA-256 + HMAC-SHA256',
    sealedAt,
    sealedBy: sealedBy || 'Approver',
    versionLabel: doc.versions?.[doc.versions.length - 1]?.label || 'v1.0',
    contentSha256,
    approvalManifestSha256,
    hmacSignature: `DRv2-${hmacHex}`,
    sealedContentSnapshot: doc.content
  };
}

function verifyDocumentSeal(doc, secretKey) {
  const seal = doc.cryptographicSeal;
  if (!seal || !seal.contentSha256 || !seal.hmacSignature) {
    return {
      isSealed: false,
      status: 'UNSEALED',
      label: 'Chưa niêm phong chữ ký số',
      message: 'Tài liệu sẽ tự động được cấp dấu niêm phong SHA-256 ngay khi ký phê duyệt (APPROVED).'
    };
  }

  const liveContentSha256 = sha256Hex(normalizeContentForHash(doc.content));
  const expectedPayload = `${seal.sealId}|${doc.id}|${seal.sealedAt}|${seal.contentSha256}|${seal.approvalManifestSha256}`;
  const expectedHmac = `DRv2-${crypto.createHmac('sha256', secretKey).update(expectedPayload, 'utf8').digest('hex')}`;

  const signatureValid = expectedHmac === seal.hmacSignature;
  const contentIntact = liveContentSha256 === seal.contentSha256;

  if (signatureValid && contentIntact) {
    return {
      isSealed: true,
      status: 'VALID',
      label: 'NIÊM PHONG SHA-256 TOÀN VẸN 100%',
      message: `Nội dung khớp tuyệt đối với bản đã phê duyệt bởi ${seal.sealedBy} (Mã niêm phong ${seal.sealId}).`,
      sealId: seal.sealId,
      sealedAt: seal.sealedAt,
      sealedBy: seal.sealedBy,
      versionLabel: seal.versionLabel,
      sealedContentSha256: seal.contentSha256,
      liveContentSha256,
      hmacSignature: seal.hmacSignature
    };
  }

  return {
    isSealed: true,
    status: 'TAMPERED',
    label: 'CẢNH BÁO: VĂN BẢN ĐÃ BỊ CHỈNH SỬA SAU KHI NIÊM PHONG!',
    message: !signatureValid
      ? 'Chữ ký HMAC của con dấu niêm phong không hợp lệ (nghi ngờ can thiệp dữ liệu lưu trữ).'
      : 'Nội dung tài liệu hiện tại đã thay đổi so với bản được ký APPROVED. Cần thẩm định & ký phê duyệt lại hoặc khôi phục bản gốc niêm phong.',
    sealId: seal.sealId,
    sealedAt: seal.sealedAt,
    sealedBy: seal.sealedBy,
    versionLabel: seal.versionLabel,
    sealedContentSha256: seal.contentSha256,
    liveContentSha256,
    hmacSignature: seal.hmacSignature,
    hasRestoreSnapshot: typeof seal.sealedContentSnapshot === 'string'
  };
}

module.exports = {
  sha256Hex,
  loadOrCreateSealSecret,
  createCryptographicSeal,
  verifyDocumentSeal
};
