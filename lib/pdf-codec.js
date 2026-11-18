/**
 * 📕 DocReview Studio v2.0 — Native Zero-Dependency PDF Text Extractor & Test PDF Builder
 * - Giải nén các luồng PDF (/FlateDecode & Uncompressed Content Streams)
 * - Giải mã bảng ánh xạ ký tự /ToUnicode CMap (beginbfchar & beginbfrange) cho tiếng Việt / Unicode
 * - Tách văn bản từ các toán tử BT..ET (Tj, TJ, ', ", Td, TD, T*, Tm) thành cấu trúc Markdown sạch
 */

const zlib = require('node:zlib');

function tryInflatePdfStream(rawBuf) {
  // Thử inflate chuẩn zlib header (RFC 1950), sau đó fallback sang raw deflate (RFC 1951)
  const trimmed = trimPdfStreamNewlines(rawBuf);
  for (const candidate of [trimmed, rawBuf]) {
    try {
      return zlib.inflateSync(candidate);
    } catch {
      try {
        return zlib.inflateRawSync(candidate);
      } catch {
        // Thử tiếp
      }
    }
  }
  return null;
}

function trimPdfStreamNewlines(buf) {
  let start = 0;
  let end = buf.length;
  if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
  else if (buf[start] === 0x0a || buf[start] === 0x0d) start += 1;

  if (end - start >= 2 && buf[end - 2] === 0x0d && buf[end - 1] === 0x0a) end -= 2;
  else if (end - start >= 1 && (buf[end - 1] === 0x0a || buf[end - 1] === 0x0d)) end -= 1;

  return buf.subarray(start, end);
}

function parseToUnicodeCMap(cmapText, cmapMap) {
  // 1. beginbfchar ... endbfchar: <0041> <0041> hoặc <0102> <1EA6>
  const bfCharBlocks = cmapText.match(/beginbfchar[\s\S]*?endbfchar/g) || [];
  for (const block of bfCharBlocks) {
    const pairRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let m;
    while ((m = pairRe.exec(block)) !== null) {
      const srcCode = parseInt(m[1], 16);
      const dstHex = m[2];
      cmapMap.set(srcCode, hexToUnicodeString(dstHex));
    }
  }

  // 2. beginbfrange ... endbfrange: <0020> <007E> <0020>
  const bfRangeBlocks = cmapText.match(/beginbfrange[\s\S]*?endbfrange/g) || [];
  for (const block of bfRangeBlocks) {
    const rangeRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let m;
    while ((m = rangeRe.exec(block)) !== null) {
      const start = parseInt(m[1], 16);
      const end = parseInt(m[2], 16);
      let target = parseInt(m[3], 16);
      if (end - start <= 1024) {
        for (let code = start; code <= end; code++) {
          cmapMap.set(code, String.fromCodePoint(target++));
        }
      }
    }
  }
}

function hexToUnicodeString(hex) {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length === 0) return '';
  if (clean.length % 4 === 0) {
    const chars = [];
    for (let i = 0; i < clean.length; i += 4) {
      chars.push(String.fromCharCode(parseInt(clean.slice(i, i + 4), 16)));
    }
    return chars.join('');
  }
  const bytes = Buffer.from(clean.length % 2 === 0 ? clean : `${clean}0`, 'hex');
  return bytes.toString('utf8');
}

