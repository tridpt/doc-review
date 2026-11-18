/**
 * 📄 DocReview Studio — Native Zero-Dependency .DOCX Codec (OOXML <-> Markdown + Word Comments)
 * - Đọc tệp .DOCX chuẩn Central Directory (hỗ trợ cả Word, LibreOffice, Google Docs)
 * - Chuyển đổi Heading, Bảng biểu (<w:tbl>), Danh sách, Đậm/Nghiêng sang Markdown
 * - Trích xuất chú thích sẵn có trong Word (word/comments.xml) thành luồng Comment của DocReview
 * - Xuất ngược Markdown + Comment nội tuyến + Phụ lục Nghiệm thu sang tệp .DOCX chuẩn Microsoft Word
 */

const zlib = require('node:zlib');

function decodeXmlEntities(str) {
  return String(str || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, '&');
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ============================================================================
// 1. ZIP READER (CENTRAL DIRECTORY FIRST + LOCAL HEADER FALLBACK)
// ============================================================================

function unzipEntries(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) {
    throw new Error('Tệp tải lên không phải cấu trúc nén ZIP/.DOCX hợp lệ.');
  }

  const entries = new Map();

  // Tìm End of Central Directory (0x06054b50) từ cuối buffer ngược lên
  let eocdOffset = -1;
  const minSearch = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minSearch; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset !== -1) {
    const totalEntries = buf.readUInt16LE(eocdOffset + 10);
    const cdOffset = buf.readUInt32LE(eocdOffset + 16);
    let ptr = cdOffset;

    for (let idx = 0; idx < totalEntries && ptr + 46 <= buf.length; idx++) {
      if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
      const compressionMethod = buf.readUInt16LE(ptr + 10);
      const compressedSize = buf.readUInt32LE(ptr + 20);
      const nameLen = buf.readUInt16LE(ptr + 28);
      const extraLen = buf.readUInt16LE(ptr + 30);
      const commentLen = buf.readUInt16LE(ptr + 32);
      const localHeaderOffset = buf.readUInt32LE(ptr + 42);

      const fileName = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');
      ptr += 46 + nameLen + extraLen + commentLen;

      if (localHeaderOffset + 30 <= buf.length && buf.readUInt32LE(localHeaderOffset) === 0x04034b50) {
        const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
        const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const dataEnd = dataStart + compressedSize;
        if (dataEnd <= buf.length) {
          const rawSlice = buf.subarray(dataStart, dataEnd);
          const content =
            compressionMethod === 8
              ? zlib.inflateRawSync(rawSlice)
              : compressionMethod === 0
              ? Buffer.from(rawSlice)
              : null;
          if (content) entries.set(fileName, content);
        }
      }
    }
  }

  // Fallback quét tuần tự Local File Header nếu cần
  if (entries.size === 0) {
    let offset = 0;
    while (offset + 30 <= buf.length) {
      if (buf.readUInt32LE(offset) !== 0x04034b50) break;
      const compressionMethod = buf.readUInt16LE(offset + 8);
      const compressedSize = buf.readUInt32LE(offset + 18);
      const nameLen = buf.readUInt16LE(offset + 26);
      const extraLen = buf.readUInt16LE(offset + 28);
      const fileName = buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
      const dataStart = offset + 30 + nameLen + extraLen;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > buf.length) break;
      const rawSlice = buf.subarray(dataStart, dataEnd);
      if (compressionMethod === 8) {
        entries.set(fileName, zlib.inflateRawSync(rawSlice));
      } else if (compressionMethod === 0) {
        entries.set(fileName, Buffer.from(rawSlice));
      }
      offset = dataEnd;
    }
  }

  return entries;
}

// ============================================================================
// 2. PARSE .DOCX -> MARKDOWN + EXTRACTED WORD COMMENTS
// ============================================================================

function extractPlainTextFromXmlFragment(xmlFrag) {
  const withBreaks = String(xmlFrag || '')
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n');
  return decodeXmlEntities(withBreaks.replace(/<[^>]+>/g, ''));
}

