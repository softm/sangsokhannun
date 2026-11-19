import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState, validateState, summarizeEstate, calculateShares, calculateTax,
  calculateDeadlines, parseDate, addCalendarMonths, SOURCES, TASKS, MAX_AMOUNT,
} from '../src/domain.js';

const item = (id, amount, extra = {}) => ({ id, label: '검증용 입력', category: 'real-estate', amount, share: 100, verified: true, ...extra });
const scenario = (estate = 1_200_000_000, info = {}) => {
  const state = createInitialState();
  Object.assign(state.case, { children: 2, spouse: true, scopeConfirmed: true, inventoryComplete: true }, info);
  state.assets.push(item('property', estate));
  return state;
};

test('initial state is empty, valid, and does not silently calculate zero tax', () => {
  const state = createInitialState();
  assert.equal(validateState(state).valid, true);
  assert.deepEqual(state.assets, []);
  assert.deepEqual(state.debts, []);
  assert.equal(summarizeEstate(state).net, null);
  assert.equal(calculateTax(state).supported, false);
  const another = createInitialState();
  state.assets.push(item('not-shared', 0));
  assert.equal(another.assets.length, 0);
});

test('explicit zero and unknown amount remain different through validation and totals', () => {
  const state = scenario(0);
  assert.equal(calculateTax(state).supported, true);
  assert.equal(calculateTax(state).estimatedTax, 0);
  state.assets.push(item('unknown', null));
  assert.equal(validateState(state).valid, true);
  const summary = summarizeEstate(state);
  assert.equal(summary.assets, 0);
  assert.equal(summary.unknownCount, 1);
  assert.equal(summary.complete, false);
  assert.equal(summary.net, null);
  assert.equal(calculateTax(state).estimatedTax, null);
});

test('partial ownership and debt burden use fixed-point won arithmetic', () => {
  const state = scenario(800_000_000);
  state.assets[0].share = 50;
  state.debts.push(item('loan', 100_000_000, { category: 'loan', share: 50 }));
  const result = summarizeEstate(state);
  assert.equal(result.assets, 400_000_000);
  assert.equal(result.debts, 50_000_000);
  assert.equal(result.net, 350_000_000);
  state.assets[0] = item('property', MAX_AMOUNT, { share: 33.33 });
  assert.equal(summarizeEstate(state).assets, 333_300_000_000);
  state.assets[0] = item('property', 101, { share: 33.33 });
  assert.equal(summarizeEstate(state).assets, 33);
});

test('unverified entries cannot produce complete estate or tax', () => {
  const state = scenario();
  state.assets[0].verified = false;
  assert.equal(summarizeEstate(state).unverifiedCount, 1);
  assert.equal(summarizeEstate(state).confirmedAssets, 0);
  assert.equal(summarizeEstate(state).complete, false);
  assert.equal(calculateTax(state).supported, false);
});

test('both explicit inventory and scope confirmations are required', () => {
  const state = scenario();
  state.case.inventoryComplete = false;
  assert.equal(calculateTax(state).supported, false);
  state.case.inventoryComplete = true;
  state.case.scopeConfirmed = false;
  assert.equal(calculateTax(state).supported, false);
});

test('spouse and two children produce exact statutory fractions', () => {
  const result = calculateShares(scenario().case);
  assert.equal(result.supported, true);
  assert.deepEqual(result.shares.map((entry) => entry.fraction), ['3/7', '2/7', '2/7']);
  assert.ok(Math.abs(result.shares.reduce((total, entry) => total + entry.percent, 0) - 100) < 0.00000001);
});

test('children alone get equal fractions and other family configurations are blocked', () => {
  assert.deepEqual(calculateShares(scenario(0, { spouse: false, children: 3 }).case).shares.map((entry) => entry.fraction), ['1/3', '1/3', '1/3']);
  assert.deepEqual(calculateShares(scenario(0, { spouse: false, children: 1 }).case).shares.map((entry) => entry.fraction), ['1/1']);
  assert.equal(calculateShares(scenario(0, { children: 0 }).case).supported, false);
  assert.equal(calculateShares(scenario(0, { complex: true }).case).supported, false);
  assert.equal(calculateShares(scenario(0, { foreign: true }).case).supported, false);
});

test('basic spouse/children deductions and progressive tax are separated from final payable tax', () => {
  const result = calculateTax(scenario());
  assert.equal(result.supported, true);
  assert.equal(result.estateValue, 1_200_000_000);
  assert.equal(result.baseDeduction, 500_000_000);
  assert.equal(result.spouseDeduction, 500_000_000);
  assert.equal(result.taxableBase, 200_000_000);
  assert.equal(result.rate, 0.2);
  assert.equal(result.progressiveDeduction, 10_000_000);
  assert.equal(result.estimatedTax, 30_000_000);
  assert.ok(result.excluded.some((value) => value.includes('신고세액공제')));
  assert.ok(result.assumptions.some((value) => value.includes('최종 신고·납부세액이 아님')));
});

test('all progressive thresholds and adjacent values follow the official schedule', () => {
  const cases = [
    [0, 0], [100_000_000, 10_000_000], [100_000_010, 10_000_002],
    [500_000_000, 90_000_000], [500_000_010, 90_000_003],
    [1_000_000_000, 240_000_000], [1_000_000_010, 240_000_004],
    [3_000_000_000, 1_040_000_000], [3_000_000_010, 1_040_000_005],
  ];
  for (const [base, expected] of cases) {
    const result = calculateTax(scenario(base + 500_000_000, { spouse: false }));
    assert.equal(result.taxableBase, base);
    assert.equal(result.estimatedTax, expected);
  }
});

