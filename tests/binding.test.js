import test from 'node:test';
import assert from 'node:assert/strict';
import {validId,itemBinding,parseBinding,pageId,readBinding} from '../src/binding.js';
test('large content IDs stay exact; rounded JS numbers are rejected', () => {
  assert.equal(validId('1160000000000000123'),'1160000000000000123');
  assert.equal(validId(1160000000000000123),null);
  assert.equal(validId('9223372036854775808'),null);
  assert.equal(validId('0'),null);
});
test('forward and original keep their own content IDs and authors', () => {
  const orig = {id_str:'222',modules:{module_author:{mid:22}}};
  const post = {id_str:'111',modules:{module_author:{mid:11}},orig};
  assert.deepEqual(itemBinding(post),{id:'111',authorMid:'11',role:'post'});
  assert.deepEqual(itemBinding(post.orig,'original'),{id:'222',authorMid:'22',role:'original'});
  assert.equal(itemBinding({orig}),null);
});
test('binding and URL input reject unrelated or malformed content', () => {
  assert.equal(parseBinding({id:'12',authorMid:'oops',role:'post'}),null);
  assert.equal(parseBinding({id:'12',authorMid:null,role:'unknown'}),null);
  assert.equal(pageId('https://www.bilibili.com/video/123'),null);
  assert.equal(pageId('https://www.bilibili.com/opus/123?foo=1'),'123');
  assert.equal(pageId('https://t.bilibili.com/123'),'123');
});
test('detail routes reject stale Vue IDs while feed routes allow multiple posts', () => {
  const card={__vueParentComponent:{props:{data:{id_str:'111',modules:{module_author:{mid:'11'}}}}}};
  const el={matches:()=>false,closest:()=>card};
  assert.equal(readBinding(el,'https://t.bilibili.com/222',{}),null);
  assert.equal(readBinding(el,'https://t.bilibili.com/',{}).id,'111');
});
test('a removed original cannot be recovered from stale child props', () => {
  const card={__vueParentComponent:{props:{data:{id_str:'111',modules:{module_author:{mid:'11'}}}}}};
  const el={matches:()=>true,closest:()=>card,__vueParentComponent:{props:{data:{orig:{id_str:'222'}}}}};
  assert.equal(readBinding(el,'https://t.bilibili.com/',{}),null);
});
