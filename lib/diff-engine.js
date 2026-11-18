/**
 * 🔍 DocReview Studio — Paragraph & Word-Level LCS Diff Engine
 * So sánh 2 phiên bản tài liệu, căn chỉnh theo khối đoạn (Block LCS) và chi tiết từng từ (Token LCS)
 */

function tokenizeWords(text) {
  return String(text || '').match(/\S+|\s+/g) || [];
}

function splitBlocks(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

/**
 * Word-level LCS diff cho 2 đoạn văn (giới hạn kích thước ma trận để luôn chạy < 15ms kể cả đoạn cực dài)
 */
function diffWords(oldStr, newStr) {
  if (oldStr === newStr) {
    return [{ type: 'same', value: oldStr }];
  }
  const a = tokenizeWords(oldStr);
  const b = tokenizeWords(newStr);

  if (a.length * b.length > 250000) {
    return [
      ...(oldStr ? [{ type: 'removed', value: oldStr }] : []),
      ...(newStr ? [{ type: 'added', value: newStr }] : [])
    ];
  }

  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
      }
    }
  }

  const rawTokens = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      rawTokens.push({ type: 'same', value: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rawTokens.push({ type: 'removed', value: a[i] });
      i++;
    } else {
      rawTokens.push({ type: 'added', value: b[j] });
      j++;
    }
  }
  while (i < m) rawTokens.push({ type: 'removed', value: a[i++] });
  while (j < n) rawTokens.push({ type: 'added', value: b[j++] });

  // Gộp các token cùng loại liên tiếp để DOM gọn sạch
  const merged = [];
  for (const tok of rawTokens) {
    const last = merged[merged.length - 1];
    if (last && last.type === tok.type) {
      last.value += tok.value;
    } else {
      merged.push({ ...tok });
    }
  }
  return merged;
}

function blockSimilarity(a, b) {
  if (a === b) return 1;
  const setA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const setB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const w of setA) {
    if (setB.has(w)) inter++;
  }
  return (2 * inter) / (setA.size + setB.size);
}

function compareVersions(baseText, targetText) {
  const blocksA = splitBlocks(baseText);
  const blocksB = splitBlocks(targetText);

  const m = blocksA.length;
  const n = blocksB.length;

  // Khớp đoạn theo độ tương đồng >= 0.42
  const dp = Array.from({ length: m + 1 }, () => new Float32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      const sim = blockSimilarity(blocksA[i], blocksB[j]);
      const matchScore = sim >= 0.42 ? sim + dp[i + 1][j + 1] : -1;
      const skipA = dp[i + 1][j];
      const skipB = dp[i][j + 1];
      dp[i][j] = Math.max(matchScore, skipA, skipB);
    }
  }

  const alignedBlocks = [];
  let i = 0;
  let j = 0;
  let oldIdx = 1;
  let newIdx = 1;

  while (i < m && j < n) {
    const sim = blockSimilarity(blocksA[i], blocksB[j]);
    if (sim >= 0.42 && Math.abs(dp[i][j] - (sim + dp[i + 1][j + 1])) < 1e-4) {
      const status = blocksA[i] === blocksB[j] ? 'UNCHANGED' : 'MODIFIED';
      alignedBlocks.push({
        status,
        oldIndex: oldIdx++,
        newIndex: newIdx++,
        oldText: blocksA[i],
        newText: blocksB[j],
        tokens: status === 'UNCHANGED' ? [{ type: 'same', value: blocksB[j] }] : diffWords(blocksA[i], blocksB[j])
      });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      alignedBlocks.push({
        status: 'REMOVED',
        oldIndex: oldIdx++,
        newIndex: null,
        oldText: blocksA[i],
        newText: '',
        tokens: [{ type: 'removed', value: blocksA[i] }]
      });
      i++;
    } else {
      alignedBlocks.push({
        status: 'ADDED',
        oldIndex: null,
        newIndex: newIdx++,
        oldText: '',
        newText: blocksB[j],
        tokens: [{ type: 'added', value: blocksB[j] }]
      });
      j++;
    }
  }

  while (i < m) {
    alignedBlocks.push({
      status: 'REMOVED',
      oldIndex: oldIdx++,
      newIndex: null,
      oldText: blocksA[i],
      newText: '',
      tokens: [{ type: 'removed', value: blocksA[i] }]
    });
    i++;
  }

  while (j < n) {
    alignedBlocks.push({
      status: 'ADDED',
      oldIndex: null,
      newIndex: newIdx++,
      oldText: '',
      newText: blocksB[j],
      tokens: [{ type: 'added', value: blocksB[j] }]
    });
    j++;
  }

  let addedWords = 0;
  let removedWords = 0;
  let sameWords = 0;
  let changedBlocks = 0;

  for (const blk of alignedBlocks) {
    if (blk.status !== 'UNCHANGED') changedBlocks++;
    for (const tok of blk.tokens) {
      const count = (tok.value.match(/\S+/g) || []).length;
      if (tok.type === 'added') addedWords += count;
      else if (tok.type === 'removed') removedWords += count;
      else sameWords += count;
    }
  }

  const denom = 2 * sameWords + addedWords + removedWords;
  const similarityPct = denom === 0 ? 100 : Math.round(((2 * sameWords) / denom) * 100);

  return {
    summary: {
      totalBlocks: alignedBlocks.length,
      changedBlocks,
      unchangedBlocks: alignedBlocks.length - changedBlocks,
      addedWords,
      removedWords,
      similarityPct
    },
    blocks: alignedBlocks
  };
}

module.exports = {
  compareVersions,
  diffWords,
  splitBlocks
};
