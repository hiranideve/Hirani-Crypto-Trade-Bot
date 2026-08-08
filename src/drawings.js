'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// هێڵکاریەکان بە کۆردینەیتی داتا (کات + نرخ) هەڵدەگیرێن، نەک پیکسل —
// بۆیە دوای زووم/پان/گۆڕینی تایم‌فرەیم لە شوێنی خۆیان دەمێننەوە.

let filePath = null;
function getFilePath() {
  if (!filePath) filePath = path.join(app.getPath('userData'), 'drawings.json');
  return filePath;
}

function readAll() {
  try {
    if (fs.existsSync(getFilePath())) {
      return JSON.parse(fs.readFileSync(getFilePath(), 'utf8'));
    }
  } catch (e) {
    /* پەڕگەی تێکچوو */
  }
  return {};
}

function writeAll(obj) {
  fs.mkdirSync(path.dirname(getFilePath()), { recursive: true });
  fs.writeFileSync(getFilePath(), JSON.stringify(obj, null, 2), 'utf8');
}

const keyOf = (symbol, marketType) => `${marketType}:${symbol}`;

function list(symbol, marketType) {
  return readAll()[keyOf(symbol, marketType)] || [];
}

function save(symbol, marketType, items) {
  const all = readAll();
  if (!items || !items.length) delete all[keyOf(symbol, marketType)];
  else all[keyOf(symbol, marketType)] = items;
  writeAll(all);
  return items || [];
}

function clear(symbol, marketType) {
  return save(symbol, marketType, []);
}

module.exports = { list, save, clear };