function decodePdfLiteralString(inner) {
  const bytes = [];
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '\\' && i + 1 < inner.length) {
      const next = inner[i + 1];
      if (next === 'n') {
        bytes.push(10);
        i += 2;
      } else if (next === 'r') {
        bytes.push(13);
        i += 2;
      } else if (next === 't') {
        bytes.push(9);
        i += 2;
      } else if (next === 'b') {
        bytes.push(8);
        i += 2;
      } else if (next === 'f') {
        bytes.push(12);
        i += 2;
      } else if (next === '(' || next === ')' || next === '\\') {
        bytes.push(next.charCodeAt(0));
        i += 2;
      } else if (/[0-7]/.test(next)) {
        const oct = inner.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)[0];
        bytes.push(parseInt(oct, 8) & 0xff);
        i += 1 + oct.length;
      } else if (next === '\n' || next === '\r') {
        i += next === '\r' && inner[i + 2] === '\n' ? 3 : 2;
      } else {
        bytes.push(next.charCodeAt(0));
        i += 2;
      }
    } else {
      bytes.push(inner.charCodeAt(i) & 0xff);
      i++;
    }
  }

  const buf = Buffer.from(bytes);
  // Kiểm tra BOM UTF-16BE (\xFE\xFF)
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    let out = '';
    for (let k = 2; k + 1 < buf.length; k += 2) {
      out += String.fromCharCode((buf[k] << 8) | buf[k + 1]);
    }
    return out;
  }
  // Thử UTF-8 nếu hợp lệ, ngược lại Latin1
  const utf8 = buf.toString('utf8');
  if (!utf8.includes('\ufffd')) return utf8;
  return buf.toString('latin1');
}

function decodePdfHexString(hexInner, cmapMap) {
  const clean = hexInner.replace(/\s+/g, '');
  if (!clean) return '';

  // BOM UTF-16BE
  if (clean.toUpperCase().startsWith('FEFF') && clean.length >= 8) {
    let out = '';
    for (let i = 4; i + 3 < clean.length; i += 4) {
      out += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16));
    }
    return out;
  }

  if (cmapMap && cmapMap.size > 0) {
    // Thử ánh xạ 4-hex (2 byte CID) trước, rồi 2-hex (1 byte)
    if (clean.length % 4 === 0) {
      let mapped4 = '';
      let hits = 0;
      for (let i = 0; i < clean.length; i += 4) {
        const code = parseInt(clean.slice(i, i + 4), 16);
        if (cmapMap.has(code)) {
          mapped4 += cmapMap.get(code);
          hits++;
        } else {
          mapped4 += String.fromCharCode(code);
        }
      }
      if (hits > 0) return mapped4;
    }
    if (clean.length % 2 === 0) {
      let mapped2 = '';
      let hits = 0;
      for (let i = 0; i < clean.length; i += 2) {
        const code = parseInt(clean.slice(i, i + 2), 16);
        if (cmapMap.has(code)) {
          mapped2 += cmapMap.get(code);
          hits++;
        } else {
          mapped2 += String.fromCharCode(code);
        }
      }
      if (hits > 0) return mapped2;
    }
  }

  const padded = clean.length % 2 === 0 ? clean : `${clean}0`;
  const buf = Buffer.from(padded, 'hex');
  const utf8 = buf.toString('utf8');
  if (!utf8.includes('\ufffd')) return utf8;
  return buf.toString('latin1');
}

