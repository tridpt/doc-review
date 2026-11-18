/**
 * 🕵️‍♂️ DocReview Studio v3.0 — Reversible PII Redaction Vault (Két Sắt Ẩn & Khôi Phục Dữ Liệu Nhạy Cảm)
 * Tự động phát hiện CCCD, SĐT, Email, Số tài khoản, Mã số thuế, IP nội bộ & API Secret;
 * thay bằng thẻ định danh [PII_TYPE_XX] lưu trong Két sắt cục bộ để khôi phục nguyên bản 100% bất kỳ lúc nào.
 */

const PII_PATTERNS = [
  {
    type: 'SECRET',
    label: 'Khóa API / Token bí mật',
    regex: /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{25,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{15,})\b/g
  },
  {
    type: 'EMAIL',
    label: 'Địa chỉ Email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
  },
  {
    type: 'CCCD',
    label: 'Số Căn cước công dân (12 số)',
    regex: /\b0\d{11}\b/g
  },
  {
    type: 'PHONE',
    label: 'Số điện thoại Việt Nam',
    regex: /\b(?:\+84|0)(?:3|5|7|8|9)\d{8}\b/g
  },
  {
    type: 'MST',
    label: 'Mã số thuế doanh nghiệp',
    regex: /(?<=(?:Mã số thuế|MST)\s*[:=-]?\s*)\b\d{10}(?:-\d{3})?\b/gi
  },
  {
    type: 'BANK',
    label: 'Số tài khoản ngân hàng',
    regex: /(?<=(?:Số tài khoản|STK)\s*[^:\n]{0,20}:\s*)\b\d{8,16}\b/gi
  },
  {
    type: 'INTERNAL_IP',
    label: 'Địa chỉ IP mạng nội bộ',
    regex: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g
  }
];

function maskPartial(val, type) {
  const s = String(val);
  if (type === 'EMAIL' && s.includes('@')) {
    const [u, d] = s.split('@');
    return `${u.slice(0, 2)}***@${d}`;
  }
  if (s.length <= 6) return '***';
  return `${s.slice(0, 3)}***${s.slice(-3)}`;
}

function scanPiiEntities(text) {
  const src = String(text || '');
  const detected = [];
  const seenValues = new Set();

  for (const rule of PII_PATTERNS) {
    const re = new RegExp(rule.regex.source, rule.regex.flags);
    let m;
    while ((m = re.exec(src)) !== null) {
      const val = m[0];
      if (seenValues.has(`${rule.type}:${val}`)) continue;
      seenValues.add(`${rule.type}:${val}`);
      detected.push({
        type: rule.type,
        label: rule.label,
        value: val,
        maskedPreview: maskPartial(val, rule.type)
      });
    }
  }
  return detected;
}

/**
 * Ẩn dữ liệu nhạy cảm trong văn bản và cập nhật Két sắt ánh xạ (existingVault)
 */
function redactDocumentPii(text, mode = 'TOKEN_VAULT', existingVault = []) {
  let working = String(text || '');
  const vault = Array.isArray(existingVault) ? [...existingVault] : [];
  const typeCounters = {};

  for (const item of vault) {
    const m = item.token?.match(/^\[PII_([A-Z_]+)_(\d+)\]$/);
    if (m) {
      typeCounters[m[1]] = Math.max(typeCounters[m[1]] || 0, Number(m[2]));
    }
  }

  let redactedCount = 0;

  for (const rule of PII_PATTERNS) {
    const re = new RegExp(rule.regex.source, rule.regex.flags);
    const matches = [...new Set(working.match(re) || [])];

    for (const rawVal of matches) {
      if (mode === 'PARTIAL_MASK') {
        const masked = maskPartial(rawVal, rule.type);
        working = working.split(rawVal).join(masked);
        redactedCount++;
      } else {
        // Kiểm tra xem giá trị này đã có token trong vault chưa
        let existingEntry = vault.find((v) => v.originalValue === rawVal && v.type === rule.type);
        if (!existingEntry) {
          const nextIdx = (typeCounters[rule.type] || 0) + 1;
          typeCounters[rule.type] = nextIdx;
          const token = `[PII_${rule.type}_${String(nextIdx).padStart(2, '0')}]`;
          existingEntry = {
            token,
            type: rule.type,
            label: rule.label,
            maskedPreview: maskPartial(rawVal, rule.type),
            originalValue: rawVal,
            redactedAt: new Date().toISOString()
          };
          vault.push(existingEntry);
        }
        working = working.split(rawVal).join(existingEntry.token);
        redactedCount++;
      }
    }
  }

  return {
    redactedText: working,
    redactedCount,
    vault
  };
}

/**
 * Khôi phục dữ liệu gốc từ Két sắt Ánh xạ (vault)
 */
function restoreDocumentPii(text, vault = []) {
  let working = String(text || '');
  let restoredCount = 0;
  for (const entry of vault) {
    if (entry && entry.token && entry.originalValue && working.includes(entry.token)) {
      working = working.split(entry.token).join(entry.originalValue);
      restoredCount++;
    }
  }
  return {
    restoredText: working,
    restoredCount
  };
}

module.exports = {
  scanPiiEntities,
  redactDocumentPii,
  restoreDocumentPii
};
