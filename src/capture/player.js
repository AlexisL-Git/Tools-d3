'use strict';
const fs = require('node:fs');
const { decodeRecords } = require('./format');

class Player {
  constructor(records) {
    this._records = records;
  }

  static load(filePath) {
    return new Player(decodeRecords(fs.readFileSync(filePath)));
  }

  records() {
    return this._records;
  }
}

module.exports = { Player };
