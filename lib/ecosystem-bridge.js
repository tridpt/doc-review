/**
 * 🔗 DocReview Studio v3.0 — Cross-App Ecosystem Bridge & Workspace SLA Analytics
 * - Liên thông trực tiếp với ContractShield (Port 4175) để quét 14 nhóm điều khoản bẫy pháp lý Việt Nam
 * - Liên thông trực tiếp với OmniTrace OSINT (Port 4090) để đẩy IOC / thực thể đối tác (Domain, Email, SĐT, MST, IP) lên đồ thị điều tra
 * - Tính toán Dashboard Thống kê SLA & Điểm nghẽn chất lượng toàn kho tài liệu
 */

const http = require('node:http');
const { URL } = require('node:url');

function localJsonRequest(urlStr, method = 'GET', payload = null, timeoutMs = 4500) {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      const bodyBuf = payload ? Buffer.from(JSON.stringify(payload), 'utf8') : null;
      const req = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname + u.search,
          method,
          headers: bodyBuf
            ? { 'Content-Type': 'application/json', 'Content-Length': bodyBuf.length }
            : {},
          timeout: timeoutMs
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              resolve({ ok: res.statusCode < 400, status: res.statusCode, data: parsed });
            } catch {
              resolve({ ok: false, status: res.statusCode, error: 'Phản hồi JSON không hợp lệ' });
            }
          });
        }
      );
      req.on('error', (err) => resolve({ ok: false, offline: true, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, offline: true, error: 'Timeout kết nối dịch vụ' });
      });
      if (bodyBuf) req.write(bodyBuf);
      req.end();
    } catch (err) {
      resolve({ ok: false, offline: true, error: err.message });
    }
  });
}

function extractDocumentIOCs(text) {
  const src = String(text || '');
  const emails = [...new Set(src.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g) || [])];
  const phones = [...new Set(src.match(/\b(?:\+84|0)(?:3|5|7|8|9)\d{8}\b/g) || [])];
  const urls = [...new Set(src.match(/https?:\/\/[^\s)`"'>]+/gi) || [])];
  const ips = [...new Set(src.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [])];
  const taxIds = [...new Set(src.match(/(?<=(?:Mã số thuế|MST)\s*[:=-]?\s*)\b\d{10}(?:-\d{3})?\b/gi) || [])];

  const domainsFromEmails = emails
    .map((e) => e.split('@')[1]?.toLowerCase())
    .filter((d) => d && !/^(gmail\.com|yahoo\.com|outlook\.com|hotmail\.com)$/i.test(d));
  const domainsFromUrls = urls
    .map((u) => {
      try {
        return new URL(u).hostname.toLowerCase();
      } catch {
        return null;
      }
    })
    .filter((h) => h && h !== 'localhost' && h !== '127.0.0.1' && h !== 'example.com');

  const domains = [...new Set([...domainsFromEmails, ...domainsFromUrls])];
  const totalCount = emails.length + phones.length + domains.length + ips.length + taxIds.length;

  return {
    totalCount,
    emails,
    phones,
    domains,
    ips,
    taxIds,
    urls
  };
}

async function bridgeToContractShield(doc, contractShieldPort = 4175) {
  const res = await localJsonRequest(`http://127.0.0.1:${contractShieldPort}/api/audit`, 'POST', {
    title: doc.title,
    text: doc.content,
    saveHistory: true
  });

  if (!res.ok) {
    return {
      connected: false,
      targetPort: contractShieldPort,
      message:
        'Máy chủ ContractShield (Port 4175) hiện chưa bật. Bạn có thể bật 1-Click từ NexusHub (Port 4000) hoặc chạy node d:\\AI_App\\contract-intelligence\\server.js.',
      report: null
    };
  }

  return {
    connected: true,
    targetPort: contractShieldPort,
    targetUrl: `http://localhost:${contractShieldPort}`,
    report: res.data.report,
    partnerIOCs: res.data.partnerIOCs || null
  };
}

