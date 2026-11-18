/**
 * 🧠 DocReview Studio — Multi-Profile Document Quality & Readiness Engine
 * Chấm điểm chất lượng tài liệu 0–100 trên 5 trục (Cấu trúc, Độ rõ ràng, Nhất quán, Thực thi, An toàn)
 * Hỗ trợ 4 chuẩn đánh giá: PRD_SPEC, SOP_OPERATIONS, ACADEMIC_REPORT, GENERAL_EDITORIAL
 */

const REVIEW_PROFILES = {
  PRD_SPEC: {
    id: 'PRD_SPEC',
    name: 'PRD & Thiết Kế Kỹ Thuật (RFC / Spec)',
    icon: '📐',
    description: 'Đánh giá tài liệu yêu cầu sản phẩm & thiết kế hệ thống: bắt câu mơ hồ thiếu SLA, mâu thuẫn số liệu, thiếu kịch bản Rollback và tiêu chí nghiệm thu.',
    requiredSections: [
      { id: 'sec-goal', label: 'Bối cảnh & Mục tiêu bài toán', pattern: /mục tiêu|bối cảnh|vấn đề|tổng quan|problem|objective|overview|background/i },
      { id: 'sec-scope', label: 'Phạm vi & Đối tượng người dùng (Scope)', pattern: /phạm vi|đối tượng|người dùng|ngoài phạm vi|scope|persona|target/i },
      { id: 'sec-func', label: 'Yêu cầu Chức năng / Luồng nghiệp vụ', pattern: /yêu cầu chức năng|luồng nghiệp vụ|tính năng|api|kiến trúc|functional|workflow|architecture/i },
      { id: 'sec-nfr', label: 'Phi chức năng, Hiệu năng & SLA', pattern: /phi chức năng|hiệu năng|độ trễ|sla|tải|bảo mật|non-functional|performance|latency|uptime/i },
      { id: 'sec-risk', label: 'Rủi ro & Phương án Rollback / Dự phòng', pattern: /rủi ro|dự phòng|rollback|fallback|khôi phục|mitigation|risk/i },
      { id: 'sec-kpi', label: 'Chỉ số Thành công & Tiêu chí Nghiệm thu', pattern: /chỉ số|kpi|nghiệm thu|đo lường|tiêu chí hoàn thành|metric|acceptance/i }
    ]
  },
  SOP_OPERATIONS: {
    id: 'SOP_OPERATIONS',
    name: 'Quy Trình Vận Hành Chuẩn (SOP / Policy)',
    icon: '⚙️',
    description: 'Đánh giá quy trình nội bộ & hướng dẫn vận hành: kiểm tra phân công người chịu trách nhiệm (PIC/RACI), mốc thời gian, xử lý sự cố ngoại lệ và biểu mẫu.',
    requiredSections: [
      { id: 'sop-purpose', label: 'Mục đích ban hành', pattern: /mục đích|mục tiêu|purpose/i },
      { id: 'sop-scope', label: 'Phạm vi & Đối tượng áp dụng', pattern: /phạm vi|đối tượng áp dụng|áp dụng cho|scope/i },
      { id: 'sop-roles', label: 'Vai trò & Trách nhiệm (PIC / RACI)', pattern: /vai trò|trách nhiệm|phân công|raci|người phụ trách|bộ phận/i },
      { id: 'sop-steps', label: 'Các bước thực hiện chi tiết', pattern: /các bước|quy trình thực hiện|trình tự|hướng dẫn|bước 1|giai đoạn/i },
      { id: 'sop-exception', label: 'Xử lý Ngoại lệ & Báo cáo Sự cố', pattern: /ngoại lệ|sự cố|khẩn cấp|leo thang|escalation|exception/i },
      { id: 'sop-records', label: 'Biểu mẫu, Nhật ký & Lưu trữ', pattern: /biểu mẫu|hồ sơ|lưu trữ|nhật ký|tài liệu liên quan|log|template/i }
    ]
  },
  ACADEMIC_REPORT: {
    id: 'ACADEMIC_REPORT',
    name: 'Báo Cáo Nghiên Cứu / Luận Văn / Whitepaper',
    icon: '🎓',
    description: 'Đánh giá bài báo khoa học, khóa luận & báo cáo phân tích: kiểm tra trích dẫn thiếu nguồn, nhảy số tham chiếu [1]->[3], nhận định cảm tính và bố cục học thuật.',
    requiredSections: [
      { id: 'acad-abs', label: 'Tóm tắt (Abstract / Executive Summary)', pattern: /tóm tắt|abstract|tổng quan nghiên cứu/i },
      { id: 'acad-intro', label: 'Đặt vấn đề & Giới thiệu', pattern: /đặt vấn đề|giới thiệu|mở đầu|introduction/i },
      { id: 'acad-method', label: 'Cơ sở lý thuyết & Phương pháp', pattern: /phương pháp|cơ sở lý thuyết|mô hình đề xuất|methodology|method/i },
      { id: 'acad-exp', label: 'Thực nghiệm & Đánh giá Kết quả', pattern: /thực nghiệm|kết quả|đánh giá|so sánh|experiment|result|evaluation/i },
      { id: 'acad-lim', label: 'Thảo luận & Hạn chế (Limitations)', pattern: /thảo luận|hạn chế|giới hạn|bàn luận|discussion|limitation/i },
      { id: 'acad-ref', label: 'Kết luận & Tài liệu Tham khảo', pattern: /tài liệu tham khảo|tham khảo|references|bibliography/i }
    ]
  },
  GENERAL_EDITORIAL: {
    id: 'GENERAL_EDITORIAL',
    name: 'Đề Xuất Kinh Doanh & Tài Liệu Chung (Proposal)',
    icon: '💼',
    description: 'Đánh giá đề xuất dự án, tờ trình, kế hoạch kinh doanh & tài liệu tổng hợp: kiểm tra tính thuyết phục, số liệu ROI, tính nhất quán thuật ngữ và an toàn bảo mật.',
    requiredSections: [
      { id: 'gen-context', label: 'Bối cảnh & Nhu cầu / Tổng quan', pattern: /bối cảnh|tổng quan|nhu cầu|hiện trạng|mở đầu|đặt vấn đề/i },
      { id: 'gen-solution', label: 'Giải pháp / Nội dung Đề xuất', pattern: /giải pháp|phương án|nội dung đề xuất|kế hoạch triển khai/i },
      { id: 'gen-budget', label: 'Lộ trình, Nguồn lực & Chi phí / ROI', pattern: /lộ trình|tiến độ|chi phí|ngân sách|hiệu quả|roi|nguồn lực|timeline/i },
      { id: 'gen-next', label: 'Kết luận & Đề xuất Phê duyệt', pattern: /kết luận|kiến nghị|đề xuất phê duyệt|bước tiếp theo|cam kết/i }
    ]
  }
};

