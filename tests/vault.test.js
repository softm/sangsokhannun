import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, validateState } from '../src/domain.js';
import {
  MAX_BACKUP_BYTES, createVault, seal, openVault, parseEnvelope, storedVault, storeVault, removeVault,
} from '../src/vault.js';

const password = 'test-only-password-2026';
function sample() {
  const state = createInitialState();
  state.assets = [{ id: 'test-property', label: '암호화 검증용 재산', category: 'realestate', amount: 812345678, share: 50, verified: true }];
  state.debts = [{ id: 'test-loan', label: '미확인 검증용 채무', category: 'loan', amount: null, share: 100, verified: false }];
  state.tasks.family = true;
  return state;
}

test('real WebCrypto round trip preserves Korean data, unknown amounts, and state validation', async () => {
  const state = sample();
  const { envelope, session } = await createVault(state, password);
  const raw = JSON.stringify(envelope);
  assert.equal(session.key.extractable, false);
  assert.equal(session.key.algorithm.name, 'AES-GCM');
  assert.equal(session.key.algorithm.length, 256);
  assert.equal(raw.includes(state.assets[0].label), false);
  assert.equal(raw.includes('812345678'), false);
  const opened = await openVault(raw, password, validateState);
  assert.deepEqual(opened.state, state);
  assert.equal(opened.state.debts[0].amount, null);
});

test('each save uses a fresh nonce with the retained key; each vault uses a fresh salt', async () => {
  const state = sample();
  const first = await createVault(state, password);
  const secondSave = await seal(state, first.session);
  assert.notEqual(secondSave.iv, first.envelope.iv);
  assert.notEqual(secondSave.data, first.envelope.data);
  assert.equal(secondSave.salt, first.envelope.salt);
  assert.deepEqual((await openVault(JSON.stringify(secondSave), password, validateState)).state, state);
  const anotherVault = await createVault(state, password);
  assert.notEqual(anotherVault.envelope.salt, first.envelope.salt);
});

test('wrong password cannot decrypt and leaves the supplied envelope unchanged', async () => {
  const { envelope } = await createVault(sample(), password);
  const before = structuredClone(envelope);
  await assert.rejects(openVault(JSON.stringify(envelope), 'incorrect-password', validateState), /비밀번호가 맞지 않거나/);
  assert.deepEqual(envelope, before);
  assert.deepEqual((await openVault(JSON.stringify(envelope), password, validateState)).state, sample());
});

test('ciphertext, nonce, salt and authentication tag tampering are rejected', async () => {
  const { envelope } = await createVault(sample(), password);
  for (const key of ['data', 'iv', 'salt']) {
    const copy = structuredClone(envelope);
    const bytes = Buffer.from(copy[key], 'base64');
    bytes[0] ^= 0x01;
    copy[key] = bytes.toString('base64');
    await assert.rejects(openVault(JSON.stringify(copy), password, validateState), /비밀번호가 맞지 않거나/);
  }
  const tagChanged = structuredClone(envelope);
  const data = Buffer.from(tagChanged.data, 'base64');
  data[data.length - 1] ^= 0x01;
  tagChanged.data = data.toString('base64');
  await assert.rejects(openVault(JSON.stringify(tagChanged), password, validateState), /비밀번호가 맞지 않거나/);
});

test('plaintext state JSON, unrelated JSON and unknown envelope fields are refused', () => {
  for (const raw of [JSON.stringify(sample()), '{}', 'null', '[]', '{broken']) {
    assert.throws(() => parseEnvelope(raw));
  }
});

test('untrusted KDF work factors and algorithm changes are refused before key derivation', async () => {
  const { envelope } = await createVault(sample(), password);
  for (const mutation of [
    { iterations: 1 }, { iterations: 999_999_999 }, { iterations: '310000' },
    { kdf: 'PBKDF2-SHA1' }, { cipher: 'AES-CBC' }, { version: 2 },
    { application: 'another-app' }, { extra: 'unexpected' },
  ]) {
    assert.throws(() => parseEnvelope(JSON.stringify({ ...envelope, ...mutation })), /지원하지 않는/);
  }
  const polluted = JSON.stringify(envelope).replace('{', '{"__proto__":{},');
  assert.throws(() => parseEnvelope(polluted), /지원하지 않는/);
});

test('oversized backups, malformed base64, invalid salt/nonce lengths and short tags are refused', async () => {
  const { envelope } = await createVault(sample(), password);
  assert.throws(() => parseEnvelope(' '.repeat(MAX_BACKUP_BYTES + 1)), /2MB/);
  for (const mutation of [
    { data: '*not-base64*' },
    { salt: Buffer.alloc(15).toString('base64') },
    { salt: Buffer.alloc(17).toString('base64') },
    { iv: Buffer.alloc(11).toString('base64') },
    { iv: Buffer.alloc(13).toString('base64') },
    { data: Buffer.alloc(15).toString('base64') },
    { data: Buffer.alloc(MAX_BACKUP_BYTES + 1).toString('base64') },
  ]) assert.throws(() => parseEnvelope(JSON.stringify({ ...envelope, ...mutation })));
});

test('successful decryption still requires valid domain state and rejects unsafe imported records', async () => {
  const invalid = sample();
  invalid.assets[0].amount = '812345678';
  const { envelope } = await createVault(invalid, password);
  await assert.rejects(openVault(JSON.stringify(envelope), password, validateState), /백업 자료를 확인할 수 없습니다/);
});

test('password length and excessive plaintext are rejected', async () => {
  await assert.rejects(createVault(sample(), 'short'), /8자/);
  await assert.rejects(createVault(sample(), 'x'.repeat(1025)), /비밀번호/);
  const { session } = await createVault(sample(), password);
  await assert.rejects(seal({ payload: 'x'.repeat(MAX_BACKUP_BYTES) }, session), /너무 큽니다/);
});

test('storage read, write and removal failures surface errors rather than implying empty data or success', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem() { throw new Error('blocked read'); },
    setItem() { throw new Error('quota exceeded'); },
    removeItem() { throw new Error('blocked storage'); },
  } });
  try {
    assert.throws(() => storedVault(), /읽을 수 없습니다/);
    assert.throws(() => storeVault({ application: 'test' }), /기기 저장 공간/);
    assert.throws(() => removeVault(), /삭제할 수 없습니다/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