function parseParagraphXml(pXml, activeCommentRanges, commentQuotes) {
  // Kiểm tra style Heading và List
  const pPrMatch = pXml.match(/<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/);
  const pPr = pPrMatch ? pPrMatch[1] : '';
  const styleMatch = pPr.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/i);
  const styleVal = styleMatch ? styleMatch[1] : '';
  const isList = /<w:numPr\b/.test(pPr);

  let headingLevel = 0;
  if (/^(Title|Heading\s*1|Heading1|1)$/i.test(styleVal)) headingLevel = 1;
  else if (/^(Subtitle|Heading\s*2|Heading2|2)$/i.test(styleVal)) headingLevel = 2;
  else if (/^(Heading\s*3|Heading3|3)$/i.test(styleVal)) headingLevel = 3;
  else if (/^(Heading\s*4|Heading4|4)$/i.test(styleVal)) headingLevel = 4;

  // Duyệt các token bên trong đoạn để bắt commentRangeStart/End và runs
  const tokenRegex =
    /<w:commentRangeStart\b[^>]*w:id="([^"]+)"[^>]*\/>|<w:commentRangeEnd\b[^>]*w:id="([^"]+)"[^>]*\/>|<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;

  let m;
  let lineText = '';
  while ((m = tokenRegex.exec(pXml)) !== null) {
    if (m[1] !== undefined) {
      activeCommentRanges.add(m[1]);
      if (!commentQuotes.has(m[1])) commentQuotes.set(m[1], '');
    } else if (m[2] !== undefined) {
      activeCommentRanges.delete(m[2]);
    } else if (m[3] !== undefined) {
      const rXml = m[3];
      const rPrMatch = rXml.match(/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/);
      const rPr = rPrMatch ? rPrMatch[1] : '';
      const rawRunText = extractPlainTextFromXmlFragment(rXml);
      if (!rawRunText) continue;

      for (const cid of activeCommentRanges) {
        commentQuotes.set(cid, (commentQuotes.get(cid) || '') + rawRunText);
      }

      const isBold = /<w:b(?:\s*\/>|\s+w:val="(?:true|1)")/i.test(rPr) && headingLevel === 0;
      const isItalic = /<w:i(?:\s*\/>|\s+w:val="(?:true|1)")/i.test(rPr);

      let formatted = rawRunText;
      const trimmed = rawRunText.trim();
      if (trimmed && (isBold || isItalic)) {
        const lead = rawRunText.slice(0, rawRunText.indexOf(trimmed));
        const trail = rawRunText.slice(lead.length + trimmed.length);
        let core = trimmed;
        if (isBold && isItalic) core = `***${core}***`;
        else if (isBold) core = `**${core}**`;
        else if (isItalic) core = `*${core}*`;
        formatted = `${lead}${core}${trail}`;
      }
      lineText += formatted;
    }
  }

  // Gộp các chuỗi ** liền kề (ví dụ **Từ 1 ****Từ 2** -> **Từ 1 Từ 2**)
  lineText = lineText.replace(/\*\*(\s*)\*\*/g, '$1').trim();
  if (!lineText) return '';

  if (headingLevel > 0) {
    // Bỏ dấu ** dư thừa trong tiêu đề
    const cleanHeading = lineText.replace(/\*\*/g, '').trim();
    return `${'#'.repeat(headingLevel)} ${cleanHeading}`;
  }
  if (isList) {
    return `- ${lineText}`;
  }
  return lineText;
}

function parseTableXml(tblXml) {
  const rows = [];
  const rowRegex = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
  let rMatch;
  while ((rMatch = rowRegex.exec(tblXml)) !== null) {
    const cells = [];
    const cellRegex = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
    let cMatch;
    while ((cMatch = cellRegex.exec(rMatch[1])) !== null) {
      const pTexts = [];
      const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
      let pMatch;
      while ((pMatch = pRegex.exec(cMatch[1])) !== null) {
        const txt = extractPlainTextFromXmlFragment(pMatch[1]).trim();
        if (txt) pTexts.push(txt);
      }
      cells.push(pTexts.join(' ').replace(/\|/g, '\\|'));
    }
    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) return '';
  const colCount = Math.max(...rows.map((r) => r.length));
  const normalized = rows.map((r) => {
    const padded = [...r];
    while (padded.length < colCount) padded.push('');
    return padded;
  });

  const mdLines = [];
  mdLines.push(`| ${normalized[0].join(' | ')} |`);
  mdLines.push(`| ${normalized[0].map(() => '---').join(' | ')} |`);
  for (let i = 1; i < normalized.length; i++) {
    mdLines.push(`| ${normalized[i].join(' | ')} |`);
  }
  return mdLines.join('\n');
}

function parseDocxBuffer(buf) {
  const entries = unzipEntries(buf);
  const docBuf = entries.get('word/document.xml');
  if (!docBuf) {
    throw new Error('Không tìm thấy thành phần word/document.xml trong tệp .docx.');
  }

  const docXml = docBuf.toString('utf8');
  const bodyMatch = docXml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/);
  const bodyXml = bodyMatch ? bodyMatch[1] : docXml;

  const activeCommentRanges = new Set();
  const commentQuotes = new Map();
  const blocks = [];

  // Quét theo đúng thứ tự xuất hiện của <w:tbl> hoặc <w:p> cấp cao nhất
  let pos = 0;
  while (pos < bodyXml.length) {
    const nextP = bodyXml.indexOf('<w:p', pos);
    const nextTbl = bodyXml.indexOf('<w:tbl', pos);

    if (nextP === -1 && nextTbl === -1) break;

    if (nextTbl !== -1 && (nextP === -1 || nextTbl < nextP)) {
      const endTbl = bodyXml.indexOf('</w:tbl>', nextTbl);
      if (endTbl === -1) break;
      const tblXml = bodyXml.slice(nextTbl, endTbl + 8);
      const mdTable = parseTableXml(tblXml);
      if (mdTable) blocks.push(mdTable);
      pos = endTbl + 8;
    } else {
      // Đảm bảo đây là thẻ <w:p> hoặc <w:p ...> chứ không phải <w:pPr>
      const afterTag = bodyXml[nextP + 4];
      if (afterTag !== '>' && afterTag !== ' ' && afterTag !== '/') {
        pos = nextP + 4;
        continue;
      }
      if (bodyXml.slice(nextP, nextP + 20).includes('/>') && bodyXml.indexOf('>', nextP) === bodyXml.indexOf('/>', nextP) + 1) {
        pos = bodyXml.indexOf('/>', nextP) + 2;
        continue;
      }
      const endP = bodyXml.indexOf('</w:p>', nextP);
      if (endP === -1) break;
      const pXml = bodyXml.slice(nextP, endP + 6);
      const mdPara = parseParagraphXml(pXml, activeCommentRanges, commentQuotes);
      if (mdPara) blocks.push(mdPara);
      pos = endP + 6;
    }
  }

  // Đọc thêm word/comments.xml nếu tệp Word có sẵn chú thích
  const importedComments = [];
  const commentsBuf = entries.get('word/comments.xml');
  if (commentsBuf) {
    const commentsXml = commentsBuf.toString('utf8');
    const cRegex = /<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g;
    let cMatch;
    while ((cMatch = cRegex.exec(commentsXml)) !== null) {
      const attrs = cMatch[1];
      const idMatch = attrs.match(/w:id="([^"]+)"/);
      const authorMatch = attrs.match(/w:author="([^"]+)"/);
      const dateMatch = attrs.match(/w:date="([^"]+)"/);
      const cid = idMatch ? idMatch[1] : String(importedComments.length + 1);
      const text = extractPlainTextFromXmlFragment(cMatch[2]).trim();
      if (text) {
        importedComments.push({
          wordCommentId: cid,
          author: authorMatch ? decodeXmlEntities(authorMatch[1]) : 'Word Reviewer',
          role: 'Reviewer (Imported .DOCX)',
          category: 'CLARITY',
          quote: (commentQuotes.get(cid) || '').trim(),
          text,
          createdAt: dateMatch ? dateMatch[1] : new Date().toISOString()
        });
      }
    }
  }

  return {
    markdown: blocks.join('\n\n'),
    importedComments
  };
}

