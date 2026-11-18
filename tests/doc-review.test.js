/**
 * 🧪 Bộ Kiểm Thử Tự Động Toàn Diện Cho DocReview Studio
 * Chạy bằng lệnh: npm test (node --test tests/doc-review.test.js)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { evaluateDocument } = require('../lib/quality-engine');
const { compareVersions } = require('../lib/diff-engine');
const { buildDocxBuffer, parseDocxBuffer } = require('../lib/docx-codec');
const { buildSimplePdfBuffer, parsePdfBuffer } = require('../lib/pdf-codec');
const { createAppServer } = require('../server');

test('1. Quality Engine phát hiện mâu thuẫn số liệu, từ mơ hồ và rò rỉ API Key', () => {
  const samplePrd = `# PRD: Hệ Thống Thanh Toán

## 1. Bối cảnh & Mục tiêu
Giải quyết bài toán thanh toán tự động.

## 2. Yêu cầu Chức năng
Hệ thống đảm bảo xử lý thật nhanh các giao dịch và dùng khóa \`sk-proj-1234567890abcdefghijklmnop\` để gọi dịch vụ.

## 3. Phi chức năng & SLA
Độ trễ phản hồi tối đa 200ms tại cổng API chính.

## 4. Chỉ số KPI Nghiệm thu
Độ trễ phản hồi tối đa 3 giây trong bảng nghiệm thu.`;

  const report = evaluateDocument(samplePrd, 'PRD_SPEC');
  assert.ok(report.overallScore < 85, 'Điểm phải bị trừ khi có lỗi nghiêm trọng');
  assert.ok(
    report.findings.some((f) => f.id.startsWith('metric-conflict')),
    'Phải bắt được mâu thuẫn 200ms vs 3 giây'
  );
  assert.ok(
    report.findings.some((f) => f.axis === 'SAFETY' && f.severity === 'CRITICAL'),
    'Phải bắt được khóa sk-proj-... bị lộ'
  );
  assert.ok(
    report.findings.some((f) => f.axis === 'CLARITY'),
    'Phải bắt được cụm từ mơ hồ "xử lý thật nhanh"'
  );
});

test('2. Quality Engine bắt nhảy số trích dẫn [1]->[3] trong chuẩn Báo cáo Học thuật', () => {
  const paper = `# Báo Cáo Thực Nghiệm

## 1. Tóm tắt
Nghiên cứu cải thiện độ chính xác mô hình [1].

## 2. Đặt vấn đề
Nhiều nghiên cứu chỉ ra rằng mô hình nhỏ vẫn hiệu quả nếu tinh chỉnh tốt.

## 3. Phương pháp & Thực nghiệm
Áp dụng kỹ thuật hợp nhất xếp hạng [3].`;

  const report = evaluateDocument(paper, 'ACADEMIC_REPORT');
  assert.ok(report.findings.some((f) => f.id === 'citation-gap'), 'Phải phát hiện thiếu trích dẫn [2]');
  assert.ok(report.findings.some((f) => f.id.startsWith('uncited-')), 'Phải phát hiện câu nhận định thiếu nguồn');
});

test('3. DOCX Codec xuất và đọc ngược đầy đủ Tiêu đề, Bảng biểu và Chú thích Word (word/comments.xml)', () => {
  const md = `# Tài Liệu Đặc Tả Kỹ Thuật

## 1. Mục tiêu hệ thống
Hệ thống đạt độ sẵn sàng **99.99%** cho toàn bộ cụm máy chủ chính.

| Dịch vụ | Ngưỡng độ trễ |
| --- | --- |
| API Gateway | 120ms |`;

  const docxBuffer = buildDocxBuffer({
    title: 'Tài Liệu Đặc Tả Kỹ Thuật',
    markdown: md,
    comments: [
      {
        author: 'Quốc Bảo',
        category: 'CLARITY',
        status: 'OPEN',
        quote: 'cụm máy chủ chính',
        text: 'Làm rõ cụm máy chủ đặt tại vùng DC Hà Nội hay TP.HCM.',
        createdAt: '2026-11-18T08:00:00.000Z'
      }
    ],
    includeComments: true,
    includeCertificate: false
  });

  assert.ok(Buffer.isBuffer(docxBuffer) && docxBuffer.length > 500, 'Buffer .docx hợp lệ');

  const parsed = parseDocxBuffer(docxBuffer);
  assert.match(parsed.markdown, /# Tài Liệu Đặc Tả Kỹ Thuật/);
  assert.match(parsed.markdown, /## 1\. Mục tiêu hệ thống/);
  assert.match(parsed.markdown, /\| API Gateway \| 120ms \|/);
  assert.equal(parsed.importedComments.length, 1, 'Phải trích xuất lại đúng 1 comment từ word/comments.xml');
  assert.equal(parsed.importedComments[0].author, 'Quốc Bảo');
  assert.equal(parsed.importedComments[0].quote, 'cụm máy chủ chính');
  assert.match(parsed.importedComments[0].text, /Làm rõ cụm máy chủ/);
});

test('4. Version Diff Engine tính đúng từ thêm/bớt và độ tương đồng', () => {
  const v1 = `# Tiêu đề\n\nHệ thống hỗ trợ tối đa 500 người dùng đồng thời.`;
  const v2 = `# Tiêu đề\n\nHệ thống hỗ trợ tối đa 2000 người dùng đồng thời kèm Redis Cache.`;
  const diff = compareVersions(v1, v2);

  assert.equal(diff.summary.changedBlocks, 1);
  assert.ok(diff.summary.addedWords >= 3);
  assert.ok(diff.summary.removedWords >= 1);
  assert.ok(diff.summary.similarityPct > 40 && diff.summary.similarityPct < 100);
});

test('5. End-to-End HTTP API: Bình luận, Track Changes, Cổng Phê duyệt & Nhập/Xuất .DOCX', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docreview-test-'));
  const dataFile = path.join(tmpDir, 'documents.json');
  const { server } = createAppServer(dataFile);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 5.1 Health check
    const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
    assert.equal(health.ok, true);
    assert.equal(health.documentCount, 4);

    // 5.2 Tạo tài liệu mới sạch
    const cleanContent = `# Quy Trình Chuẩn\n\n## 1. Mục đích ban hành\nThiết lập quy trình chuẩn.\n\n## 2. Phạm vi & Đối tượng áp dụng\nToàn công ty.\n\n## 3. Vai trò & Trách nhiệm (RACI)\nTrưởng phòng IT phụ trách.\n\n## 4. Các bước thực hiện chi tiết\nBước 1: Kỹ sư IT kiểm tra hệ thống định kỳ mỗi 24 giờ.\n\n## 5. Xử lý Ngoại lệ & Báo cáo Sự cố\nBáo cáo sự cố trong 15 phút.\n\n## 6. Biểu mẫu, Nhật ký & Lưu trữ\nLưu trữ hồ sơ 24 tháng.`;

    const createdRes = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'SOP Kiểm Tra Định Kỳ',
        profileId: 'SOP_OPERATIONS',
        content: cleanContent,
        owner: 'Tester'
      })
    }).then((r) => r.json());

    assert.equal(createdRes.ok, true);
    const docId = createdRes.document.id;
    assert.equal(createdRes.document.qualityReport.counts.critical, 0);

    // 5.3 Gắn bình luận BLOCKER -> Cổng phê duyệt phải chặn (HTTP 409)
    const cmtRes = await fetch(`${baseUrl}/api/documents/${docId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: 'QA Lead',
        role: 'QA',
        category: 'BLOCKER',
        quote: 'mỗi 24 giờ',
        text: 'Cần rút ngắn chu kỳ kiểm tra xuống mỗi 12 giờ.'
      })
    }).then((r) => r.json());
    assert.equal(cmtRes.ok, true);
    const cmtId = cmtRes.comment.id;

    const blockedSign = await fetch(`${baseUrl}/api/documents/${docId}/signoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewer: 'CTO',
        role: 'Approver',
        decision: 'APPROVED',
        forceOverride: false
      })
    });
    assert.equal(blockedSign.status, 409, 'Phải trả mã 409 khi còn Blocker chưa đóng');

    // 5.4 Tạo Track Change và Chấp nhận (ACCEPT) -> Văn bản được cập nhật tự động
    const sugRes = await fetch(`${baseUrl}/api/documents/${docId}/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: 'QA Lead',
        role: 'QA',
        originalText: 'định kỳ mỗi 24 giờ.',
        suggestedText: 'định kỳ mỗi 12 giờ.',
        reason: 'Tăng tần suất giám sát'
      })
    }).then((r) => r.json());
    assert.equal(sugRes.ok, true);

    const acceptRes = await fetch(
      `${baseUrl}/api/documents/${docId}/suggestions/${sugRes.suggestion.id}/decide`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'ACCEPT', actor: 'Tester' })
      }
    ).then((r) => r.json());
    assert.equal(acceptRes.ok, true);
    assert.match(acceptRes.document.content, /định kỳ mỗi 12 giờ\./);

    // 5.5 Đóng bình luận BLOCKER -> Phê duyệt APPROVED thành công 200 OK
    await fetch(`${baseUrl}/api/documents/${docId}/comments/${cmtId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'RESOLVED', actor: 'Tester' })
    });

    const okSign = await fetch(`${baseUrl}/api/documents/${docId}/signoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewer: 'CTO',
        role: 'Approver',
        decision: 'APPROVED',
        note: 'Đạt yêu cầu vận hành.'
      })
    }).then((r) => r.json());
    assert.equal(okSign.ok, true);
    assert.equal(okSign.document.status, 'APPROVED');

    // 5.6 Xuất .DOCX rồi nhập ngược lại qua /api/import-file
    const docxResp = await fetch(`${baseUrl}/api/documents/${docId}/export-docx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ includeComments: true, includeCertificate: true })
    });
    assert.equal(docxResp.status, 200);
    const exportedBuf = Buffer.from(await docxResp.arrayBuffer());
    assert.ok(exportedBuf.length > 600);

    const importResp = await fetch(`${baseUrl}/api/import-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'SOP_Da_Duyet.docx',
        base64Data: exportedBuf.toString('base64'),
        profileId: 'SOP_OPERATIONS'
      })
    }).then((r) => r.json());
    assert.equal(importResp.ok, true);
    assert.match(importResp.document.content, /định kỳ mỗi 12 giờ/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


test('6. PDF Codec thuần Node.js giải nén FlateDecode + tiếng Việt UTF-16BE và nhập qua /api/import-file', async () => {
  const pdfBuf = buildSimplePdfBuffer([
    'Đặc Tả Bảo Mật Hệ Thống eKYC v2.0',
    '1. Mục tiêu hệ thống',
    'Đảm bảo xác thực khuôn mặt chống giả mạo sinh trắc học dưới 400ms.'
  ]);

  const parsed = parsePdfBuffer(pdfBuf);
  assert.match(parsed.markdown, /# Đặc Tả Bảo Mật Hệ Thống eKYC v2\.0/);
  assert.match(parsed.markdown, /## 1\. Mục tiêu hệ thống/);
  assert.match(parsed.markdown, /chống giả mạo sinh trắc học dưới 400ms/);
});

test('7. Niêm phong Chữ ký số SHA-256 phát hiện sửa ngầm (TAMPERED) và khôi phục nguyên trạng 1-Click', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docreview-seal-'));
  const { server } = createAppServer(path.join(tmpDir, 'documents.json'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const cleanProposal = `# Đề Xuất Ngân Sách\n\n## 1. Bối cảnh & Nhu cầu\nNâng cấp máy chủ.\n\n## 2. Giải pháp Đề xuất\nThuê cụm GPU dự phòng.\n\n## 3. Lộ trình & Chi phí / ROI\nTổng ngân sách được duyệt: 50.000.000 VNĐ.\n\n## 4. Kết luận & Đề xuất Phê duyệt\nĐề nghị phê duyệt triển khai.`;

    const created = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Đề Xuất Hạ Tầng',
        profileId: 'GENERAL_EDITORIAL',
        content: cleanProposal
      })
    }).then((r) => r.json());
    const docId = created.document.id;

    // Ký APPROVED -> Phải sinh con dấu SHA-256 ở trạng thái VALID
    const signed = await fetch(`${baseUrl}/api/documents/${docId}/signoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewer: 'Giám Đốc Tài Chính',
        role: 'CFO',
        decision: 'APPROVED',
        note: 'Chấp thuận ngân sách 50 triệu.'
      })
    }).then((r) => r.json());

    assert.equal(signed.document.sealVerification.status, 'VALID');
    const originalHash = signed.document.sealVerification.sealedContentSha256;

    // Giả lập sửa ngầm con số từ 50.000.000 VNĐ lên 500.000.000 VNĐ sau khi đã ký
    const tamperedContent = cleanProposal.replace('50.000.000 VNĐ', '500.000.000 VNĐ');
    const afterEdit = await fetch(`${baseUrl}/api/documents/${docId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: tamperedContent, actor: 'Người sửa ngầm' })
    }).then((r) => r.json());

    assert.equal(afterEdit.document.sealVerification.status, 'TAMPERED', 'Phải báo động TAMPERED ngay lập tức!');
    assert.notEqual(afterEdit.document.sealVerification.liveContentSha256, originalHash);

    // Đối chiếu Diff với bản SEALED_SNAPSHOT
    const sealDiff = await fetch(`${baseUrl}/api/documents/${docId}/diff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseVersionId: 'SEALED_SNAPSHOT', targetVersionId: 'CURRENT' })
    }).then((r) => r.json());
    assert.equal(sealDiff.ok, true);
    assert.equal(sealDiff.diff.summary.changedBlocks, 1);

    // Khôi phục nguyên trạng 1-Click -> Trở về VALID 100%
    const restored = await fetch(`${baseUrl}/api/documents/${docId}/restore-seal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor: 'Compliance Auditor' })
    }).then((r) => r.json());

    assert.equal(restored.document.sealVerification.status, 'VALID');
    assert.match(restored.document.content, /50\.000\.000 VNĐ/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('8. Custom Rubric Builder & Glossary Enforcer chuẩn hóa thuật ngữ tự động (bỏ qua khối code)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docreview-gov-'));
  const { server } = createAppServer(path.join(tmpDir, 'documents.json'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // Tạo Custom Rubric mới
    const crRes = await fetch(`${baseUrl}/api/governance/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Chuẩn Bảo Mật Zero-Trust',
        icon: '🛡️',
        requiredSections: [{ label: 'Xác thực mTLS', keywords: ['mtls', 'chứng chỉ số'] }],
        forbiddenPhrases: ['tắt tường lửa']
      })
    }).then((r) => r.json());
    assert.equal(crRes.ok, true);
    const customProfileId = crRes.profile.id;

    // Tạo tài liệu vi phạm cả Cụm từ cấm và Thuật ngữ Glossary (nhưng có 1 chỗ nằm trong inline code `Smartpay`)
    const docRes = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Thiết Kế Mạng Nội Bộ',
        profileId: customProfileId,
        content: `# Thiết Kế\n\n## Xác thực mTLS\nCho phép user cuối kết nối cổng Smartpay (biến môi trường \`Smartpay_URL\`), tuyệt đối không tắt tường lửa.`
      })
    }).then((r) => r.json());

    const doc = docRes.document;
    assert.ok(doc.qualityReport.counts.glossary >= 2, 'Phải bắt được "user cuối" và "Smartpay" ngoài vùng code');
    assert.ok(
      doc.qualityReport.findings.some((f) => f.id.startsWith('custom-forbidden-')),
      'Phải bắt được cụm từ cấm "tắt tường lửa"'
    );

    // Gọi chuẩn hóa thuật ngữ 1-Click -> sửa ngoài văn bản nhưng giữ nguyên biến trong dấu backtick!
    const normRes = await fetch(`${baseUrl}/api/documents/${doc.id}/normalize-glossary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor: 'Tech Editor' })
    }).then((r) => r.json());

    assert.equal(normRes.replacementsCount, 2);
    assert.match(normRes.document.content, /người dùng cuối kết nối cổng SmartPay/);
    assert.match(normRes.document.content, /`Smartpay_URL`/, 'Không được sửa nhầm tên biến bên trong backtick code!');
    assert.equal(normRes.document.qualityReport.counts.glossary, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('9. Realtime SSE Hub phát sóng tức thì doc:updated giữa 2 phiên làm việc song song', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docreview-sse-'));
  const { server } = createAppServer(path.join(tmpDir, 'documents.json'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const abortCtrl = new AbortController();
  try {
    // Mở luồng SSE của Reviewer A (Tab 1)
    const sseResp = await fetch(
      `${baseUrl}/api/events?clientId=tab-A&author=MinhAnh&role=Lead&docId=doc-smartpay-prd`,
      { signal: abortCtrl.signal }
    );
    assert.equal(sseResp.status, 200);
    const reader = sseResp.body.getReader();
    const decoder = new TextDecoder();

    let collected = '';
    const readUntilMatch = async (pattern) => {
      for (let i = 0; i < 15; i++) {
        if (pattern.test(collected)) return collected;
        const { value, done } = await reader.read();
        if (done) break;
        collected += decoder.decode(value, { stream: true });
      }
      return collected;
    };

    await readUntilMatch(/event: connected/);

    // Reviewer B (Tab 2) gửi bình luận mới -> Tab 1 phải nhận được sự kiện doc:updated ngay lập tức!
    await fetch(`${baseUrl}/api/documents/doc-smartpay-prd/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': 'tab-B'
      },
      body: JSON.stringify({
        author: 'Quốc Bảo',
        role: 'Architect',
        category: 'QUESTION',
        text: 'Kiểm tra đồng bộ thời gian thực qua SSE!'
      })
    });

    const streamData = await readUntilMatch(/event: doc:updated/);
    assert.match(streamData, /event: doc:updated/);
    assert.match(streamData, /Quốc Bảo/);
  } finally {
    abortCtrl.abort();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


test('10. Két sắt PII (Reversible PII Vault) mã hóa thẻ [PII_...] và khôi phục nguyên bản 100%', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docreview-pii-'));
  const { server } = createAppServer(path.join(tmpDir, 'documents.json'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const rawDoc = `# Hồ Sơ Đối Tác\n\nLiên hệ: Ông Lê Minh — CCCD: 079095001122 — SĐT: 0912345678 — Email: minh.le@fintech-partner.vn — Mã số thuế: 0312345678 — STK: 190388997766.`;
    const created = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Thẩm định Đối tác', content: rawDoc })
    }).then((r) => r.json());
    const docId = created.document.id;
    assert.ok(created.document.detectedPii.length >= 4, 'Phải quét thấy ít nhất 4 trường PII');

    // Ẩn vào Két sắt
    const redacted = await fetch(`${baseUrl}/api/documents/${docId}/pii/redact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'TOKEN_VAULT', actor: 'DPO' })
    }).then((r) => r.json());

    assert.ok(redacted.redactedCount >= 4);
    assert.doesNotMatch(redacted.document.content, /079095001122/);
    assert.doesNotMatch(redacted.document.content, /0912345678/);
    assert.match(redacted.document.content, /\[PII_CCCD_01\]/);
    assert.match(redacted.document.content, /\[PII_PHONE_01\]/);

    // Khôi phục lại 100%
    const restored = await fetch(`${baseUrl}/api/documents/${docId}/pii/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor: 'DPO' })
    }).then((r) => r.json());

    assert.equal(restored.document.content, rawDoc);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('11. Readability Heatmap & Outline TOC phân loại đúng câu quá dài (>40 từ) và trích xuất mục lục', () => {
  const { analyzeReadabilityAndOutline } = require('../lib/readability-engine');
  const md = `# Chương 1: Tổng quan\n\nCâu này rất ngắn gọn.\n\n## 1.1. Quy trình phức tạp\nTrong trường hợp phát sinh yêu cầu thay đổi đột xuất từ phía đơn vị vận hành, việc tiến hành thực hiện rà soát lại toàn bộ cấu hình hạ tầng mạng, cơ sở dữ liệu phân tán, bộ nhớ đệm trung gian, hàng đợi thông điệp bất đồng bộ và các chính sách tường lửa bảo mật sẽ được thực hiện bởi nhóm trực chiến hạ tầng trước khi chuyển giao cho bộ phận kiểm thử độc lập.`;

  const res = analyzeReadabilityAndOutline(md);
  assert.equal(res.outline.length, 2);
  assert.equal(res.outline[0].title, 'Chương 1: Tổng quan');
  assert.ok(res.hardSentencesCount >= 1, 'Phải đánh dấu HARD cho câu dài trên 45 từ');
  assert.ok(res.ttsSegments.length >= 3);
});

test('12. Dashboard Thống kê SLA (/api/analytics) & Cầu nối trích xuất IOC OmniTrace hoạt động chuẩn xác', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docreview-analytics-'));
  const { server } = createAppServer(path.join(tmpDir, 'documents.json'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const anRes = await fetch(`${baseUrl}/api/analytics`).then((r) => r.json());
    assert.equal(anRes.ok, true);
    assert.equal(anRes.analytics.totalDocs, 4);
    assert.ok(anRes.analytics.avgQualityScore > 0);
    assert.equal(anRes.analytics.bottleneckDocs.length, 4);

    // Kiểm tra trích xuất IOC trên doc-ai-proposal (kể cả khi OmniTrace 4090 đang tắt vẫn trả về bộ IOC bóc tách cục bộ)
    const bridgeRes = await fetch(`${baseUrl}/api/documents/doc-ai-proposal/bridge/omnitrace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 59999 })
    }).then((r) => r.json());

    assert.equal(bridgeRes.ok, true);
    assert.ok(bridgeRes.bridge.extracted.emails.includes('lan.nguyen@omnicare-corp.vn'));
    assert.ok(bridgeRes.bridge.extracted.domains.includes('omnicare-corp.vn'));
    assert.ok(bridgeRes.bridge.extracted.phones.includes('0987654321'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