const WEASEL_PATTERNS = [
  {
    regex: /\b(xử lý thật nhanh|phản hồi cực nhanh|chạy nhanh nhất có thể|xử lý tức thời mọi tác vụ)\b/gi,
    title: 'Cam kết hiệu năng mơ hồ, thiếu ngưỡng SLA định lượng',
    suggestion: (m) => `${m} (độ trễ P95 <= 300ms ở mức tải 500 RPS)`
  },
  {
    regex: /\b(càng sớm càng tốt|trong thời gian sớm nhất|sớm nhất có thể|ASAP)\b/gi,
    title: 'Mốc thời gian "càng sớm càng tốt" không thể kiểm chứng nghiệm thu',
    suggestion: () => 'trong vòng tối đa 04 giờ làm việc kể từ thời điểm ghi nhận'
  },
  {
    regex: /\b(tối ưu sau|sẽ bổ sung sau|cập nhật chi tiết sau|tính sau)\b/gi,
    title: 'Trì hoãn thiết kế ("sẽ bổ sung/tối ưu sau") không gắn mã theo dõi',
    suggestion: () => 'đưa vào lộ trình Giai đoạn 2 (theo dõi tại hạng mục kỹ thuật cụ thể trước ngày nghiệm thu)'
  },
  {
    regex: /\b(tùy tình hình thực tế|tùy cơ ứng biến|linh hoạt tùy trường hợp)\b/gi,
    title: 'Điều kiện rẽ nhánh cảm tính ("tùy tình hình thực tế")',
    suggestion: () => 'theo quyết định phê duyệt bằng văn bản của Trưởng bộ phận phụ trách'
  },
  {
    regex: /\b(mở rộng không giới hạn|không bao giờ sập|tuyệt đối hoàn hảo|chắc chắn 100%\s+không lỗi)\b/gi,
    title: 'Khẳng định phóng đại / phi thực tế về mặt kỹ thuật',
    suggestion: () => 'đảm bảo độ sẵn sàng mục tiêu SLA >= 99.95% kèm cơ chế tự động chuyển đổi dự phòng (Failover)'
  },
  {
    regex: /(?:,\s*|\s+)(v\.v\.|vân vân)(?=[.\n,;)]|$)/gi,
    title: 'Liệt kê bỏ lửng bằng "v.v." trong tài liệu quy chuẩn',
    suggestion: () => ' (danh mục chi tiết quy định tại Phụ lục đính kèm)'
  }
];

