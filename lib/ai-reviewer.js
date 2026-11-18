/**
 * 🤖 DocReview Studio — Optional AI Deep Reviewer (OpenAI & Google Gemini)
 * Chỉ kích hoạt khi người dùng chủ động bấm "AI Deep Review" và có API Key hợp lệ.
 * Không tự động gửi dữ liệu ra ngoài ở chế độ mặc định.
 */

function getEnvApiConfig() {
  return {
    hasOpenAI: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()),
    openAIModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    hasGemini: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()),
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  };
}

function buildReviewPrompt(title, profileName, content) {
  return `Bạn là Chuyên gia Rà soát & Nghiệm thu Tài liệu Cấp cao (Principal Document Reviewer).
Hãy rà soát tài liệu sau theo chuẩn "${profileName}".
Tên tài liệu: "${title}"

Yêu cầu trả về ĐÚNG MỘT JSON OBJECT hợp lệ (không bọc markdown fence ngoài nếu không cần) theo cấu trúc:
{
  "executiveSummary": "Nhận xét tổng quan ngắn gọn 2-3 câu bằng tiếng Việt",
  "comments": [
    {
      "category": "BLOCKER | CLARITY | QUESTION | NITPICK",
      "quote": "Trích dẫn nguyên văn một cụm từ/câu ngắn (10-120 ký tự) CÓ THẬT trong tài liệu",
      "text": "Nhận xét sắc bén, chỉ rõ vấn đề và hướng cải thiện"
    }
  ],
  "suggestions": [
    {
      "originalText": "Trích dẫn nguyên văn chính xác câu/cụm từ trong tài liệu cần sửa",
      "suggestedText": "Bản viết lại rõ ràng, định lượng và chuẩn mực hơn",
      "reason": "Lý do đề xuất sửa ngắn gọn"
    }
  ]
}
Giới hạn tối đa 4 comments và 4 suggestions chất lượng cao nhất. Mọi trường quote và originalText BẮT BUỘC phải khớp chính xác chuỗi con trong văn bản gốc dưới đây:

--- BẮT ĐẦU TÀI LIỆU ---
${String(content || '').slice(0, 24000)}
--- KẾT THÚC TÀI LIỆU ---`;
}

function extractJsonObject(rawText) {
  const cleaned = String(rawText || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('Phản hồi từ mô hình AI không đúng định dạng JSON.');
  }
}

async function runAiDeepReview({
  title,
  profileName,
  content,
  provider = 'auto',
  apiKey = '',
  model = ''
}) {
  const envCfg = getEnvApiConfig();
  let chosenProvider = provider;

  if (chosenProvider === 'auto') {
    if (apiKey && apiKey.startsWith('AIza')) chosenProvider = 'gemini';
    else if (apiKey && apiKey.startsWith('sk-')) chosenProvider = 'openai';
    else if (envCfg.hasGemini) chosenProvider = 'gemini';
    else if (envCfg.hasOpenAI) chosenProvider = 'openai';
    else {
      throw new Error(
        'Chưa cấu hình API Key cho AI Deep Review. Bạn có thể nhập khóa OpenAI (sk-...) hoặc Gemini (AIza...) trong hộp thoại AI, hoặc dùng Bộ chấm điểm Cục bộ 5 trục miễn phí 100%.'
      );
    }
  }

  const prompt = buildReviewPrompt(title, profileName, content);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);

  try {
    if (chosenProvider === 'gemini') {
      const key = (apiKey || process.env.GEMINI_API_KEY || '').trim();
      if (!key) throw new Error('Thiếu GEMINI_API_KEY.');
      const targetModel = (model || envCfg.geminiModel || 'gemini-2.5-flash').trim();
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        targetModel
      )}:generateContent?key=${encodeURIComponent(key)}`;

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json'
          }
        })
      });

      if (!resp.ok) {
        const errTxt = await resp.text();
        throw new Error(`Gemini API trả lỗi (${resp.status}): ${errTxt.slice(0, 180)}`);
      }
      const data = await resp.json();
      const rawOut = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const parsed = extractJsonObject(rawOut);
      return sanitizeAiResult(parsed, content, `Gemini (${targetModel})`);
    } else {
      const key = (apiKey || process.env.OPENAI_API_KEY || '').trim();
      if (!key) throw new Error('Thiếu OPENAI_API_KEY.');
      const targetModel = (model || envCfg.openAIModel || 'gpt-4o-mini').trim();

      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: targetModel,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'Bạn trả lời duy nhất bằng JSON hợp lệ theo schema được yêu cầu.' },
            { role: 'user', content: prompt }
          ]
        })
      });

      if (!resp.ok) {
        const errTxt = await resp.text();
        throw new Error(`OpenAI API trả lỗi (${resp.status}): ${errTxt.slice(0, 180)}`);
      }
      const data = await resp.json();
      const rawOut = data?.choices?.[0]?.message?.content || '{}';
      const parsed = extractJsonObject(rawOut);
      return sanitizeAiResult(parsed, content, `OpenAI (${targetModel})`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeAiResult(parsed, sourceContent, modelLabel) {
  const src = String(sourceContent || '');
  const validComments = (Array.isArray(parsed.comments) ? parsed.comments : [])
    .filter((c) => c && c.text)
    .slice(0, 5)
    .map((c) => ({
      category: ['BLOCKER', 'CLARITY', 'QUESTION', 'NITPICK', 'PRAISE'].includes(String(c.category).toUpperCase())
        ? String(c.category).toUpperCase()
        : 'CLARITY',
      quote: c.quote && src.includes(c.quote) ? c.quote : '',
      text: String(c.text).trim()
    }));

  const validSuggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
    .filter(
      (s) =>
        s &&
        s.originalText &&
        s.suggestedText &&
        s.originalText !== s.suggestedText &&
        src.includes(s.originalText)
    )
    .slice(0, 5)
    .map((s) => ({
      originalText: String(s.originalText),
      suggestedText: String(s.suggestedText),
      reason: String(s.reason || 'Đề xuất biên tập từ AI Reviewer').trim()
    }));

  return {
    modelLabel,
    executiveSummary: String(parsed.executiveSummary || 'Đã hoàn tất phân tích chuyên sâu bằng AI.').trim(),
    comments: validComments,
    suggestions: validSuggestions
  };
}

module.exports = {
  getEnvApiConfig,
  runAiDeepReview
};
