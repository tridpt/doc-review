/**
 * 🎧📊 DocReview Studio v3.0 — Readability Heatmap & Voice Proofreading Script Engine
 * - Phân tích độ phức tạp từng câu tiếng Việt/Anh (số từ/câu, mật độ mệnh đề dấu phẩy, cấu trúc bị động rườm rà)
 * - Phân loại câu: CLEAR (Dễ đọc), DENSE (Hơi dài / Nhiều vế), HARD (Quá dài > 40 từ / Dễ vấp khi đọc)
 * - Trích xuất Mục lục điều hướng nhanh (Outline TOC) & chuẩn bị danh sách khối đọc TTS
 */

const PASSIVE_VERBOSE_REGEX = /\b(được thực hiện bởi|việc tiến hành thực hiện|một cách có hiệu quả nhất|nhằm mục đích thực hiện việc)\b/i;

function splitSentences(text) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return [];
  // Tách câu giữ nguyên dấu kết câu (. ! ?), tránh tách nhầm số thập phân (18.4%) hoặc đánh số đầu dòng (1.)
  const rawParts = cleaned.split(/(?<=[.!?])\s+(?=[A-ZÀ-ỸĐ"“(\[])/g);
  return rawParts.map((s) => s.trim()).filter(Boolean);
}

function splitMarkdownIntoBlocks(markdown) {
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

function analyzeReadabilityAndOutline(markdown) {
  const blocks = splitMarkdownIntoBlocks(markdown);

  const outline = [];
  const paragraphHeatmaps = [];
  const ttsSegments = [];

  let totalSentences = 0;
  let totalSentenceWords = 0;
  let denseSentencesCount = 0;
  let hardSentencesCount = 0;

  blocks.forEach((rawBlock, idx) => {
    const paraIndex = idx + 1;

    // 1. Bỏ qua khối code hoặc sơ đồ mermaid khi tính độ dễ đọc
    if (rawBlock.startsWith('```')) {
      const langMatch = rawBlock.match(/^```(\w+)/);
      const lang = langMatch ? langMatch[1].toLowerCase() : '';
      paragraphHeatmaps.push({
        paraIndex,
        type: lang === 'mermaid' || lang === 'diagram' ? 'DIAGRAM' : 'CODE',
        level: 'CLEAR',
        sentences: []
      });
      return;
    }

    // 2. Bảng Markdown
    if (rawBlock.startsWith('|') && rawBlock.includes('|')) {
      paragraphHeatmaps.push({
        paraIndex,
        type: 'TABLE',
        level: 'CLEAR',
        sentences: []
      });
      return;
    }

    // 3. Heading -> đưa vào Cây Mục lục (Outline TOC)
    const hMatch = rawBlock.match(/^(#{1,4})\s+(.+)$/);
    if (hMatch && !rawBlock.includes('\n')) {
      const level = hMatch[1].length;
      const cleanTitle = hMatch[2].replace(/\*\*|\*|`/g, '').trim();
      outline.push({
        paraIndex,
        level,
        title: cleanTitle
      });
      ttsSegments.push({
        paraIndex,
        isHeading: true,
        text: cleanTitle
      });
      paragraphHeatmaps.push({
        paraIndex,
        type: 'HEADING',
        level: 'CLEAR',
        sentences: [{ text: cleanTitle, wordCount: (cleanTitle.match(/\S+/g) || []).length, grade: 'CLEAR' }]
      });
      return;
    }

    // 4. Đoạn văn bản / Danh sách -> Phân tích từng câu
    const plainForSpeech = rawBlock
      .replace(/^[-*+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\*\*|\*|`+/g, '')
      .trim();

    if (plainForSpeech) {
      ttsSegments.push({
        paraIndex,
        isHeading: false,
        text: plainForSpeech
      });
    }

    const sentences = splitSentences(plainForSpeech);
    let worstInPara = 'CLEAR';

    const analyzedSentences = sentences.map((s) => {
      const words = s.match(/\S+/g) || [];
      const wCount = words.length;
      const commaCount = (s.match(/[,;]/g) || []).length;
      const hasVerbosePassive = PASSIVE_VERBOSE_REGEX.test(s);

      totalSentences++;
      totalSentenceWords += wCount;

      let grade = 'CLEAR';
      let reason = 'Câu ngắn gọn, nhịp đọc rõ ràng';

      if (wCount > 42 || (wCount > 32 && commaCount >= 4)) {
        grade = 'HARD';
        hardSentencesCount++;
        worstInPara = 'HARD';
        reason = `Câu quá dài (${wCount} từ, ${commaCount} dấu ngắt) — dễ hụt hơi & hiểu nhầm ý, nên tách làm 2 câu.`;
      } else if (wCount >= 28 || commaCount >= 3 || hasVerbosePassive) {
        grade = 'DENSE';
        denseSentencesCount++;
        if (worstInPara === 'CLEAR') worstInPara = 'DENSE';
        reason = hasVerbosePassive
          ? `Cấu trúc câu bị động/hành chính rườm rà (${wCount} từ) — nên chuyển sang câu chủ động trực diện.`
          : `Câu khá dày ý (${wCount} từ) — cân nhắc rút gọn bớt mệnh đề phụ.`;
      }

      return {
        text: s,
        wordCount: wCount,
        commaCount,
        grade,
        reason
      };
    });

    paragraphHeatmaps.push({
      paraIndex,
      type: 'TEXT',
      level: worstInPara,
      sentences: analyzedSentences
    });
  });

  const avgSentenceWords = totalSentences > 0 ? Number((totalSentenceWords / totalSentences).toFixed(1)) : 0;
  const rawScore = 100 - hardSentencesCount * 11 - denseSentencesCount * 4 - Math.max(0, avgSentenceWords - 22) * 1.5;
  const readabilityScore = Math.max(25, Math.min(100, Math.round(rawScore)));

  let readabilityLabel = 'Rất mạch lạc, dễ đọc hiểu';
  if (readabilityScore < 60) readabilityLabel = 'Nhiều câu dài phức tạp — Nên biên tập ngắt câu';
  else if (readabilityScore < 80) readabilityLabel = 'Tương đối rõ ràng — Có một vài câu dày ý';

  return {
    readabilityScore,
    readabilityLabel,
    avgSentenceWords,
    totalSentences,
    denseSentencesCount,
    hardSentencesCount,
    outline,
    paragraphHeatmaps,
    ttsSegments
  };
}

module.exports = {
  analyzeReadabilityAndOutline,
  splitMarkdownIntoBlocks,
  splitSentences
};
