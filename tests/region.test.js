import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRegion, parseRegion } from '../src/region.js';

test('own dynamic view counters and other-viewer pure values yield the same region', () => {
  for (const text of ['上海', 'IP属地：上海', '215浏览 IP属地：上海', '215浏览\u00a0IP属地：上海',
    '215浏览\u3000IP属地：上海', '215浏览 · IP属地：上海', '215浏览·IP属地：上海',
    '昨天 22:42 · 215浏览 · IP属地：上海']) assert.equal(normalizeRegion(text), '上海', text);
});
test('older cached labels with nested prefixes are repaired without borrowing statistics', () => {
  for (const text of ['IP属地：215浏览 IP属地：上海', 'IP属地：IP属地：上海',
    'IP属地：上海 IP属地：上海', 'IP属地：上海 · IP归属地：上海']) assert.equal(normalizeRegion(text), '上海', text);
  assert.equal(parseRegion('IP属地：上海 IP属地：北京').reason, 'conflict');
  assert.equal(normalizeRegion('IP属地：上海 IP属地：北京'), null);
});
test('marked regions shed only recognized trailing counters and timestamps', () => {
  for (const text of ['IP属地：上海 · 215浏览', 'IP属地：上海 1.2万阅读', 'IP属地：上海 阅读量：215',
    'IP属地：上海 · 发布于 2026-11-01 22:42', 'IP属地：上海 3小时前',
    '215浏览 IP属地：上海 · 2评论 · 仅自己可见', 'IP属地：United States · 215 views']) {
    assert.equal(normalizeRegion(text), text.includes('United States') ? 'United States' : '上海', text);
  }
  for (const text of ['IP属地：上海 215浏览 北京', 'IP属地：上海 215未知统计', 'IP属地：215浏览 上海']) {
    assert.equal(normalizeRegion(text), null, text);
  }
});
test('pure international region fields do not depend on a province allowlist', () => {
  for (const text of ['中国台湾', 'United States', 'Côte d’Ivoire', 'São Tomé and Príncipe', 'Timor-Leste',
    'Réunion', '대한민국', '日本', 'United States (USA)', 'Bonaire, Sint Eustatius and Saba']) assert.equal(normalizeRegion(text), text);
});
test('empty, unknown, metadata-only and unsafe or unbounded inputs are rejected', () => {
  for (const text of [null, undefined, 215, '', ' ', '未知', '暂无数据', 'IP属地：未知', 'IP属地：',
    '215浏览', '215阅读', '浏览215', '昨天', '2026-11-01 22:42', '上海 215浏览', '上海工作室 版权所有',
    'IP属地：215浏览', '<b>上海</b>', '上海\0', '上海\u202e', 'a'.repeat(65), 'IP属地：' + 'a'.repeat(513)]) {
    assert.equal(normalizeRegion(text), null, String(text));
  }
});
test('general footer parsing requires an explicit marker anywhere in the caption', () => {
  assert.equal(normalizeRegion('上海', { requireMarker: true }), null);
  assert.equal(normalizeRegion('215浏览 IP属地：上海', { requireMarker: true }), '上海');
  assert.equal(normalizeRegion('上海工作室 版权所有', { requireMarker: true }), null);
});
