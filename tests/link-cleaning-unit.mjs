// Unit tests for tracking-parameter stripping and redirect unwrapping (no browser).
//   node tests/link-cleaning-unit.mjs
import assert from 'node:assert/strict';
import { stripTrackingParams, unwrapUrl, isProtectedUrl } from '../src/lib/link-cleaning.js';
import { PROTECTED_URL_REGEX } from '../src/lib/link-rules.js';

let failures = 0;
function test(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`  ✗ FAIL ${label}\n    ${err.message.split('\n').join('\n    ')}`);
  }
}

console.log('— stripTrackingParams');
test('drops known tracking params, keeps the rest in order', () => {
  assert.equal(
    stripTrackingParams('https://shop.example/item?id=7&utm_source=news&color=red&gclid=abc&fbclid=x'),
    'https://shop.example/item?id=7&color=red',
  );
});
test('drops any utm_* variant and the whole query when nothing is left', () => {
  assert.equal(stripTrackingParams('https://a.example/p?utm_foo=1&UTM_Source=2&utm_marketing_tactic=3'), 'https://a.example/p');
});
test('keeps the fragment and the original encoding', () => {
  assert.equal(
    stripTrackingParams('https://a.example/s?q=a%20b+c&mc_eid=9&x=%2F#top'),
    'https://a.example/s?q=a%20b+c&x=%2F#top',
  );
});
test('email/marketing ids', () => {
  const url = 'https://a.example/?_hsenc=1&_hsmi=2&__hssc=3&__hstc=4&__hsfp=5&hsCtaTracking=6&mkt_tok=7&vero_id=8&k=v';
  assert.equal(stripTrackingParams(url), 'https://a.example/?k=v');
});
test('leaves functional generic params alone', () => {
  const url = 'https://a.example/?ref=main&source=app&si=1&spm=2&page=3';
  assert.equal(stripTrackingParams(url), url);
});
test('returns the same string when nothing changes', () => {
  const url = 'https://a.example/path?b=2&a=1';
  assert.equal(stripTrackingParams(url), url);
  assert.equal(stripTrackingParams('https://a.example/'), 'https://a.example/');
});
test('ignores invalid and non-http URLs', () => {
  assert.equal(stripTrackingParams('not a url'), 'not a url');
  assert.equal(stripTrackingParams('mailto:a@b.example?utm_source=x'), 'mailto:a@b.example?utm_source=x');
  assert.equal(stripTrackingParams(undefined), undefined);
});
test('never touches sign-in, OAuth or payment URLs', () => {
  for (const url of [
    'https://accounts.google.com/o/oauth2/auth?client_id=1&utm_source=x',
    'https://www.paypal.com/checkoutnow?token=1&utm_source=x',
    'https://app.example/oauth/callback?code=1&gclid=x',
    'https://app.example/login?utm_source=x',
    'https://app.example/en/sign-in.html?utm_source=x',
    'https://shop.example/checkout/step1?fbclid=x',
  ]) assert.equal(stripTrackingParams(url), url, url);
});
test('protected-path check does not catch look-alikes', () => {
  assert.equal(isProtectedUrl('https://blog.example/author/jane'), false);
  assert.equal(isProtectedUrl('https://blog.example/posts/loginless-design'), false);
  assert.equal(isProtectedUrl('https://notpaypal.com.example/'), false);
});
test('DNR protected regex agrees with the JS check', () => {
  const re = new RegExp(PROTECTED_URL_REGEX, 'i');
  assert.ok(re.test('https://app.example/oauth/authorize?x=1'));
  assert.ok(re.test('http://app.example:8080/login?utm_source=x'));
  assert.ok(re.test('https://login.example.com/x?utm_source=x'));
  assert.ok(!re.test('https://blog.example/author/jane?utm_source=x'));
  assert.ok(!re.test('https://blog.example/a?next=/login'));
});

console.log('\n— unwrapUrl');
const DEST = 'https://dest.example/a?b=1&utm_source=x';
const enc = encodeURIComponent(DEST);
for (const [label, wrapped] of [
  ['google.com/url?q=', `https://www.google.com/url?q=${enc}&sa=D&ust=1`],
  ['google.co.uk/url?url=', `https://www.google.co.uk/url?sa=t&url=${enc}`],
  ['l.facebook.com', `https://l.facebook.com/l.php?u=${enc}&h=AT0`],
  ['lm.facebook.com', `https://lm.facebook.com/l.php?u=${enc}`],
  ['l.instagram.com', `https://l.instagram.com/?u=${enc}&e=1`],
  ['youtube redirect', `https://www.youtube.com/redirect?event=video&q=${enc}&v=1`],
  ['out.reddit.com', `https://out.reddit.com/t3_abc?url=${enc}&token=1`],
  ['steam linkfilter u=', `https://steamcommunity.com/linkfilter/?u=${enc}`],
  ['steam linkfilter url=', `https://steamcommunity.com/linkfilter/?url=${enc}`],
  ['slack-redir', `https://slack-redir.net/link?url=${enc}`],
  ['href.li', `https://href.li/?${DEST}`],
  ['away.vk.com', `https://away.vk.com/away.php?to=${enc}&cc_key=`],
  ['linkedin redir', `https://www.linkedin.com/redir/redirect?url=${enc}&urlhash=1`],
  ['disq.us (hash trailer)', `https://disq.us/url?url=${encodeURIComponent(`${DEST}:Bb9YzBXV5rLxgUWdKnzTmT0e5uY`)}&cuid=1`],
  ['nested google → facebook', `https://www.google.com/url?q=${encodeURIComponent(`https://l.facebook.com/l.php?u=${enc}`)}`],
]) {
  test(label, () => assert.equal(unwrapUrl(wrapped), 'https://dest.example/a?b=1'));
}
test('rejects non-http targets', () => {
  assert.equal(unwrapUrl(`https://www.google.com/url?q=${encodeURIComponent('javascript:alert(1)')}`), null);
  assert.equal(unwrapUrl('https://www.google.com/url?q=%2Fsearch%3Fq%3Dx'), null);
});
test('ignores non-wrappers and look-alike hosts', () => {
  assert.equal(unwrapUrl(`https://dest.example/url?q=${enc}`), null);
  assert.equal(unwrapUrl(`https://google.com.evil.example/url?q=${enc}`), null);
  assert.equal(unwrapUrl(`https://www.google.com/search?q=${enc}`), null);
  assert.equal(unwrapUrl('https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmail.google.com'), null);
  assert.equal(unwrapUrl('garbage'), null);
});
test('keeps OAuth targets intact', () => {
  const target = 'https://app.example/oauth/authorize?client_id=1&utm_source=x';
  assert.equal(unwrapUrl(`https://www.google.com/url?q=${encodeURIComponent(target)}`), target);
});

console.log(failures ? `\n${failures} unit check(s) failed` : '\nall link-cleaning unit checks passed');
process.exit(failures ? 1 : 0);
