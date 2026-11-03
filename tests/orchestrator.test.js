const test = require('node:test');
const assert = require('node:assert/strict');
const { jaccardSimilarity, tokenize } = require('../src/orchestrator');

test('tokenize supports English and Chinese text', () => {
  const tokens = tokenize('Implement login API 实现登录');
  assert.ok(tokens.has('implement'));
  assert.ok(tokens.has('login'));
  assert.ok(tokens.has('实现'));
});

test('similar login tasks receive a high similarity score', () => {
  const score = jaccardSimilarity(
    'Implement the login API with password hashing',
    'Implement login API and password hashing'
  );
  assert.ok(score > 0.4, `expected high similarity, received ${score}`);
});

test('unrelated tasks receive a low similarity score', () => {
  const score = jaccardSimilarity(
    'Implement the login API',
    'Create a dashboard chart for task status'
  );
  assert.ok(score < 0.15, `expected low similarity, received ${score}`);
});