test('deductions never exceed the entered net estate', () => {
  const result = calculateTax(scenario(700_000_000));
  assert.equal(result.totalDeduction, 700_000_000);
  assert.equal(result.spouseDeduction, 200_000_000);
  assert.equal(result.taxableBase, 0);
  assert.equal(result.estimatedTax, 0);
});

test('negative estate prompts debt review instead of showing zero tax', () => {
  const state = scenario(100_000);
  state.debts.push(item('loan', 200_000));
  assert.equal(summarizeEstate(state).net, -100_000);
  assert.equal(calculateTax(state).supported, false);
  assert.match(calculateTax(state).reason, /채무/);
});

test('unsupported years, cross-border relations and special assets are blocked', () => {
  for (const info of [{ foreign: true }, { complex: true }, { children: 0 }, { deathDate: '2025-11-19' }, { deathDate: '2027-01-01' }]) {
    assert.equal(calculateTax(scenario(1_200_000_000, info)).supported, false);
  }
  for (const category of ['insurance', 'trust', 'business', '해외재산', '보험금']) {
    const state = scenario(); state.assets[0].category = category;
    assert.equal(calculateTax(state).supported, false);
  }
});

test('invalid numbers, coercible strings and precision loss are rejected', () => {
  for (const amount of [-1, 0.1, NaN, Infinity, '123', undefined, MAX_AMOUNT + 1]) {
    const state = scenario(); state.assets[0].amount = amount;
    assert.equal(validateState(state).valid, false);
    assert.equal(calculateTax(state).supported, false);
  }
  for (const share of [0, -1, 100.01, NaN, '50', 33.333]) {
    const state = scenario(); state.assets[0].share = share;
    assert.equal(validateState(state).valid, false);
  }
});

test('import rejects unknown fields, duplicate IDs, oversized strings and unsupported tasks', () => {
  const tooLong = scenario(); tooLong.assets[0].label = '가'.repeat(201);
  assert.equal(validateState(tooLong).valid, false);
  const duplicate = scenario(); duplicate.debts.push(item('property', 100));
  assert.equal(validateState(duplicate).valid, false);
  const oversized = scenario(); oversized.assets = Array.from({ length: 301 }, (_, i) => item(`a${i}`, 1));
  assert.equal(validateState(oversized).valid, false);
  const malicious = JSON.parse(JSON.stringify(scenario()).replace('"tasks":{}', '"tasks":{"__proto__":true}'));
  assert.equal(validateState(malicious).valid, false);
  assert.equal(validateState({ ...scenario(), unexpected: true }).valid, false);
  const invalidTask = scenario(); invalidTask.tasks[TASKS[0].id] = 'true';
  assert.equal(validateState(invalidTask).valid, false);
});

test('validation creates an independent sanitized state', () => {
  const original = scenario(); original.tasks[TASKS[0].id] = true;
  const { value } = validateState(original);
  value.assets[0].label = 'changed';
  value.case.spouse = false;
  value.tasks[TASKS[0].id] = false;
  assert.equal(original.assets[0].label, '검증용 입력');
  assert.equal(original.case.spouse, true);
  assert.equal(original.tasks[TASKS[0].id], true);
});

test('calendar parsing is strict and handles leap years', () => {
  for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '26-01-01', '2026-1-1', '2026-01-01T00:00:00Z']) assert.equal(parseDate(value), null);
  assert.equal(parseDate('2024-02-29').toISOString(), '2024-02-29T00:00:00.000Z');
  assert.equal(addCalendarMonths('2026-11-19', 3), '2027-02-19');
  assert.equal(addCalendarMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(addCalendarMonths('2024-02-29', 12), '2025-02-28');
});

test('deadlines use awareness date for acceptance and month end for tax and inquiry', () => {
  const info = scenario(0, { mode: 'process', deathDate: '2026-11-19', knownDate: '2026-11-20' }).case;
  const results = Object.fromEntries(calculateDeadlines(info).map((deadline) => [deadline.id, deadline]));
  assert.equal(results.acceptance.date, '2027-02-20');
  assert.equal(results['inheritance-tax'].date, '2027-05-31');
  assert.equal(results['safe-inheritance'].date, '2027-11-30');
  assert.equal(results.acceptance.provisional, true);
  assert.match(results.acceptance.note, /공휴일/);
});

test('February and cross-year tax deadlines preserve target month end', () => {
  const info = scenario(0, { deathDate: '2026-02-10', knownDate: '2026-02-10' }).case;
  assert.equal(calculateDeadlines(info).find((entry) => entry.id === 'inheritance-tax').date, '2026-08-31');
  info.deathDate = '2024-02-29'; info.knownDate = '2024-02-29';
  assert.equal(calculateDeadlines(info).find((entry) => entry.id === 'safe-inheritance').date, '2025-02-28');
});

test('missing or invalid dates never fabricate deadlines; foreign cases omit domestic tax date', () => {
  assert.deepEqual(calculateDeadlines(createInitialState().case), []);
  const info = scenario(0, { deathDate: '2026-11-19', knownDate: '2026-11-18' }).case;
  assert.deepEqual(calculateDeadlines(info), []);
  info.knownDate = '2026-11-19'; info.foreign = true;
  assert.equal(calculateDeadlines(info).some((entry) => entry.id === 'inheritance-tax'), false);
});

test('every public source and task has a reviewed official HTTPS citation', () => {
  for (const entry of SOURCES) {
    assert.match(entry.url, /^https:\/\/www\.(?:(?:nts|easylaw|law)\.go\.kr|gov\.kr)\//);
    assert.equal(entry.checkedAt, '2026-11-19');
  }
  for (const entry of TASKS) assert.ok(SOURCES.some((candidate) => candidate.url === entry.sourceUrl));
});