// ============================================================================
// 3. NATIVE ZIP BUILDER + MARKDOWN & COMMENTS -> .DOCX EXPORTER
// ============================================================================

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZipBuffer(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const rawBuf = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const compressedBuf = zlib.deflateRawSync(rawBuf);
    const crc = crc32(rawBuf);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8); // deflate method (8)
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedBuf.length, 18);
    localHeader.writeUInt32LE(rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressedBuf);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedBuf.length, 20);
    centralHeader.writeUInt32LE(rawBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += 30 + nameBuf.length + compressedBuf.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

function buildInlineRunsXml(text, baseProps = {}) {
  const font = baseProps.font || 'Times New Roman';
  const size = baseProps.size || 24; // 12pt = 24 half-points
  const color = baseProps.color || '1E293B';
  const forceBold = Boolean(baseProps.bold);

  // Tách token inline **bold**, *italic*, `code`
  const regex = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  const parts = String(text || '').split(regex);
  const runs = [];

  for (const part of parts) {
    if (!part) continue;
    let content = part;
    let isBold = forceBold;
    let isItalic = Boolean(baseProps.italic);
    let runFont = font;
    let runColor = color;
    let shading = '';

    if (part.startsWith('***') && part.endsWith('***') && part.length > 6) {
      content = part.slice(3, -3);
      isBold = true;
      isItalic = true;
    } else if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      content = part.slice(2, -2);
      isBold = true;
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      content = part.slice(1, -1);
      isItalic = true;
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      content = part.slice(1, -1);
      runFont = 'Consolas';
      runColor = '0F172A';
      shading = '<w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>';
    }

    runs.push(`<w:r>
      <w:rPr>
        <w:rFonts w:ascii="${runFont}" w:hAnsi="${runFont}" w:cs="${runFont}"/>
        ${isBold ? '<w:b/>' : ''}
        ${isItalic ? '<w:i/>' : ''}
        <w:color w:val="${runColor}"/>
        <w:sz w:val="${size}"/>
        ${shading}
      </w:rPr>
      <w:t xml:space="preserve">${escapeXml(content)}</w:t>
    </w:r>`);
  }

  return runs.join('');
}

