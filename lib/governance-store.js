/**
 * 🛠️ DocReview Studio v2.0 — Custom Rubric Builder & Terminology Glossary Store
 * - Quản lý các Bộ tiêu chí chấm điểm tùy chỉnh (Custom Rubrics) của tổ chức
 * - Quản lý Từ điển Thuật ngữ bắt buộc (Glossary Enforcer: tự động phát hiện từ viết sai quy ước & sửa hàng loạt)
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createDefaultGovernance() {
  return {
    customProfiles: [
      {
        id: 'CUSTOM_BANKING_API',
        name: 'Đặc Tả Tích Hợp API Tài Chính / Ngân Hàng',
        icon: '🏦',
        isCustom: true,
        description:
          'Bộ tiêu chuẩn nội bộ dành cho tích hợp cổng thanh toán & Open Banking: bắt buộc có xác thực chữ ký số, chống phát lại gói tin (Idempotency) và đối soát T+1.',
        requiredSections: [
          {
            id: 'csec-auth',
            label: 'Xác thực & Chữ ký số (mTLS / HMAC / JWS)',
            keywords: ['xác thực', 'chữ ký', 'hmac', 'mtls', 'oauth', 'jws', 'signature']
          },
          {
            id: 'csec-idem',
            label: 'Cơ chế Chống trùng giao dịch (Idempotency)',
            keywords: ['idempotent', 'idempotency', 'chống trùng', 'trùng gói tin', 'duplicate']
          },
          {
            id: 'csec-recon',
            label: 'Đối soát & Xử lý lệch giao dịch (Reconciliation)',
            keywords: ['đối soát', 'reconciliation', 'tra soát', 'hoàn tiền', 'T+1']
          },
          {
            id: 'csec-err',
            label: 'Bảng Mã lỗi & Kịch bản Timeout',
            keywords: ['mã lỗi', 'error code', 'timeout', 'retry']
          }
        ],
        forbiddenPhrases: ['không cần đối soát', 'bỏ qua chữ ký']
      }
    ],
    glossaryRules: [
      {
        id: 'gl-smartpay',
        wrongTerm: 'Smartpay',
        preferredTerm: 'SmartPay',
        caseSensitive: true,
        enabled: true,
        note: 'Tên thương hiệu sản phẩm phải viết hoa chữ P (SmartPay).'
      },
      {
        id: 'gl-cccd',
        wrongTerm: 'CMND',
        preferredTerm: 'Căn cước (CCCD)',
        caseSensitive: false,
        enabled: true,
        note: 'Thống nhất dùng thuật ngữ Căn cước / CCCD theo Luật Căn cước hiện hành.'
      },
      {
        id: 'gl-enduser',
        wrongTerm: 'user cuối',
        preferredTerm: 'người dùng cuối',
        caseSensitive: false,
        enabled: true,
        note: 'Tránh pha trộn nửa Anh nửa Việt trong văn bản chính thức.'
      },
      {
        id: 'gl-restapi',
        wrongTerm: 'Restful api',
        preferredTerm: 'RESTful API',
        caseSensitive: true,
        enabled: true,
        note: 'Chuẩn hóa chữ viết hoa thuật ngữ kỹ thuật RESTful API.'
      },
      {
        id: 'gl-vnd',
        wrongTerm: 'vnd',
        preferredTerm: 'VNĐ',
        caseSensitive: true,
        enabled: true,
        note: 'Đơn vị tiền tệ viết hoa chuẩn VNĐ.'
      }
    ]
  };
}

class GovernanceStore {
  constructor(filePath) {
    this.filePath = filePath;
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.state = this._loadOrSeed();
  }

  _loadOrSeed() {
    if (fs.existsSync(this.filePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        if (parsed && Array.isArray(parsed.customProfiles) && Array.isArray(parsed.glossaryRules)) {
          return parsed;
        }
      } catch {
        // Fallback
      }
    }
    const seeded = createDefaultGovernance();
    this._persist(seeded);
    return seeded;
  }

  _persist(data = this.state) {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  getState() {
    return this.state;
  }

  // ==========================================================================
  // CUSTOM RUBRICS CRUD
  // ==========================================================================

  saveCustomProfile({ id, name, icon = '🧩', description = '', requiredSections = [], forbiddenPhrases = [] }) {
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('Tên bộ tiêu chí không được để trống.');

    const parsedSections = (Array.isArray(requiredSections) ? requiredSections : [])
      .map((sec, idx) => {
        const label = String(sec.label || '').trim();
        const keywords = (Array.isArray(sec.keywords)
          ? sec.keywords
          : String(sec.keywords || '')
              .split(',')
              .map((k) => k.trim())
        ).filter(Boolean);
        if (!label) return null;
        return {
          id: sec.id || `csec-${idx + 1}`,
          label,
          keywords: keywords.length > 0 ? keywords : [label.toLowerCase()]
        };
      })
      .filter(Boolean);

    if (parsedSections.length === 0) {
      throw new Error('Bộ tiêu chí cần ít nhất 1 đề mục bắt buộc.');
    }

    const parsedForbidden = (Array.isArray(forbiddenPhrases)
      ? forbiddenPhrases
      : String(forbiddenPhrases || '').split(',')
    )
      .map((s) => String(s).trim())
      .filter(Boolean);

    const profileObj = {
      id: id && String(id).startsWith('CUSTOM_') ? String(id) : `CUSTOM_${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      name: cleanName,
      icon: String(icon || '🧩').trim() || '🧩',
      isCustom: true,
      description: String(description || `Bộ tiêu chí rà soát tùy chỉnh: ${cleanName}`).trim(),
      requiredSections: parsedSections,
      forbiddenPhrases: parsedForbidden
    };

    const existingIdx = this.state.customProfiles.findIndex((p) => p.id === profileObj.id);
    if (existingIdx !== -1) {
      this.state.customProfiles[existingIdx] = profileObj;
    } else {
      this.state.customProfiles.push(profileObj);
    }
    this._persist();
    return profileObj;
  }

  deleteCustomProfile(profileId) {
    const idx = this.state.customProfiles.findIndex((p) => p.id === profileId);
    if (idx === -1) throw new Error('Không tìm thấy bộ tiêu chí tùy chỉnh cần xóa.');
    this.state.customProfiles.splice(idx, 1);
    this._persist();
    return true;
  }

  // ==========================================================================
  // GLOSSARY ENFORCER CRUD & AUTO-NORMALIZE
  // ==========================================================================

  addGlossaryRule({ wrongTerm, preferredTerm, caseSensitive = false, note = '' }) {
    const wrong = String(wrongTerm || '').trim();
    const preferred = String(preferredTerm || '').trim();
    if (!wrong || !preferred) {
      throw new Error('Cần nhập cả Từ viết chưa chuẩn và Thuật ngữ chuẩn thay thế.');
    }
    if (wrong === preferred) {
      throw new Error('Thuật ngữ chuẩn phải khác với từ chưa chuẩn.');
    }

    const rule = {
      id: `gl-${crypto.randomUUID().slice(0, 8)}`,
      wrongTerm: wrong,
      preferredTerm: preferred,
      caseSensitive: Boolean(caseSensitive),
      enabled: true,
      note: String(note || `Chuẩn hóa "${wrong}" ➔ "${preferred}"`).trim()
    };

    this.state.glossaryRules.unshift(rule);
    this._persist();
    return rule;
  }

  toggleGlossaryRule(ruleId, enabled) {
    const rule = this.state.glossaryRules.find((r) => r.id === ruleId);
    if (!rule) throw new Error('Không tìm thấy quy tắc thuật ngữ.');
    rule.enabled = Boolean(enabled);
    this._persist();
    return rule;
  }

  deleteGlossaryRule(ruleId) {
    const idx = this.state.glossaryRules.findIndex((r) => r.id === ruleId);
    if (idx === -1) throw new Error('Không tìm thấy quy tắc thuật ngữ cần xóa.');
    this.state.glossaryRules.splice(idx, 1);
    this._persist();
    return true;
  }

  /**
   * Tự động chuẩn hóa toàn bộ các thuật ngữ vi phạm trong văn bản (bỏ qua khối code ```...```)
   */
  applyGlossaryNormalization(markdown) {
    const activeRules = this.state.glossaryRules.filter((r) => r.enabled && r.wrongTerm && r.preferredTerm);
    if (activeRules.length === 0) return { content: markdown, replacementsCount: 0 };

    // Tách theo khối code để không sửa nhầm biến lập trình trong ```...```
    const segments = String(markdown || '').split(/(```[\s\S]*?```|`[^`\n]+`)/g);
    let totalReplaced = 0;

    const updatedSegments = segments.map((seg) => {
      if (seg.startsWith('`')) return seg;
      let out = seg;
      for (const rule of activeRules) {
        const re = buildGlossaryRegex(rule.wrongTerm, rule.caseSensitive);
        out = out.replace(re, (matched) => {
          if (matched === rule.preferredTerm) return matched;
          totalReplaced++;
          return rule.preferredTerm;
        });
      }
      return out;
    });

    return {
      content: updatedSegments.join(''),
      replacementsCount: totalReplaced
    };
  }
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildGlossaryRegex(term, caseSensitive) {
  const escaped = escapeRegExp(term);
  // Dùng lookbehind/lookahead ký tự chữ/số Unicode để không bắt nhầm một phần của từ dài hơn
  const flags = caseSensitive ? 'gu' : 'giu';
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, flags);
}

module.exports = {
  GovernanceStore,
  buildGlossaryRegex,
  escapeRegExp
};
