/**
 * 상속한눈: deterministic, browser-independent reference calculations.
 * Reviewed against the official sources below on 2026-11-19.
 * This deliberately supports a narrow case; missing facts never become zero tax.
 */
export const RULES_CHECKED_AT = '2026-11-19';
export const MAX_RECORDS = 300;
export const MAX_AMOUNT = 1_000_000_000_000;

export const SOURCES = Object.freeze([
  { id: 'tax-flow', title: '국세청 · 상속세 세액계산 흐름도', url: 'https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7720&mi=2274', checkedAt: RULES_CHECKED_AT },
  { id: 'deductions', title: '국세청 · 상속공제', url: 'https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7956', checkedAt: RULES_CHECKED_AT },
  { id: 'tax-deadline', title: '국세청 · 상속세 신고납부기한', url: 'https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7719&mi=2273', checkedAt: RULES_CHECKED_AT },
  { id: 'safe-inheritance', title: '정부24 · 안심상속 재산조회 통합신청', url: 'https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=17400000001', checkedAt: RULES_CHECKED_AT },
  { id: 'acceptance', title: '생활법령정보 · 상속 한정승인의 개념 및 방법', url: 'https://www.easylaw.go.kr/CSP/CnpClsMain.laf?ccfNo=4&cciNo=3&cnpClsNo=1&csmSeq=255', checkedAt: RULES_CHECKED_AT },
  { id: 'shares', title: '국가법령정보센터 · 민법 제1009조 법정상속분', url: 'https://www.law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1017151947', checkedAt: RULES_CHECKED_AT },
  { id: 'periods', title: '국가법령정보센터 · 민법 제157조·제160조·제161조 기간 계산', url: 'https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsId=001706&lsJoLnkSeq=900155596&print=print', checkedAt: RULES_CHECKED_AT },
]);

const source = (id) => SOURCES.find((item) => item.id === id).url;

export const TASKS = Object.freeze([
  { id: 'family', label: '가족관계 확인하기', description: '배우자·자녀 등 가족관계를 정리하고, 다른 상속관계가 있으면 별도 검토하세요.', group: 'prepare', sourceUrl: source('shares') },
  { id: 'inventory', label: '재산과 채무 목록 만들기', description: '부동산, 금융재산, 받을 돈과 갚을 돈을 나누어 기록하세요. 모르는 금액은 미확인으로 남겨두세요.', group: 'prepare', sourceUrl: source('tax-flow') },
  { id: 'documents', label: '증빙과 보관 위치 확인하기', description: '계약서, 잔액 증명, 차용증 등의 보관 위치와 준비 여부를 확인하세요.', group: 'prepare', sourceUrl: source('tax-deadline') },
  { id: 'gifts', label: '과거 증여·보험·특수재산 확인하기', description: '사전증여, 보험금, 신탁, 사업재산 등 추가 검토가 필요한 항목을 확인하세요.', group: 'prepare', sourceUrl: source('tax-flow') },
  { id: 'dates', label: '사망일과 상속을 알게 된 날 확인하기', description: '절차별 기산점이 다릅니다. 가족별 인지일과 법원의 별도 결정을 확인하세요.', group: 'process', sourceUrl: source('acceptance') },
  { id: 'lookup', label: '안심상속 재산조회 신청 확인하기', description: '공식 안내에서 신청 자격·준비서류를 확인하고, 신청 결과를 재산목록에 기록하세요.', group: 'process', sourceUrl: source('safe-inheritance') },
  { id: 'debt-review', label: '채무와 승인·포기 절차 검토하기', description: '조회 결과와 미확인 채무를 확인하고, 한정승인·상속포기 관련 기한과 필요한 절차를 검토하세요.', group: 'process', sourceUrl: source('acceptance') },
  { id: 'tax-review', label: '평가액과 세금 신고 조건 확인하기', description: '재산의 평가 기준, 공제, 사전증여, 신고·납부 준비사항을 확인하세요.', group: 'process', sourceUrl: source('tax-deadline') },
  { id: 'consultation', label: '상담 준비 자료 정리하기', description: '재산목록, 미확인 사항, 가족관계와 질문을 인쇄하거나 PDF로 저장하세요.', group: 'process', sourceUrl: source('tax-flow') },
]);

export function createInitialState() {
  return {
    schemaVersion: 1,
    case: {
      mode: 'prepare', deathDate: '', knownDate: '', spouse: false, children: 0,
      foreign: false, complex: false, scopeConfirmed: false, inventoryComplete: false,
    },
    assets: [], debts: [], tasks: {},
  };
}

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const allowedKeys = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
const limitedText = (value, max, empty = false) => typeof value === 'string' && value.length <= max &&
  (empty || value.trim().length > 0) && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value);