async function bridgeToOmniTrace(doc, omnitracePort = 4090) {
  const extracted = extractDocumentIOCs(doc.content);
  const flatFeed = [
    ...extracted.domains,
    ...extracted.emails,
    ...extracted.phones,
    ...extracted.ips,
    ...extracted.taxIds
  ].join(' ');

  const res = await localJsonRequest(`http://127.0.0.1:${omnitracePort}/api/osint/ioc`, 'POST', {
    text: flatFeed || doc.content.slice(0, 4000),
    pushToGraph: true,
    sourceTitle: `DocReview_${doc.id}`
  });

  return {
    connected: res.ok,
    targetPort: omnitracePort,
    targetUrl: `http://localhost:${omnitracePort}`,
    extracted,
    remoteResponse: res.ok ? res.data : null,
    message: res.ok
      ? `Đã đồng bộ ${extracted.totalCount} thực thể/IOC từ tài liệu sang Đồ thị Điều tra OmniTrace OSINT (Port ${omnitracePort})!`
      : `Đã bóc tách cục bộ ${extracted.totalCount} thực thể (Máy chủ OmniTrace Port ${omnitracePort} hiện đang tắt — bật trên NexusHub để xem đồ thị).`
  };
}

function computeWorkspaceAnalytics(store) {
  const enrichedDocs = store.documents.map((d) => store.enrichDocument(d));
  const totalDocs = enrichedDocs.length;

  if (totalDocs === 0) {
    return {
      totalDocs: 0,
      avgQualityScore: 0,
      approvedCount: 0,
      sealedValidCount: 0,
      tamperedCount: 0,
      totalOpenBlockers: 0,
      totalPendingSuggestions: 0,
      avgAxes: { STRUCTURE: 0, CLARITY: 0, CONSISTENCY: 0, ACTIONABILITY: 0, SAFETY: 0 },
      statusBreakdown: {},
      bottleneckDocs: [],
      axisFindingTotals: {}
    };
  }

  let scoreSum = 0;
  let approvedCount = 0;
  let sealedValidCount = 0;
  let tamperedCount = 0;
  let totalOpenBlockers = 0;
  let totalPendingSuggestions = 0;

  const axesSum = { STRUCTURE: 0, CLARITY: 0, CONSISTENCY: 0, ACTIONABILITY: 0, SAFETY: 0 };
  const statusBreakdown = { DRAFT: 0, IN_REVIEW: 0, CHANGES_REQUESTED: 0, APPROVED: 0 };
  const axisFindingTotals = { STRUCTURE: 0, CLARITY: 0, CONSISTENCY: 0, ACTIONABILITY: 0, SAFETY: 0 };

  for (const d of enrichedDocs) {
    const q = d.qualityReport;
    scoreSum += q.overallScore;
    if (d.status === 'APPROVED') approvedCount++;
    if (d.sealVerification?.status === 'VALID') sealedValidCount++;
    if (d.sealVerification?.status === 'TAMPERED') tamperedCount++;

    totalOpenBlockers += d.readinessGate.openBlockersCount;
    totalPendingSuggestions += d.readinessGate.pendingSuggestionsCount;

    statusBreakdown[d.status] = (statusBreakdown[d.status] || 0) + 1;

    for (const k of Object.keys(axesSum)) {
      axesSum[k] += q.axes[k] || 0;
    }
    for (const f of q.findings || []) {
      axisFindingTotals[f.axis] = (axisFindingTotals[f.axis] || 0) + 1;
    }
  }

  const avgAxes = {};
  for (const k of Object.keys(axesSum)) {
    avgAxes[k] = Math.round(axesSum[k] / totalDocs);
  }

  const bottleneckDocs = enrichedDocs
    .map((d) => ({
      id: d.id,
      title: d.title,
      owner: d.owner,
      status: d.status,
      sealStatus: d.sealVerification?.status || 'UNSEALED',
      overallScore: d.qualityReport.overallScore,
      grade: d.qualityReport.grade,
      openBlockers: d.readinessGate.openBlockersCount,
      pendingSuggestions: d.readinessGate.pendingSuggestionsCount,
      criticalFindings: d.readinessGate.criticalFindingsCount,
      piiCount: (d.piiVault || []).length
    }))
    .sort(
      (a, b) =>
        (b.sealStatus === 'TAMPERED' ? 100 : 0) - (a.sealStatus === 'TAMPERED' ? 100 : 0) ||
        b.openBlockers - a.openBlockers ||
        a.overallScore - b.overallScore
    );

  return {
    totalDocs,
    avgQualityScore: Math.round(scoreSum / totalDocs),
    approvedCount,
    sealedValidCount,
    tamperedCount,
    totalOpenBlockers,
    totalPendingSuggestions,
    avgAxes,
    statusBreakdown,
    axisFindingTotals,
    bottleneckDocs
  };
}

module.exports = {
  extractDocumentIOCs,
  bridgeToContractShield,
  bridgeToOmniTrace,
  computeWorkspaceAnalytics
};
