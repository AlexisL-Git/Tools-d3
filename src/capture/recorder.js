'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { encodeRecord } = require('./format');

class Recorder {
  constructor(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this._fd = fs.openSync(filePath, 'w');
    this.filePath = filePath;
    this.count = 0;
    this.bytes = 0;
  }

  write(direction, payload, socket = 0) {
    fs.writeSync(this._fd, encodeRecord({ direction, timestamp: Date.now(), payload, socket }));
    this.count += 1;
    this.bytes += payload.length;
  }

  close() {
    if (this._fd !== null) {
      fs.closeSync(this._fd);
      this._fd = null;
    }
  }
}

module.exports = { Recorder };