function buildParagraphWithCommentsXml(rawText, options, pendingComments) {
  const matchedHere = [];
  const plainForMatch = rawText.replace(/\*\*|\*|`/g, '');

  if (Array.isArray(pendingComments)) {
    for (const c of pendingComments) {
      if (c._attached) continue;
      if (c.quote && plainForMatch.includes(c.quote)) {
        c._attached = true;
        matchedHere.push(c);
      }
    }
  }

  const pStyleTag = options.pStyle ? `<w:pStyle w:val="${options.pStyle}"/>` : '';
  const alignTag = options.align ? `<w:jc w:val="${options.align}"/>` : '';
  const indentTag = options.indentLeft ? `<w:ind w:left="${options.indentLeft}"/>` : '';
  const shadingTag = options.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${options.fill}"/>` : '';
  const spacingAfter = options.spacingAfter ?? 140;
  const spacingBefore = options.spacingBefore ?? 0;

  if (matchedHere.length === 0) {
    return `<w:p>
      <w:pPr>
        ${pStyleTag}
        ${alignTag}
        ${indentTag}
        ${shadingTag}
        <w:spacing w:before="${spacingBefore}" w:after="${spacingAfter}" w:line="276" w:lineRule="auto"/>
      </w:pPr>
      ${buildInlineRunsXml(rawText, options)}
    </w:p>`;
  }

  // Nếu chỉ có 1 comment khớp đúng chuỗi con không chứa markdown phức tạp, bọc đúng vị trí quote
  const first = matchedHere[0];
  if (matchedHere.length === 1 && rawText.includes(first.quote)) {
    const idx = rawText.indexOf(first.quote);
    const before = rawText.slice(0, idx);
    const target = rawText.slice(idx, idx + first.quote.length);
    const after = rawText.slice(idx + first.quote.length);

    return `<w:p>
      <w:pPr>
        ${pStyleTag}
        ${alignTag}
        ${indentTag}
        ${shadingTag}
        <w:spacing w:before="${spacingBefore}" w:after="${spacingAfter}" w:line="276" w:lineRule="auto"/>
      </w:pPr>
      ${before ? buildInlineRunsXml(before, options) : ''}
      <w:commentRangeStart w:id="${first._numId}"/>
      ${buildInlineRunsXml(target, options)}
      <w:commentRangeEnd w:id="${first._numId}"/>
      <w:r><w:commentReference w:id="${first._numId}"/></w:r>
      ${after ? buildInlineRunsXml(after, options) : ''}
    </w:p>`;
  }

  // Trường hợp nhiều comment cùng đoạn hoặc có markdown xen giữa: neo trên cả đoạn
  const starts = matchedHere.map((c) => `<w:commentRangeStart w:id="${c._numId}"/>`).join('');
  const ends = matchedHere
    .map((c) => `<w:commentRangeEnd w:id="${c._numId}"/><w:r><w:commentReference w:id="${c._numId}"/></w:r>`)
    .join('');

  return `<w:p>
    <w:pPr>
      ${pStyleTag}
      ${alignTag}
      ${indentTag}
      ${shadingTag}
      <w:spacing w:before="${spacingBefore}" w:after="${spacingAfter}" w:line="276" w:lineRule="auto"/>
    </w:pPr>
    ${starts}
    ${buildInlineRunsXml(rawText, options)}
    ${ends}
  </w:p>`;
}

function buildTableXml(tableLines) {
  const parsedRows = [];
  for (let i = 0; i < tableLines.length; i++) {
    const line = tableLines[i].trim();
    const inner = line.replace(/^\|/, '').replace(/\|$/, '');
    const cells = inner.split('|').map((c) => c.trim());
    // Bỏ qua dòng phân cách | --- | --- |
    if (i === 1 && cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    parsedRows.push(cells);
  }
  if (parsedRows.length === 0) return '';

  const rowsXml = parsedRows.map((cells, rIdx) => {
    const isHeader = rIdx === 0;
    const cellsXml = cells
      .map(
        (cellText) => `<w:tc>
          <w:tcPr>
            <w:tcBorders>
              <w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
              <w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
              <w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
              <w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
            </w:tcBorders>
            ${isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="EFF6FF"/>' : ''}
          </w:tcPr>
          <w:p>
            <w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr>
            ${buildInlineRunsXml(cellText, {
              bold: isHeader,
              size: 22,
              color: isHeader ? '1E3A8A' : '1E293B'
            })}
          </w:p>
        </w:tc>`
      )
      .join('');
    return `<w:tr>${cellsXml}</w:tr>`;
  });

  return `<w:tbl>
    <w:tblPr>
      <w:tblW w:w="5000" w:type="pct"/>
    </w:tblPr>
    ${rowsXml.join('\n')}
  </w:tbl>`;
}

function buildDocxBuffer({
  title,
  markdown,
  comments = [],
  includeComments = true,
  includeCertificate = true,
  qualityReport = null,
  approvals = [],
  status = 'DRAFT',
  versionLabel = 'v1.0',
  sealVerification = null
}) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const activeComments = includeComments
    ? comments
        .filter((c) => c && c.status !== 'RESOLVED' && c.text)
        .map((c, idx) => ({ ...c, _numId: idx + 1, _attached: false }))
    : [];

  const bodyElements = [];

  // Banner tiêu đề tài liệu nếu dòng đầu tiên chưa phải H1 trùng tên
  const firstNonEmpty = lines.find((l) => l.trim().length > 0) || '';
  if (title && !firstNonEmpty.startsWith('# ')) {
    bodyElements.push(
      buildParagraphWithCommentsXml(title, {
        pStyle: 'Heading1',
        bold: true,
        size: 34,
        color: '0F172A',
        spacingAfter: 220
      })
    );
  }

  let i = 0;
  let inCodeBlock = false;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      i++;
      continue;
    }

    if (inCodeBlock) {
      bodyElements.push(
        buildParagraphWithCommentsXml(rawLine || ' ', {
          font: 'Consolas',
          size: 20,
          color: '0F172A',
          fill: 'F8FAFC',
          indentLeft: 360,
          spacingAfter: 40
        })
      );
      i++;
      continue;
    }

    // Gom bảng Markdown
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const tblXml = buildTableXml(tableLines);
      if (tblXml) bodyElements.push(tblXml);
      continue;
    }

    if (!trimmed) {
      i++;
      continue;
    }

    if (trimmed.startsWith('# ')) {
      bodyElements.push(
        buildParagraphWithCommentsXml(
          trimmed.slice(2).trim(),
          { pStyle: 'Heading1', bold: true, size: 32, color: '1E3A8A', spacingBefore: 240, spacingAfter: 160 },
          activeComments
        )
      );
    } else if (trimmed.startsWith('## ')) {
      bodyElements.push(
        buildParagraphWithCommentsXml(
          trimmed.slice(3).trim(),
          { pStyle: 'Heading2', bold: true, size: 28, color: '1D4ED8', spacingBefore: 200, spacingAfter: 120 },
          activeComments
        )
      );
    } else if (trimmed.startsWith('### ')) {
      bodyElements.push(
        buildParagraphWithCommentsXml(
          trimmed.slice(4).trim(),
          { pStyle: 'Heading3', bold: true, size: 25, color: '0F172A', spacingBefore: 160, spacingAfter: 100 },
          activeComments
        )
      );
    } else if (/^[-*+]\s+/.test(trimmed)) {
      const itemText = `• ${trimmed.replace(/^[-*+]\s+/, '')}`;
      bodyElements.push(
        buildParagraphWithCommentsXml(
          itemText,
          { size: 24, indentLeft: 420, spacingAfter: 90 },
          activeComments
        )
      );
    } else if (/^\d+\.\s+/.test(trimmed)) {
      bodyElements.push(
        buildParagraphWithCommentsXml(
          trimmed,
          { size: 24, indentLeft: 420, spacingAfter: 90 },
          activeComments
        )
      );
    } else if (trimmed.startsWith('> ')) {
      bodyElements.push(
        buildParagraphWithCommentsXml(
          trimmed.slice(2).trim(),
          { italic: true, size: 23, color: '475569', indentLeft: 480, fill: 'F8FAFC', spacingAfter: 120 },
          activeComments
        )
      );
    } else {
      bodyElements.push(
        buildParagraphWithCommentsXml(
          trimmed,
          { size: 24, align: 'both', spacingAfter: 140 },
          activeComments
        )
      );
    }

    i++;
  }

  // Phụ lục Biên bản Rà soát & Nghiệm thu (tùy chọn)
  if (includeCertificate) {
    bodyElements.push(
      buildParagraphWithCommentsXml('PHỤ LỤC BIÊN BẢN RÀ SOÁT & PHÊ DUYỆT TÀI LIỆU (DOCREVIEW STUDIO)', {
        pStyle: 'Heading2',
        bold: true,
        size: 26,
        color: '0F766E',
        spacingBefore: 420,
        spacingAfter: 140
      })
    );

    const statusLabelMap = {
      DRAFT: 'Bản nháp (Draft)',
      IN_REVIEW: 'Đang rà soát (In Review)',
      CHANGES_REQUESTED: 'Yêu cầu chỉnh sửa (Changes Requested)',
      APPROVED: 'Đã phê duyệt chính thức (Approved)'
    };
    const metaLine = `Phiên bản: ${versionLabel}  |  Trạng thái: ${statusLabelMap[status] || status}${
      qualityReport ? `  |  Điểm Chất lượng: ${qualityReport.overallScore}/100 (Hạng ${qualityReport.grade})` : ''
    }`;
    bodyElements.push(
      buildParagraphWithCommentsXml(metaLine, { bold: true, size: 22, color: '334155', spacingAfter: 120 })
    );

    if (sealVerification && sealVerification.isSealed) {
      const sealColor = sealVerification.status === 'VALID' ? '047857' : 'DC2626';
      bodyElements.push(
        buildParagraphWithCommentsXml(
          `NIÊM PHONG MẬT MÃ SHA-256: ${sealVerification.label} (Mã: ${sealVerification.sealId})`,
          { bold: true, size: 22, color: sealColor, fill: 'F8FAFC', spacingAfter: 60 }
        ),
        buildParagraphWithCommentsXml(
          `SHA-256 Nội dung gốc: ${sealVerification.sealedContentSha256} | Chữ ký HMAC: ${sealVerification.hmacSignature.slice(0, 36)}...`,
          { font: 'Consolas', size: 18, color: '475569', spacingAfter: 120 }
        )
      );
    }

    if (Array.isArray(approvals) && approvals.length > 0) {
      const tableLines = [
        '| Người phê duyệt | Vai trò | Quyết định | Ghi chú |',
        '| --- | --- | --- | --- |',
        ...approvals.map(
          (a) =>
            `| ${a.reviewer || ''} | ${a.role || ''} | ${a.decision || ''} | ${(a.note || '').replace(/\|/g, '/')} |`
        )
      ];
      bodyElements.push(buildTableXml(tableLines));
    }

    if (qualityReport && Array.isArray(qualityReport.findings) && qualityReport.findings.length > 0) {
      bodyElements.push(
        buildParagraphWithCommentsXml(
          `Các phát hiện tự động cần lưu ý (${qualityReport.findings.length} mục):`,
          { bold: true, size: 23, color: 'B45309', spacingBefore: 180, spacingAfter: 80 }
        )
      );
      for (const f of qualityReport.findings.slice(0, 12)) {
        bodyElements.push(
          buildParagraphWithCommentsXml(`• [${f.severity}] ${f.title}: ${f.message}`, {
            size: 21,
            color: '334155',
            indentLeft: 360,
            spacingAfter: 60
          })
        );
      }
    }
  }

  const attachedComments = activeComments.filter((c) => c._attached);

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyElements.join('\n')}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1800" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:keepNext/><w:outlineLvl w:val="1"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:pPr><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="25"/></w:rPr>
  </w:style>