/** Strict YYYY-MM-DD. No implicit timezone parsing or Date rollover. */
export function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function validCase(info, errors) {
  if (!object(info) || !allowedKeys(info, Object.keys(createInitialState().case))) {
    errors.push('사례 정보의 형식이 올바르지 않습니다.'); return null;
  }
  if (!['prepare', 'process'].includes(info.mode)) errors.push('진행 모드를 확인하세요.');
  if (!['deathDate', 'knownDate'].every((key) => info[key] === '' || parseDate(info[key]))) errors.push('날짜는 실제 존재하는 YYYY-MM-DD 형식이어야 합니다.');
  if (info.deathDate && info.knownDate && info.knownDate < info.deathDate) errors.push('상속을 알게 된 날은 사망일보다 빠를 수 없습니다.');
  for (const key of ['spouse', 'foreign', 'complex', 'scopeConfirmed', 'inventoryComplete']) {
    if (typeof info[key] !== 'boolean') errors.push('사례 확인 항목은 참 또는 거짓이어야 합니다.');
  }
  if (!Number.isInteger(info.children) || info.children < 0 || info.children > 30) errors.push('자녀 수는 0명부터 30명까지 입력하세요.');
  return errors.length ? null : { ...info };
}

/** Returns a sanitized state, never mutates or coerces the input. */
export function validateState(input) {
  const errors = [];
  if (!object(input) || !allowedKeys(input, ['schemaVersion', 'case', 'assets', 'debts', 'tasks']) || input.schemaVersion !== 1) {
    return { valid: false, errors: ['지원하지 않는 자료 형식입니다.'], value: null };
  }
  const info = validCase(input.case, errors);
  const collections = {};
  const ids = new Set();
  for (const key of ['assets', 'debts']) {
    if (!Array.isArray(input[key]) || input[key].length > MAX_RECORDS) {
      errors.push(`재산·채무는 각각 ${MAX_RECORDS}개까지 저장할 수 있습니다.`); continue;
    }
    collections[key] = [];
    for (const item of input[key]) {
      if (!object(item) || !allowedKeys(item, ['id', 'label', 'category', 'amount', 'share', 'verified']) ||
          !limitedText(item.id, 100) || !limitedText(item.label, 200) || !limitedText(item.category, 200)) {
        errors.push('재산·채무 항목의 이름 또는 형식을 확인하세요.'); continue;
      }
      if (ids.has(item.id)) errors.push('중복된 항목 ID가 있습니다.');
      ids.add(item.id);
      if (item.amount !== null && (!Number.isSafeInteger(item.amount) || item.amount < 0 || item.amount > MAX_AMOUNT)) errors.push('금액은 0원부터 1조 원까지의 정수 또는 미확인이어야 합니다.');
      if (typeof item.share !== 'number' || !Number.isFinite(item.share) || item.share <= 0 || item.share > 100 || Math.abs(item.share * 100 - Math.round(item.share * 100)) > 0.000001) errors.push('소유·부담 비율은 0% 초과 100% 이하, 소수점 둘째 자리까지 입력하세요.');
      if (typeof item.verified !== 'boolean') errors.push('항목의 확인 상태가 올바르지 않습니다.');
      collections[key].push({ id: item.id, label: item.label, category: item.category, amount: item.amount, share: item.share, verified: item.verified });
    }
  }
  const taskIds = TASKS.map((task) => task.id);
  if (!object(input.tasks) || !allowedKeys(input.tasks, taskIds) || Object.values(input.tasks).some((done) => typeof done !== 'boolean')) errors.push('할 일 기록의 형식이 올바르지 않습니다.');
  if (errors.length) return { valid: false, errors: [...new Set(errors)], value: null };
  return { valid: true, errors: [], value: { schemaVersion: 1, case: info, assets: collections.assets, debts: collections.debts, tasks: { ...input.tasks } } };
}

function attributableAmount(item) {
  // Fixed point basis points and BigInt avoid loss at the 1 trillion won limit.
  return Number(BigInt(item.amount) * BigInt(Math.round(item.share * 100)) / 10_000n);
}

