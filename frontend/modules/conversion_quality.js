(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MarkAIConversionQuality = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

const ConversionQuality = (() => {
  function metrics(markdown) {
    const text = String(markdown || '');
    return {
      characters: text.length,
      lines: text ? text.split(/\r?\n/).length : 0,
      headings: (text.match(/^#{1,6}\s+/gm) || []).length,
      tables: (text.match(/^\|.*\|$/gm) || []).length,
      links: (text.match(/\[[^\]]+\]\([^\)]+\)/g) || []).length,
      words: text.trim() ? text.trim().split(/\s+/).length : 0
    };
  }
  function diffScore(a, b) {
    const left = String(a || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const right = String(b || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const max = Math.max(left.length, right.length, 1);
    const same = left.filter((line, i) => line === right[i]).length;
    return Math.round((1 - same / max) * 100);
  }
  return { metrics, diffScore };
})();



  return ConversionQuality;
});