</w:styles>`;

  const zipFiles = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  ${
    attachedComments.length > 0
      ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>'
      : ''
  }
</Types>`
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  ${
    attachedComments.length > 0
      ? '<Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>'
      : ''
  }
</Relationships>`
    },
    { name: 'word/styles.xml', data: stylesXml },
    { name: 'word/document.xml', data: documentXml }
  ];

  if (attachedComments.length > 0) {
    const commentsItemsXml = attachedComments
      .map((c) => {
        const replySummary =
          Array.isArray(c.replies) && c.replies.length > 0
            ? ' | Phản hồi: ' + c.replies.map((r) => `${r.author}: ${r.text}`).join(' ; ')
            : '';
        return `<w:comment w:id="${c._numId}" w:author="${escapeXml(c.author || 'Reviewer')}" w:date="${escapeXml(
          c.createdAt || new Date().toISOString()
        )}">
          <w:p>
            <w:r>
              <w:rPr><w:sz w:val="20"/></w:rPr>
              <w:t xml:space="preserve">${escapeXml(`[${c.category || 'COMMENT'}] ${c.text}${replySummary}`)}</w:t>
            </w:r>
          </w:p>
        </w:comment>`;
      })
      .join('\n');

    zipFiles.push({
      name: 'word/comments.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  ${commentsItemsXml}
</w:comments>`
    });
  }

  return createZipBuffer(zipFiles);
}

module.exports = {
  parseDocxBuffer,
  buildDocxBuffer,
  unzipEntries,
  escapeXml,
  decodeXmlEntities
};