export function summarizeEstate(state) {
  const validation = validateState(state);
  if (!validation.valid) return { valid: false, errors: validation.errors, assets: 0, debts: 0, net: null, knownNet: null, assetCount: 0, debtCount: 0, unknownCount: 0, unverifiedCount: 0, confirmedAssets: 0, confirmedDebts: 0, complete: false };
  const data = validation.value;
  const all = [...data.assets, ...data.debts];
  const sum = (items, onlyVerified = false) => items.reduce((total, item) => total + (item.amount !== null && (!onlyVerified || item.verified) ? attributableAmount(item) : 0), 0);
  const assets = sum(data.assets);
  const debts = sum(data.debts);
  const unknownCount = all.filter((item) => item.amount === null).length;
  const unverifiedCount = all.filter((item) => !item.verified).length;
  const complete = all.length > 0 && unknownCount === 0 && unverifiedCount === 0 && data.case.inventoryComplete;
  return {
    valid: true, errors: [], assets, debts, knownNet: assets - debts, net: complete ? assets - debts : null,
    assetCount: data.assets.length, debtCount: data.debts.length, unknownCount, unverifiedCount,
    confirmedAssets: sum(data.assets, true), confirmedDebts: sum(data.debts, true), complete,
  };
}

const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);

export function calculateShares(info) {
  const errors = [];
  if (!validCase(info, errors)) return { supported: false, reason: errors[0], shares: [] };
  if (info.foreign || info.complex) return { supported: false, reason: '해외 관계 또는 유언·대습상속·포기·기여분 등 별도 검토가 필요한 경우에는 기본 계산을 제공하지 않습니다.', shares: [] };
  if (info.children < 1) return { supported: false, reason: '이 계산은 자녀가 있는 일반적인 공동상속 사례를 지원합니다. 배우자만 있거나 자녀가 없으면 부모 등 다른 상속관계를 확인해야 합니다.', shares: [] };
  const total = info.children * 2 + (info.spouse ? 3 : 0);
  const entry = (label, unit) => {
    const divisor = gcd(unit, total);
    return { label, numerator: unit / divisor, denominator: total / divisor, fraction: `${unit / divisor}/${total / divisor}`, percent: unit / total * 100 };
  };
  const shares = info.spouse ? [entry('배우자', 3)] : [];
  for (let index = 1; index <= info.children; index += 1) shares.push(entry(`자녀 ${index}`, 2));
  return { supported: true, reason: '', shares, sourceUrl: source('shares'), note: '유언·협의분할·대습상속·기여분 등을 반영하지 않은 법정상속분 참고값입니다.' };
}

const TAX_EXCLUSIONS = Object.freeze([
  '배우자가 실제 상속받는 금액에 따른 5억 원 초과 공제',
  '기초공제와 그 밖의 인적공제를 합산한 유리한 공제 비교',
  '금융재산·동거주택·가업·영농 등 추가 공제와 장례비용·공과금',
  '신고세액공제·증여세액공제·가산세·분납 등 최종 납부세액 조정',
  '부동산 취득세·등기비용 등 상속세 외 비용',
]);

function unsupportedTax(reason) {
  return { supported: false, reason, estateValue: null, baseDeduction: null, spouseDeduction: null, totalDeduction: null, taxableBase: null, rate: null, progressiveDeduction: null, estimatedTax: null, assumptions: [], excluded: [...TAX_EXCLUSIONS], checkedAt: RULES_CHECKED_AT, sourceUrl: source('tax-flow') };
}

