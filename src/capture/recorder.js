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
  }

  write(direction, payload) {
    fs.writeSync(this._fd, encodeRecord({ direction, timestamp: Date.now(), payload }));
    this.count += 1;
  }

  close() {
    if (this._fd !== null) {
      fs.closeSync(this._fd);
      this._fd = null;
    }
  }
}

module.exports = { Recorder };