function extractTextFromContentStream(streamStr, cmapMap) {
  const btBlocks = streamStr.match(/BT[\s\S]*?ET/g) || [];
  if (btBlocks.length === 0) return '';

  const lines = [];
  for (const bt of btBlocks) {
    let currentLine = '';
    let lastY = null;

    // Quét tuần tự các token trong khối BT..ET
    const tokenRe =
      /\[((?:[^\]\\]|\\.|\\\([\s\S]*?\\\))*)\]\s*TJ|\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|'|")|<([0-9A-Fa-f\s]+)>\s*(?:Tj|'|")|(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+T[dD]|(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+Tm|\bT\*/g;

    let m;
    while ((m = tokenRe.exec(bt)) !== null) {
      if (m[1] !== undefined) {
        // Mảng TJ: [(Hello) -120 (world) <0021>] TJ
        const arrContent = m[1];
        const subRe = /\(((?:[^()\\]|\\.)*)\)|<([0-9A-Fa-f\s]+)>|(-?\d+(?:\.\d+)?)/g;
        let sm;
        while ((sm = subRe.exec(arrContent)) !== null) {
          if (sm[1] !== undefined) {
            currentLine += decodePdfLiteralString(sm[1]);
          } else if (sm[2] !== undefined) {
            currentLine += decodePdfHexString(sm[2], cmapMap);
          } else if (sm[3] !== undefined) {
            const kern = parseFloat(sm[3]);
            if (kern < -180 && !currentLine.endsWith(' ')) {
              currentLine += ' ';
            }
          }
        }
      } else if (m[2] !== undefined) {
        currentLine += decodePdfLiteralString(m[2]);
      } else if (m[3] !== undefined) {
        currentLine += decodePdfHexString(m[3], cmapMap);
      } else if (m[4] !== undefined && m[5] !== undefined) {
        // Td / TD
        const dy = parseFloat(m[5]);
        if (Math.abs(dy) > 1.5) {
          if (currentLine.trim()) lines.push(currentLine.trim());
          currentLine = '';
        } else if (parseFloat(m[4]) > 10 && currentLine && !currentLine.endsWith(' ')) {
          currentLine += ' ';
        }
      } else if (m[11] !== undefined) {
        // Tm matrix: a b c d e f Tm -> f là tung độ Y
        const y = parseFloat(m[11]);
        if (lastY !== null && Math.abs(y - lastY) > 2.5) {
          if (currentLine.trim()) lines.push(currentLine.trim());
          currentLine = '';
        }
        lastY = y;
      } else if (m[0] === 'T*') {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = '';
      }
    }

    if (currentLine.trim()) {
      lines.push(currentLine.trim());
    }
  }

  return lines.join('\n');
}

function parsePdfBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) {
    throw new Error('Dữ liệu tệp PDF không hợp lệ.');
  }
  const headerSig = buf.subarray(0, 1024).toString('latin1');
  if (!headerSig.includes('%PDF-')) {
    throw new Error('Tệp tải lên không đúng định dạng chữ ký %PDF-.');
  }

  const rawLatin = buf.toString('latin1');
  const decodedStreams = [];
  const cmapMap = new Map();

  let searchPos = 0;
  while (searchPos < rawLatin.length) {
    const streamIdx = rawLatin.indexOf('stream', searchPos);
    if (streamIdx === -1) break;

    // Đảm bảo từ khóa 'stream' không nằm giữa từ khác (như endstream)
    const prevChar = streamIdx > 0 ? rawLatin[streamIdx - 1] : ' ';
    const afterWord = rawLatin.slice(streamIdx + 6, streamIdx + 8);
    if (/[A-Za-z]/.test(prevChar) || !(afterWord.startsWith('\r\n') || afterWord.startsWith('\n') || afterWord.startsWith('\r'))) {
      searchPos = streamIdx + 6;
      continue;
    }

    const endStreamIdx = rawLatin.indexOf('endstream', streamIdx + 6);
    if (endStreamIdx === -1) break;

    const dictWindowStart = Math.max(0, streamIdx - 550);
    const dictHeader = rawLatin.slice(dictWindowStart, streamIdx);
    const isImageOrFontBinary = /\/Subtype\s*\/Image|\/Subtype\s*\/Type1C|\/Filter\s*\/DCTDecode|\/Filter\s*\/JPXDecode/i.test(
      dictHeader
    );

    if (!isImageOrFontBinary) {
      const rawSlice = buf.subarray(streamIdx + 6, endStreamIdx);
      const isFlate = /\/FlateDecode/i.test(dictHeader);

      let textDecoded = null;
      if (isFlate) {
        const inflated = tryInflatePdfStream(rawSlice);
        if (inflated) textDecoded = inflated.toString('latin1');
      } else {
        textDecoded = trimPdfStreamNewlines(rawSlice).toString('latin1');
      }

      if (textDecoded) {
        if (textDecoded.includes('beginbfchar') || textDecoded.includes('beginbfrange')) {
          parseToUnicodeCMap(textDecoded, cmapMap);
        } else if (textDecoded.includes('BT') && textDecoded.includes('ET')) {
          decodedStreams.push(textDecoded);
        }
      }
    }

    searchPos = endStreamIdx + 9;
  }

  const extractedChunks = [];
  for (const s of decodedStreams) {
    const chunk = extractTextFromContentStream(s, cmapMap);
    if (chunk.trim()) extractedChunks.push(chunk.trim());
  }

  const combinedLines = extractedChunks
    .join('\n')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (combinedLines.length === 0) {
    throw new Error(
      'Không tìm thấy lớp văn bản (Text Layer) trong tệp PDF này. Có thể đây là PDF dạng ảnh quét (Scanned Image) cần qua OCR trước.'
    );
  }

  // Tái tạo cấu trúc Markdown thông minh (nhận diện tiêu đề đánh số / chữ in hoa ngắn)
  const paragraphs = [];
  let bufferPara = [];

  const flushPara = () => {
    if (bufferPara.length > 0) {
      paragraphs.push(bufferPara.join(' '));
      bufferPara = [];
    }
  };

  combinedLines.forEach((line, idx) => {
    if (idx === 0 && line.length <= 120) {
      flushPara();
      paragraphs.push(`# ${line.replace(/^#+\s*/, '')}`);
      return;
    }
    if (/^(?:PHẦN|CHƯƠNG|ĐIỀU|MỤC)\s+[IVXLC\d]+[:.]?/i.test(line) && line.length <= 110) {
      flushPara();
      paragraphs.push(`## ${line}`);
      return;
    }
    if (/^\d+\.\s+[A-ZÀ-ỸĐ]/.test(line) && line.length <= 95 && !/[.;]$/.test(line)) {
      flushPara();
      paragraphs.push(`## ${line}`);
      return;
    }
    if (/^[-•*]\s+/.test(line)) {
      flushPara();
      paragraphs.push(`- ${line.replace(/^[-•*]\s+/, '')}`);
      return;
    }

    bufferPara.push(line);
    if (/[.!?:]$/.test(line) && bufferPara.join(' ').length >= 140) {
      flushPara();
    }
  });
  flushPara();

  return {
    markdown: paragraphs.join('\n\n'),
    pageStreamsCount: decodedStreams.length
  };
}