export function calculateTax(state) {
  const validation = validateState(state);
  if (!validation.valid) return unsupportedTax(validation.errors[0]);
  const data = validation.value;
  if (data.case.foreign || data.case.complex) return unsupportedTax('해외 관계·사전증여·유언·상속포기·특수재산 등 별도 검토 항목이 있는 사례는 상세 검토가 필요합니다.');
  if (!data.case.scopeConfirmed) return unsupportedTax('기본 계산의 적용 조건을 먼저 확인해 주세요.');
  if (data.case.children < 1) return unsupportedTax('기본 세금 계산은 자녀가 있는 일반 상속만 지원합니다. 배우자 단독 등 다른 상속관계는 공제 요건을 별도로 확인해야 합니다.');
  if (data.case.deathDate && data.case.deathDate.slice(0, 4) !== '2026') return unsupportedTax('이 버전은 2026년 기준 기본 산식을 사용합니다. 다른 연도의 상속에는 당시 법령 확인이 필요합니다.');
  if (data.assets.some((item) => /insurance|trust|business|foreign|gift|보험|신탁|사업|해외|증여/i.test(item.category))) return unsupportedTax('보험·신탁·사업·해외·증여 관련 재산은 과세 관계를 별도로 확인해야 합니다.');
  const estate = summarizeEstate(data);
  if (!estate.complete) return unsupportedTax('재산·채무 금액과 확인 상태를 모두 점검하고, 전체 목록 확인을 완료해 주세요. 미확인 항목은 0원으로 계산하지 않습니다.');
  if (estate.net < 0) return unsupportedTax('입력된 채무가 재산을 초과합니다. 세금 결과보다 채무·승인·포기 절차에 대한 검토가 먼저 필요합니다.');
  const estateValue = estate.net;
  const baseDeduction = Math.min(500_000_000, estateValue);
  const spouseDeduction = data.case.spouse ? Math.min(500_000_000, Math.max(0, estateValue - baseDeduction)) : 0;
  const totalDeduction = baseDeduction + spouseDeduction;
  const taxableBase = Math.max(0, estateValue - totalDeduction);
  const brackets = [
    { max: 100_000_000, percent: 10, deduction: 0 },
    { max: 500_000_000, percent: 20, deduction: 10_000_000 },
    { max: 1_000_000_000, percent: 30, deduction: 60_000_000 },
    { max: 3_000_000_000, percent: 40, deduction: 160_000_000 },
    { max: Infinity, percent: 50, deduction: 460_000_000 },
  ];
  const bracket = brackets.find((candidate) => taxableBase <= candidate.max);
  const estimatedTax = Number(BigInt(taxableBase) * BigInt(bracket.percent) / 100n) - bracket.deduction;
  return {
    supported: true, reason: '', estateValue, baseDeduction, spouseDeduction, totalDeduction, taxableBase,
    rate: bracket.percent / 100, progressiveDeduction: bracket.deduction, estimatedTax,
    assumptions: [
      '국내 거주자·자녀가 있는 일반 상속이며, 사전증여·상속포기·유증 등 별도 검토 항목이 없다고 확인한 경우',
      '입력한 재산 평가액과 공제 가능한 채무액이 적정하다는 전제',
      `일괄공제 5억 원${data.case.spouse ? '과 배우자공제 5억 원' : ''}만 반영하되 순재산 범위 안에서 적용`,
      '개인별 세액이 아닌 전체 재산 기준 참고 산출세액이며, 최종 신고·납부세액이 아님',
      '소유·부담 비율 계산의 1원 미만은 버림',
    ],
    excluded: [...TAX_EXCLUSIONS], checkedAt: RULES_CHECKED_AT, sourceUrl: source('tax-flow'),
  };
}

const iso = (date) => date.toISOString().slice(0, 10);
const monthEnd = (year, monthIndex) => new Date(Date.UTC(year, monthIndex + 1, 0));

/** Adds calendar months and clamps a missing corresponding day to month end. */
export function addCalendarMonths(dateText, months) {
  const date = parseDate(dateText);
  if (!date || !Number.isInteger(months)) return null;
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  target.setUTCDate(Math.min(date.getUTCDate(), monthEnd(target.getUTCFullYear(), target.getUTCMonth()).getUTCDate()));
  return iso(target);
}

export function calculateDeadlines(info) {
  const errors = [];
  if (!validCase(info, errors)) return [];
  const deadlines = [];
  const provisionalNote = '토요일·공휴일·법원 연장·특별한정승인 등 예외를 반영하지 않은 참고 날짜입니다. 관할 기관에서 최종 기한을 확인하세요.';
  if (parseDate(info.knownDate)) {
    deadlines.push({ id: 'acceptance', label: '상속 승인·포기 검토', date: addCalendarMonths(info.knownDate, 3), basis: `상속개시를 안 날 ${info.knownDate}부터 원칙적으로 3개월`, provisional: true, note: provisionalNote, sourceUrl: source('acceptance') });
  }
  const death = parseDate(info.deathDate);
  if (death) {
    if (!info.foreign) deadlines.push({ id: 'inheritance-tax', label: '상속세 신고·납부', date: iso(monthEnd(death.getUTCFullYear(), death.getUTCMonth() + 6)), basis: '상속개시일이 속한 달의 말일부터 일반적으로 6개월', provisional: true, note: provisionalNote, sourceUrl: source('tax-deadline') });
    deadlines.push({ id: 'safe-inheritance', label: '안심상속 통합조회 신청', date: iso(monthEnd(death.getUTCFullYear() + 1, death.getUTCMonth())), basis: '사망일이 속한 달의 말일부터 1년 이내 신청', provisional: true, note: '신청 자격과 기관 운영일을 확인하세요. 조회 신청기한은 상속 승인·포기 기한과 다릅니다.', sourceUrl: source('safe-inheritance') });
  }
  return deadlines.sort((a, b) => a.date.localeCompare(b.date));
}
