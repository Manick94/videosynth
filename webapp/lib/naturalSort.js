// "ziva2.png" before "ziva10.png"
function naturalCompare(a, b) {
  const re = /(\d+)|(\D+)/g;
  const ap = a.match(re) || [];
  const bp = b.match(re) || [];
  const len = Math.max(ap.length, bp.length);
  for (let i = 0; i < len; i++) {
    const x = ap[i] || "";
    const y = bp[i] || "";
    if (x === y) continue;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) return Number(x) - Number(y);
    return x < y ? -1 : 1;
  }
  return 0;
}

module.exports = { naturalCompare };