const SECRET_LEAK_PATTERNS = [
  {
    regex: /\b(sk-(?:proj-)?[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{25,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{15,})\b/g,
    title: 'Rò rỉ khóa API / Secret Token trực tiếp trong tài liệu',
    replaceWith: '<REDACTED_API_KEY_FROM_ENV>'
  },
  {
    regex: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s]+:[^@\s]{4,}@[^\s)`"']+/gi,
    title: 'Lộ chuỗi kết nối Database kèm mật khẩu thật (Connection String)',
    replaceWith: 'postgresql://${DB_USER}:${DB_PASSWORD}@db.internal:5432/app_db'
  },
  {
    regex: /(?:password|mật\s*khẩu|client_secret|api_secret)\s*[:=]\s*["']([^"'<${\s]{6,})["']/gi,
    title: 'Ghi cứng mật khẩu / Client Secret dạng rõ trong văn bản',
    replaceWith: 'client_secret = "${SECRET_FROM_VAULT}"'
  }
];

const { splitMarkdownIntoBlocks } = require('./readability-engine');

function parseDocumentBlocks(markdown) {
  const rawBlocks = splitMarkdownIntoBlocks(markdown);

  return rawBlocks.map((text, idx) => {
    const headingMatch = text.match(/^(#{1,6})\s+(.+)$/m);
    const isTable = text.startsWith('|') && text.includes('|');
    const isCode = text.startsWith('```');
    const plain = text
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*|\*|`|~~/g, '')
      .trim();
    const words = plain.match(/\S+/g) || [];
    return {
      index: idx + 1,
      raw: text,
      plain,
      wordCount: words.length,
      isHeading: Boolean(headingMatch && text.split('\n').length === 1),
      headingLevel: headingMatch ? headingMatch[1].length : 0,
      headingTitle: headingMatch ? headingMatch[2].trim() : null,
      isTable,
      isCode
    };
  });
}

function normalizeUnitValue(numStr, unitStr) {
  const val = parseFloat(String(numStr).replace(/,/g, '.'));
  if (Number.isNaN(val)) return null;
  const u = String(unitStr || '').toLowerCase().trim();
  if (u === 'ms' || u === 'mili giây') return { dimension: 'TIME_MS', canonical: val, raw: `${numStr}${unitStr}` };
  if (u === 's' || u === 'giây' || u === 'sec') return { dimension: 'TIME_MS', canonical: val * 1000, raw: `${numStr} ${unitStr}` };
  if (u === 'phút' || u === 'min') return { dimension: 'TIME_MIN', canonical: val, raw: `${numStr} ${unitStr}` };
  if (u === 'giờ' || u === 'h') return { dimension: 'TIME_MIN', canonical: val * 60, raw: `${numStr} ${unitStr}` };
  if (u === '%') return { dimension: 'PERCENT', canonical: val, raw: `${numStr}%` };
  return null;
}

function detectMetricConflicts(blocks) {
  const metricTopics = [
    { key: 'LATENCY', label: 'Độ trễ / Thời gian phản hồi', regex: /(?:độ trễ|thời gian phản hồi|latency|timeout)[^.\n\d]{0,35}?(\d+(?:[.,]\d+)?)\s*(ms|mili giây|giây|s)\b/gi },
    { key: 'SLA_UPTIME', label: 'Mục tiêu độ sẵn sàng (Uptime / SLA)', regex: /(?:uptime|độ sẵn sàng|sla)[^.\n\d]{0,30}?(\d{2}(?:[.,]\d+)?)\s*(%)/gi },
    { key: 'RTO_RECOVERY', label: 'Thời gian khôi phục sự cố (RTO / Báo cáo)', regex: /(?:khôi phục|rto|báo cáo sự cố|phản hồi sự cố)[^.\n\d]{0,35}?(\d+(?:[.,]\d+)?)\s*(phút|giờ|min|h)\b/gi }
  ];

  const conflicts = [];
  for (const topic of metricTopics) {
    const sightings = [];
    for (const blk of blocks) {
      if (blk.isCode) continue;
      let m;
      const re = new RegExp(topic.regex.source, topic.regex.flags);
      while ((m = re.exec(blk.raw)) !== null) {
        const norm = normalizeUnitValue(m[1], m[2]);
        if (norm) {
          sightings.push({
            paragraphIndex: blk.index,
            snippet: m[0].trim(),
            ...norm
          });
        }
      }
    }

    if (sightings.length >= 2) {
      const first = sightings[0];
      const mismatch = sightings.find(
        (s) => s.dimension === first.dimension && Math.abs(s.canonical - first.canonical) > 0.001
      );
      if (mismatch) {
        conflicts.push({
          topicLabel: topic.label,
          first,
          mismatch
        });
      }
    }
  }
  return conflicts;
}

const { buildGlossaryRegex, escapeRegExp } = require('./governance-store');

function resolveProfile(profileId, governance) {
  if (REVIEW_PROFILES[profileId]) {
    return REVIEW_PROFILES[profileId];
  }
  const customList = governance && Array.isArray(governance.customProfiles) ? governance.customProfiles : [];
  const customFound = customList.find((p) => p.id === profileId);
  if (customFound) {
    return {
      id: customFound.id,
      name: customFound.name,
      icon: customFound.icon || '🧩',
      isCustom: true,
      description: customFound.description || '',
      forbiddenPhrases: Array.isArray(customFound.forbiddenPhrases) ? customFound.forbiddenPhrases : [],
      requiredSections: (customFound.requiredSections || []).map((sec, idx) => {
        const kws = Array.isArray(sec.keywords) && sec.keywords.length > 0 ? sec.keywords : [sec.label];
        const regexSource = kws.map((k) => escapeRegExp(String(k).trim())).filter(Boolean).join('|');
        return {
          id: sec.id || `csec-${idx + 1}`,
          label: sec.label,
          pattern: new RegExp(regexSource || escapeRegExp(sec.label), 'i')
        };
      })
    };
  }
  return REVIEW_PROFILES.PRD_SPEC;
}

function evaluateDocument(markdown, profileId = 'PRD_SPEC', governance = null) {
  const profile = resolveProfile(profileId, governance);
  const blocks = parseDocumentBlocks(markdown);
  const fullText = String(markdown || '');
  const findings = [];

  // Thống kê cơ bản
  const totalWords = blocks.reduce((acc, b) => acc + b.wordCount, 0);
  const readingTimeMin = Math.max(1, Math.ceil(totalWords / 210));
  const headings = blocks.filter((b) => b.isHeading);
  const tablesCount = blocks.filter((b) => b.isTable).length;

  // 1. KIỂM TRA CẤU TRÚC & ĐẦY ĐỦ MỤC BẮT BUỘC (STRUCTURE)
  const sectionChecklist = profile.requiredSections.map((sec) => {
    const matched = sec.pattern.test(fullText);
    return {
      id: sec.id,
      label: sec.label,
      passed: matched
    };
  });

  const missingSections = sectionChecklist.filter((s) => !s.passed);
  for (const miss of missingSections) {
    findings.push({
      id: `missing-${miss.id}`,
      severity: missingSections.length >= 3 ? 'CRITICAL' : 'WARNING',
      axis: 'STRUCTURE',
      title: `Thiếu mục trọng yếu: ${miss.label}`,
      message: `Theo chuẩn "${profile.name}", tài liệu cần làm rõ phần "${miss.label}" để đủ điều kiện phê duyệt.`,
      quote: headings[0] ? headings[0].raw : (blocks[0]?.raw.slice(0, 80) || ''),
      paragraphIndex: 1,
      suggestedFix: null
    });
  }

  // Kiểm tra nhảy cấp Heading (ví dụ H1 -> H3 bỏ qua H2)
  let prevHeadingLevel = 0;
  for (const h of headings) {
    if (prevHeadingLevel > 0 && h.headingLevel > prevHeadingLevel + 1) {
      findings.push({
        id: `heading-skip-${h.index}`,
        severity: 'INFO',
        axis: 'STRUCTURE',
        title: `Nhảy cấp tiêu đề đột ngột (H${prevHeadingLevel} ➔ H${h.headingLevel})`,
        message: `Tiêu đề "${h.headingTitle}" nhảy từ cấp H${prevHeadingLevel} xuống H${h.headingLevel}. Nên dùng H${prevHeadingLevel + 1} để mục lục mạch lạc.`,
        quote: h.raw,
        paragraphIndex: h.index,
        suggestedFix: `${'#'.repeat(prevHeadingLevel + 1)} ${h.headingTitle}`
      });
    }
    prevHeadingLevel = h.headingLevel;
  }

  // 2. KIỂM TRA PLACEHOLDER BỎ SÓT & KẾT NỐI HỎNG (ACTIONABILITY)
  const placeholderRegex = /(\b(?:TODO|TBD|FIXME|XXX)\b(?::[^\n.]+)?|\[\s*(?:Điền|Nhập|Tên|Chờ cập nhật|Bổ sung)[^\]]*\]|\{\{[^}]+\}\}|_{3,})/gi;
  for (const blk of blocks) {
    if (blk.isCode) continue;
    let m;
    const re = new RegExp(placeholderRegex.source, placeholderRegex.flags);
    while ((m = re.exec(blk.raw)) !== null) {
      findings.push({
        id: `placeholder-${blk.index}-${m.index}`,
        severity: 'CRITICAL',
        axis: 'ACTIONABILITY',
        title: `Còn sót thẻ giữ chỗ / nội dung chưa hoàn thiện ("${m[0].slice(0, 32)}")`,
        message: `Đoạn ¶${blk.index} vẫn chứa ký hiệu nháp "${m[0]}". Cần điền thông tin chính thức trước khi trình ký.`,
        quote: m[0],
        paragraphIndex: blk.index,
        suggestedFix: null
      });
    }

    // Link rỗng hoặc #
    const brokenLinkRegex = /\[([^\]]+)\]\(\s*(?:#|http:\/\/example\.com[^\s)]*|)\s*\)/gi;
    let lm;
    while ((lm = brokenLinkRegex.exec(blk.raw)) !== null) {
      findings.push({
        id: `broken-link-${blk.index}-${lm.index}`,
        severity: 'WARNING',
        axis: 'ACTIONABILITY',
        title: `Liên kết tham chiếu chưa có URL hợp lệ: "${lm[1]}"`,
        message: `Liên kết "${lm[0]}" tại ¶${blk.index} đang trỏ rỗng hoặc dùng URL giả lập.`,
        quote: lm[0],
        paragraphIndex: blk.index,
        suggestedFix: `[${lm[1]}](https://docs.internal.vn/spec-reference)`
      });
    }
  }

  // Kiểm tra bước SOP thiếu chủ thể chịu trách nhiệm (PIC)
  if (profile.id === 'SOP_OPERATIONS') {
    for (const blk of blocks) {
      if (/^(?:[-*]\s+|\d+\.\s+)?Bước\s+\d+\s*:/i.test(blk.plain)) {
        const hasActor = /\b(nhân viên|kỹ sư|trưởng nhóm|quản lý|bộ phận|phòng|kế toán|vận hành|it|qa|security|devops|cs|support| trực ca|pic)\b/i.test(
          blk.plain
        );
        if (!hasActor) {
          const snippet = blk.raw.split('\n')[0].slice(0, 110);
          findings.push({
            id: `sop-no-pic-${blk.index}`,
            severity: 'WARNING',
            axis: 'ACTIONABILITY',
            title: `Bước quy trình chưa chỉ rõ Người thực hiện (PIC) tại ¶${blk.index}`,
            message: `Bước thực hiện nên nêu rõ vai trò chịu trách nhiệm (Ai làm? Trong bao lâu?) thay vì viết câu khuyết chủ ngữ.`,
            quote: snippet,
            paragraphIndex: blk.index,
            suggestedFix: snippet.replace(/^(Bước\s+\d+\s*:\s*)/i, '$1[Phụ trách: Kỹ sư Trực ca SOC] ')
          });
        }
      }
    }
  }

  // 3. KIỂM TRA TỪ NGỮ MƠ HỒ & CÂU QUÁ DÀI (CLARITY)
  for (const blk of blocks) {
    if (blk.isCode || blk.isTable) continue;
    for (const wp of WEASEL_PATTERNS) {
      const re = new RegExp(wp.regex.source, wp.regex.flags);
      let wm;
      while ((wm = re.exec(blk.raw)) !== null) {
        const matchedPhrase = wm[0];
        findings.push({
          id: `weasel-${blk.index}-${wm.index}`,
          severity: 'WARNING',
          axis: 'CLARITY',
          title: wp.title,
          message: `Cụm từ "${matchedPhrase.trim()}" tại ¶${blk.index} dễ gây tranh cãi khi nghiệm thu. Nên thay bằng tiêu chí đo đếm được.`,
          quote: matchedPhrase.trim(),
          paragraphIndex: blk.index,
          suggestedFix: wp.suggestion(matchedPhrase.trim())
        });
      }
    }

    // Đoạn văn quá dày chữ (> 135 từ không tách ý)
    if (!blk.isHeading && blk.wordCount > 135 && !blk.raw.includes('\n- ')) {
      findings.push({
        id: `wall-of-text-${blk.index}`,
        severity: 'INFO',
        axis: 'CLARITY',
        title: `Đoạn văn ¶${blk.index} quá dài (${blk.wordCount} từ)`,
        message: `Đoạn văn dài trên 135 từ liên tục làm giảm tốc độ rà soát. Nên tách thành các gạch đầu dòng hoặc 2 đoạn nhỏ.`,
        quote: blk.raw.slice(0, 95),
        paragraphIndex: blk.index,
        suggestedFix: null
      });
    }
  }

  // 4. KIỂM TRA MÂU THUẪN SỐ LIỆU, TRÍCH DẪN & NHẤT QUÁN THUẬT NGỮ (CONSISTENCY)
  const metricConflicts = detectMetricConflicts(blocks);
  for (const c of metricConflicts) {
    findings.push({
      id: `metric-conflict-${c.first.paragraphIndex}-${c.mismatch.paragraphIndex}`,
      severity: 'CRITICAL',
      axis: 'CONSISTENCY',
      title: `Mâu thuẫn số liệu "${c.topicLabel}" giữa ¶${c.first.paragraphIndex} và ¶${c.mismatch.paragraphIndex}`,
      message: `Tại ¶${c.first.paragraphIndex} ghi "${c.first.snippet}", nhưng tại ¶${c.mismatch.paragraphIndex} lại ghi "${c.mismatch.snippet}". Cần thống nhất một con số chuẩn duy nhất.`,
      quote: c.mismatch.snippet,
      paragraphIndex: c.mismatch.paragraphIndex,
      suggestedFix: c.mismatch.snippet.replace(c.mismatch.raw.trim(), c.first.raw.trim())
    });
  }

  // Kiểm tra trích dẫn học thuật / số liệu thiếu nguồn
  const uncitedClaimRegex = /\b(nhiều nghiên cứu chỉ ra rằng|các nghiên cứu đã chứng minh|theo thống kê chính thức cho thấy|hầu hết các chuyên gia đều đồng ý)\b/gi;
  for (const blk of blocks) {
    if (blk.isCode) continue;
    let um;
    while ((um = uncitedClaimRegex.exec(blk.raw)) !== null) {
      const hasCitation = /\[\d+\]|\([A-ZÀ-Ỹ][a-zà-ỹ]+.*?\d{4}\)/.test(blk.raw);
      if (!hasCitation) {
        findings.push({
          id: `uncited-${blk.index}-${um.index}`,
          severity: profile.id === 'ACADEMIC_REPORT' ? 'CRITICAL' : 'WARNING',
          axis: 'CONSISTENCY',
          title: `Nhận định tổng quát thiếu trích dẫn nguồn tại ¶${blk.index}`,
          message: `Cụm "${um[0]}" nêu kết luận thực nghiệm nhưng chưa gắn mã tài liệu tham khảo [n] hoặc (Tác giả, Năm).`,
          quote: um[0],
          paragraphIndex: blk.index,
          suggestedFix: `${um[0]} [1]`
        });
      }
    }
  }

  // Kiểm tra nhảy số trích dẫn [1], [3] (thiếu [2])
  const citationNums = [...new Set((fullText.match(/\[(\d{1,3})\]/g) || []).map((x) => Number(x.slice(1, -1))))].sort(
    (a, b) => a - b
  );
  if (citationNums.length >= 2) {
    const maxCit = citationNums[citationNums.length - 1];
    const missingCits = [];
    for (let k = 1; k <= maxCit; k++) {
      if (!citationNums.includes(k)) missingCits.push(`[${k}]`);
    }
    if (missingCits.length > 0 && missingCits.length <= 5) {
      findings.push({
        id: `citation-gap`,
        severity: 'WARNING',
        axis: 'CONSISTENCY',
        title: `Đánh số trích dẫn bị khuyết: thiếu ${missingCits.join(', ')}`,
        message: `Tài liệu có trích dẫn đến [${maxCit}] nhưng bị nhảy qua ${missingCits.join(', ')}. Hãy đánh số lại thứ tự tham chiếu.`,
        quote: `[${maxCit}]`,
        paragraphIndex: blocks.findIndex((b) => b.raw.includes(`[${maxCit}]`)) + 1 || 1,
        suggestedFix: null
      });
    }
  }

  // 4b. KIỂM TRA CỤM TỪ CẤM RIÊNG CỦA CUSTOM RUBRIC & TỪ ĐIỂN THUẬT NGỮ CHUẨN (GLOSSARY ENFORCER)
  if (Array.isArray(profile.forbiddenPhrases) && profile.forbiddenPhrases.length > 0) {
    for (const blk of blocks) {
      if (blk.isCode) continue;
      for (const phrase of profile.forbiddenPhrases) {
        if (!phrase) continue;
        const fRe = new RegExp(escapeRegExp(phrase), 'gi');
        let fm;
        while ((fm = fRe.exec(blk.raw)) !== null) {
          findings.push({
            id: `custom-forbidden-${blk.index}-${fm.index}`,
            severity: 'CRITICAL',
            axis: 'SAFETY',
            title: `Vi phạm cụm từ bị cấm theo chuẩn "${profile.name}"`,
            message: `Cụm từ "${fm[0]}" tại ¶${blk.index} nằm trong danh mục không được phép sử dụng của tổ chức.`,
            quote: fm[0],
            paragraphIndex: blk.index,
            suggestedFix: null
          });
        }
      }
    }
  }

  let glossaryViolationsCount = 0;
  const activeGlossary =
    governance && Array.isArray(governance.glossaryRules)
      ? governance.glossaryRules.filter((r) => r && r.enabled && r.wrongTerm && r.preferredTerm)
      : [];

  if (activeGlossary.length > 0) {
    for (const blk of blocks) {
      if (blk.isCode) continue;
      // Loại bỏ phần trong backtick inline trước khi quét thuật ngữ
      const nonCodeLine = blk.raw.replace(/`[^`\n]+`/g, (m) => ' '.repeat(m.length));
      for (const rule of activeGlossary) {
        const gRe = buildGlossaryRegex(rule.wrongTerm, rule.caseSensitive);
        let gm;
        while ((gm = gRe.exec(nonCodeLine)) !== null) {
          const matchedWord = blk.raw.slice(gm.index, gm.index + gm[0].length);
          if (matchedWord === rule.preferredTerm) continue;
          glossaryViolationsCount++;
          findings.push({
            id: `glossary-${rule.id}-${blk.index}-${gm.index}`,
            severity: 'WARNING',
            axis: 'CONSISTENCY',
            isGlossaryFinding: true,
            glossaryRuleId: rule.id,
            title: `Thuật ngữ chưa chuẩn quy ước: "${matchedWord}" ➔ "${rule.preferredTerm}"`,
            message: rule.note || `Theo Từ điển Thuật ngữ chuẩn, vui lòng dùng "${rule.preferredTerm}" thay cho "${matchedWord}".`,
            quote: matchedWord,
            paragraphIndex: blk.index,
            suggestedFix: rule.preferredTerm
          });
        }
      }
    }
  }

  // 5. KIỂM TRA AN TOÀN BẢO MẬT — RÒ RỈ SECRET / API KEY (SAFETY)
  for (const blk of blocks) {
    for (const sp of SECRET_LEAK_PATTERNS) {
      const re = new RegExp(sp.regex.source, sp.regex.flags);
      let sm;
      while ((sm = re.exec(blk.raw)) !== null) {
        findings.push({
          id: `secret-leak-${blk.index}-${sm.index}`,
          severity: 'CRITICAL',
          axis: 'SAFETY',
          title: sp.title,
          message: `Phát hiện chuỗi nhạy cảm "${sm[0].slice(0, 14)}..." tại ¶${blk.index}. Tuyệt đối không lưu khóa thật trong tài liệu chia sẻ.`,
          quote: sm[0],
          paragraphIndex: blk.index,
          suggestedFix: sp.replaceWith
        });
      }
    }
  }

  // TÍNH ĐIỂM 5 TRỤC & TỔNG ĐIỂM 0-100
  const axisPenalties = {
    STRUCTURE: 0,
    CLARITY: 0,
    CONSISTENCY: 0,
    ACTIONABILITY: 0,
    SAFETY: 0
  };

  for (const f of findings) {
    const weight = f.severity === 'CRITICAL' ? 18 : f.severity === 'WARNING' ? 9 : 4;
    axisPenalties[f.axis] = (axisPenalties[f.axis] || 0) + weight;
  }

  // Thưởng nhẹ nếu có bảng biểu / độ dài hợp lý
  const lengthPenalty = totalWords < 80 ? 25 : 0;

  const axes = {
    STRUCTURE: Math.max(20, 100 - axisPenalties.STRUCTURE - lengthPenalty),
    CLARITY: Math.max(25, 100 - axisPenalties.CLARITY),
    CONSISTENCY: Math.max(20, 100 - axisPenalties.CONSISTENCY),
    ACTIONABILITY: Math.max(20, 100 - axisPenalties.ACTIONABILITY),
    SAFETY: Math.max(15, 100 - axisPenalties.SAFETY)
  };

  const overallScore = Math.round(
    axes.STRUCTURE * 0.24 +
      axes.CLARITY * 0.22 +
      axes.CONSISTENCY * 0.22 +
      axes.ACTIONABILITY * 0.2 +
      axes.SAFETY * 0.12
  );

  let grade = 'A+';
  let verdict = 'Xuất sắc — Đủ điều kiện phê duyệt ban hành ngay';
  if (overallScore < 55) {
    grade = 'D';
    verdict = 'Cần đại tu — Còn lỗi nghiêm trọng hoặc thiếu nhiều mục cốt lõi';
  } else if (overallScore < 72) {
    grade = 'C';
    verdict = 'Cần chỉnh sửa — Hãy xử lý các cảnh báo định lượng & mâu thuẫn trước khi duyệt';
  } else if (overallScore < 85) {
    grade = 'B';
    verdict = 'Khá tốt — Chỉ còn một vài điểm nhỏ cần làm rõ với Reviewer';
  } else if (overallScore < 94) {
    grade = 'A';
    verdict = 'Rất tốt — Cấu trúc chặt chẽ, sẵn sàng phê duyệt (Sign-off)';
  }

  const counts = {
    total: findings.length,
    critical: findings.filter((f) => f.severity === 'CRITICAL').length,
    warning: findings.filter((f) => f.severity === 'WARNING').length,
    info: findings.filter((f) => f.severity === 'INFO').length,
    glossary: glossaryViolationsCount
  };

  return {
    profileId: profile.id,
    profileName: profile.name,
    overallScore,
    grade,
    verdict,
    axes,
    counts,
    stats: {
      wordCount: totalWords,
      paragraphCount: blocks.length,
      headingCount: headings.length,
      tableCount: tablesCount,
      readingTimeMin
    },
    sectionChecklist,
    findings
  };
}

module.exports = {
  REVIEW_PROFILES,
  evaluateDocument,
  parseDocumentBlocks
};
