'use strict';

function shannonEntropy(buf) {
  if (buf.length === 0) return 0;
  const counts = new Array(256).fill(0);
  for (const byte of buf) counts[byte] += 1;
  let entropy = 0;
  for (const count of counts) {
    if (count === 0) continue;
    const p = count / buf.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

module.exports = { shannonEntropy };
