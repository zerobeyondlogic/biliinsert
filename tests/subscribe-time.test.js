import test from 'node:test';
import assert from 'node:assert/strict';
import {
  userId, spaceContext, relationRequest, followTimestamp, viewerFromResponse,
  profileFollowTime, listFollowTimes, relationKey, listTimeCaption, formatFollowTime,
} from '../src/subscribe-time-data.js';

const now = 1_900_000_000_000, time = 1_700_000_000;
test('space routes distinguish owner and relation direction', () => {
  assert.deepEqual(spaceContext('https://space.bilibili.com/123/relation/follow'), { owner: '123', section: 'followings' });
  assert.deepEqual(spaceContext('https://space.bilibili.com/123/fans/fans'), { owner: '123', section: 'fans' });
  assert.deepEqual(spaceContext('https://space.bilibili.com/123/dynamic'), { owner: '123', section: null });
  assert.equal(spaceContext('https://space.bilibili.com.evil.test/123'), null);
  assert.equal(spaceContext('https://space.bilibili.com/0'), null);
  assert.equal(userId(Number.MAX_SAFE_INTEGER + 1), null);
});

test('only known relation endpoints and exact host are observed', () => {
  assert.deepEqual(relationRequest('https://api.bilibili.com/x/web-interface/relation?mid=123'), { kind: 'profile', target: '123' });
  assert.equal(relationRequest('https://api.bilibili.com/x/web-interface/relation?fid=123'), null);
  assert.deepEqual(relationRequest('https://api.bilibili.com/x/relation/followings/search?vmid=123'), { kind: 'list', section: 'followings', owner: '123' });
  assert.equal(relationRequest('https://api.bilibili.com/x/relation/same/followings?vmid=123'), null);
  assert.equal(relationRequest('https://api.bilibili.com/x/relation/followings'), null);
  assert.equal(relationRequest('https://api.bilibili.com.evil.test/x/relation/fans?vmid=123'), null);
});

test('timestamps reject epoch, strings, milliseconds and future values', () => {
  assert.equal(followTimestamp(time, now), time);
  for (const value of [0, 123, String(time), time * 1000, Math.floor(now / 1000) + 301, NaN, Infinity]) {
    assert.equal(followTimestamp(value, now), null);
  }
  assert.match(formatFollowTime(time), /2023/);
});

test('profile time is current viewer to matching target, never the reverse relation', () => {
  const body = { code: 0, data: { relation: { mid: 200, attribute: 2, mtime: time }, be_relation: { mid: 100, attribute: 2, mtime: time - 1000 } } };
  assert.equal(profileFollowTime(body, '200', '100', now), time);
  assert.equal(profileFollowTime(body, '201', '100', now), null);
  assert.equal(profileFollowTime(body, '200', '300', now), null);
  assert.equal(profileFollowTime(body, '200', null, now), null);
  assert.equal(profileFollowTime(body, '200', '200', now), null);
  for (const attribute of [0, 1, 6, 128]) {
    assert.equal(profileFollowTime({ ...body, data: { ...body.data, relation: { ...body.data.relation, attribute } } }, '200', '100', now), null);
  }
  assert.equal(profileFollowTime({ code: 0, data: { be_relation: body.data.be_relation } }, '200', '100', now), null);
});

test('list owner and direction stay in keys and captions; unrelated owner never becomes you', () => {
  const request = { kind: 'list', owner: '100', section: 'followings' };
  const rows = listFollowTimes(request, { code: 0, data: { list: [{ mid: 200, mtime: time }, { mid: 300, mtime: 0 }] } }, now);
  assert.deepEqual(rows, [{ owner: '100', section: 'followings', mid: '200', time }]);
  assert.notEqual(relationKey('100', 'followings', '200'), relationKey('100', 'fans', '200'));
  assert.notEqual(relationKey('100', 'followings', '200'), relationKey('300', 'followings', '200'));
  assert.equal(listTimeCaption('100', 'followings', '100'), '你关注 Ta 于');
  assert.equal(listTimeCaption('100', 'fans', '100'), 'Ta 关注你于');
  assert.equal(listTimeCaption('100', 'followings', '300'), '主页主人关注 Ta 于');
  assert.equal(listTimeCaption('100', 'fans', null), 'Ta 关注主页主人于');
  assert.equal(viewerFromResponse({ code: 0, data: { isLogin: false, mid: 100 } }), null);
});
