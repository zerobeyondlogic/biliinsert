import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedComment, collectComments, commentId, commentRegion, isCommentRequest, replyRecord } from '../src/comments-data.js';

test('reply identity is exact, never rounded or inferred from the author', () => {
  assert.equal(commentId('90071992547409931'), '90071992547409931');
  assert.equal(commentId(90071992547409931), null);
  assert.equal(replyRecord({mid:123, reply_control:{location:'IP属地：上海'}}), null);
  assert.equal(replyRecord({rpid_str:'1001',oid_str:'22',reply_control:{location:'IP属地：上海'}}).oid,'22');
});
test('empty and invalid locations are not labels', () => {
  for (const text of ['', 'IP属地：', 'IP属地：未知', '<script>x</script>', null, '暂无数据']) assert.equal(commentRegion(text), null);
  assert.equal(commentRegion(' IP 属地： 广东 '), '广东');
});
test('parent and nested replies retain their own locations including pinned replies', () => {
  const cache = new Map();
  collectComments({data:{replies:[{rpid_str:'1',oid:'30',reply_control:{location:'IP属地：上海'},replies:[{rpid_str:'2',oid:'30',reply_control:{location:'IP属地：广东'}}]}],top:{upper:{rpid_str:'3',reply_control:{location:'IP属地：山东'}}}}},cache);
  assert.equal(cachedComment(cache,'1','30'),'上海'); assert.equal(cachedComment(cache,'2','30'),'广东');
  assert.equal(cachedComment(cache,'1','31'),null); assert.equal(cachedComment(cache,'3'),'山东');
  assert.deepEqual([...cache.values()].map(value=>Object.keys(value).sort()), Array(3).fill(['id','location','oid']));
});
test('explicit missing fields replace cached data and cache size stays bounded', () => {
  const cache = new Map();
  collectComments({rpid_str:'1',reply_control:{location:'上海'}},cache);
  collectComments({rpid_str:'1',reply_control:{}},cache);
  assert.equal(cachedComment(cache,'1'),null);
  collectComments([{rpid_str:'2',reply_control:{location:'广东'}},{rpid_str:'3',reply_control:{location:'浙江'}}],cache,2);
  assert.equal(cache.size,2); assert.equal(cache.has('1'),false);
});
test('cycles and unrelated payloads are bounded and do not become reply records', () => {
  const root={data:{}}; root.data.replies=[root,{rpid_str:'10',reply_control:{location:'江苏'}}];
  const cache=new Map();collectComments(root,cache);
  collectComments({token:'secret',member:{mid:'10',location:'北京'},unrelated:{rpid:'11',reply_control:{location:'北京'}}},cache);
  assert.equal(cache.size,1);assert.equal(cachedComment(cache,'10'),'江苏');
});
test('only existing Bilibili reply responses are observed', () => {
  assert.equal(isCommentRequest('https://api.bilibili.com/x/v2/reply/wbi/main?oid=1'),true);
  assert.equal(isCommentRequest('https://api.bilibili.com/x/v2/reply/reply?oid=1'),true);
  for (const url of ['https://api.bilibili.com.evil/x/v2/reply','https://passport.bilibili.com/x/v2/reply','https://api.bilibili.com/x/v2/replying','https://api.bilibili.com/x/web-interface/nav']) assert.equal(isCommentRequest(url),false);
});
