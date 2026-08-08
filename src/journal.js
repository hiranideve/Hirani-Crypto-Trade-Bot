'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let filePath = null;
function getFilePath() {
  if (!filePath) filePath = path.join(app.getPath('userData'), 'journal.json');
  return filePath;
}

function readAll() {
  try {
    if (fs.existsSync(getFilePath())) {
      return JSON.parse(fs.readFileSync(getFilePath(), 'utf8'));
    }
  } catch (e) {
    /* پەڕگەی تێکچوو — بە لیستێکی بەتاڵ دەستپێدەکەینەوە */
  }
  return [];
}

function writeAll(rows) {
  fs.mkdirSync(path.dirname(getFilePath()), { recursive: true });
  fs.writeFileSync(getFilePath(), JSON.stringify(rows, null, 2), 'utf8');
}

function add(entry) {
  const rows = readAll();
  rows.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...entry,
  });
  writeAll(rows.slice(0, 1000));
  return rows[0];
}

function list(limit = 200) {
  return readAll().slice(0, limit);
}

function clear() {
  writeAll([]);
  return true;
}

/** ئاماری کورتی تۆمارەکان */
function stats() {
  const rows = readAll();
  const executed = rows.filter((r) => r.kind === 'order' && !r.error);
  const signals = rows.filter((r) => r.kind === 'signal');
  const byRec = {};
  for (const s of signals) {
    const k = s.signal?.recommendation || 'unknown';
    byRec[k] = (byRec[k] || 0) + 1;
  }
  return {
    totalEntries: rows.length,
    ordersExecuted: executed.length,
    signalsGenerated: signals.length,
    signalBreakdown: byRec,
  };
}

module.exports = { add, list, clear, stats };