/**
 * Sinh tệp PDF 1.4 chuẩn (có nén FlateDecode + chuỗi UTF-16BE Hex hỗ trợ đầy đủ tiếng Việt)
 * phục vụ kiểm thử tự động & xuất nhanh.
 */
function encodeUtf16BeHex(str) {
  const buf = Buffer.alloc(2 + str.length * 2);
  buf[0] = 0xfe;
  buf[1] = 0xff;
  for (let i = 0; i < str.length; i++) {
    buf.writeUInt16BE(str.charCodeAt(i), 2 + i * 2);
  }
  return buf.toString('hex').toUpperCase();
}

function buildSimplePdfBuffer(lines = []) {
  const streamCommands = ['BT', '/F1 12 Tf', '50 780 Td'];
  lines.forEach((line, idx) => {
    if (idx > 0) streamCommands.push('0 -20 Td');
    streamCommands.push(`<${encodeUtf16BeHex(String(line))}> Tj`);
  });
  streamCommands.push('ET');

  const rawContent = Buffer.from(streamCommands.join('\n'), 'latin1');
  const compressed = zlib.deflateSync(rawContent);

  const parts = [];
  const offsets = [];
  const pushStr = (s) => parts.push(Buffer.from(s, 'latin1'));
  const currentLen = () => parts.reduce((acc, b) => acc + b.length, 0);

  pushStr('%PDF-1.4\n');

  offsets.push(currentLen());
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  offsets.push(currentLen());
  pushStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  offsets.push(currentLen());
  pushStr(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n'
  );

  offsets.push(currentLen());
  pushStr(`4 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`);
  parts.push(compressed);
  pushStr('\nendstream\nendobj\n');

  offsets.push(currentLen());
  pushStr('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  const xrefOffset = currentLen();
  pushStr(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`);
  for (const off of offsets) {
    pushStr(`${String(off).padStart(10, '0')} 00000 n \n`);
  }
  pushStr(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(parts);
}

module.exports = {
  parsePdfBuffer,
  buildSimplePdfBuffer
};
