'use strict';
const { FrameReassembler, writeVarint } = require('../codec/framing');

function probeFraming(buffers) {
  const reassembler = new FrameReassembler({ maxFrame: 1 << 20 });
  let frames = 0;
  let bytesConsumed = 0;
  let bytesTotal = 0;
  let errors = 0;

  for (const buf of buffers) {
    bytesTotal += buf.length;
    try {
      for (const frame of reassembler.push(buf)) {
        frames += 1;
        // On compte la trame entière, préfixe de longueur inclus : ces octets
        // sont consommés par le framing au même titre que la charge utile.
        bytesConsumed += writeVarint(frame.length).length + frame.length;
      }
    } catch (err) {
      errors += 1;
      break;
    }
  }

  return {
    frames,
    bytesConsumed,
    bytesTotal,
    ratio: bytesTotal === 0 ? 0 : bytesConsumed / bytesTotal,
    errors,
  };
}

const ENTROPY_CHIFFRE = 7.5;
const ENTROPY_CLAIR = 7.0;
const RATIO_BON = 0.9;

function verdict({ entropy, ratio }) {
  if (entropy < ENTROPY_CLAIR && ratio >= RATIO_BON) {
    return {
      conclusion: 'clair',
      reason: `entropie ${entropy.toFixed(2)} bits/octet et ${(ratio * 100).toFixed(1)}% du flux réassemblé en trames varint`,
    };
  }
  if (entropy >= ENTROPY_CHIFFRE && ratio < RATIO_BON) {
    return {
      conclusion: 'chiffré',
      reason: `entropie ${entropy.toFixed(2)} bits/octet, proche du bruit, et seulement ${(ratio * 100).toFixed(1)}% réassemblé`,
    };
  }
  return {
    conclusion: 'indéterminé',
    reason: `signaux contradictoires: entropie ${entropy.toFixed(2)}, ratio ${(ratio * 100).toFixed(1)}%`,
  };
}

module.exports = { probeFraming, verdict, ENTROPY_CHIFFRE, ENTROPY_CLAIR, RATIO_BON };
