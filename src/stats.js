'use strict';

class MessageStats {
  constructor() {
    this._byName = new Map();
    this.total = 0;
    this.unknownCount = 0;
  }

  record({ name, unknown }) {
    this.total += 1;
    if (unknown) this.unknownCount += 1;
    const existing = this._byName.get(name);
    if (existing) {
      existing.count += 1;
    } else {
      this._byName.set(name, { name, count: 1, unknown: Boolean(unknown) });
    }
  }

  top(n) {
    return [...this._byName.values()].sort((a, b) => b.count - a.count).slice(0, n);
  }

  unknownRatio() {
    return this.total === 0 ? 0 : this.unknownCount / this.total;
  }
}

module.exports = { MessageStats };
