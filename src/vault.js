/** Password-protected local vault. Plaintext and keys are never persisted. */
export const STORAGE_KEY = 'sangsokhannun.vault.v1';
export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
const ITERATIONS = 310000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const to64 = bytes => btoa(String.fromCharCode(...bytes));
function from64(text, maxBytes) {
  if (typeof text !== 'string' || text.length > maxBytes * 2 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error('백업 파일의 암호화 형식이 올바르지 않습니다.');
  const decoded = atob(text);
  if (decoded.length > maxBytes) throw new Error('백업 파일이 너무 큽니다.');
  return Uint8Array.from(decoded, char => char.charCodeAt(0));
}
function requireCrypto() {
  if (!globalThis.crypto?.subtle) throw new Error('암호화 저장은 HTTPS 또는 localhost에서 사용할 수 있습니다.');
}
function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 1024) throw new Error('비밀번호는 8자 이상으로 입력해 주세요.');
}
async function derive(password, salt) {
  requireCrypto(); checkPassword(password);
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:ITERATIONS}, material, {name:'AES-GCM',length:256}, false, ['encrypt','decrypt']);
}
export async function seal(state, session) {
  requireCrypto();
  const plaintext = encoder.encode(JSON.stringify(state));
  if (plaintext.length > MAX_BACKUP_BYTES / 2) throw new Error('저장할 자료가 너무 큽니다.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('sangsokhannun:v1')},session.key,plaintext);
  // Chunk conversion avoids stack overflow for larger records.
  let binary = ''; const bytes = new Uint8Array(encrypted);
  for(let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
  return {application:'sangsokhannun',version:1,kdf:'PBKDF2-SHA256',iterations:ITERATIONS,cipher:'AES-GCM',salt:to64(session.salt),iv:to64(iv),data:btoa(binary)};
}
export async function createVault(state,password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const session = {salt,key:await derive(password,salt)};
  return {session,envelope:await seal(state,session)};
}
export function parseEnvelope(raw) {
  if(typeof raw!=='string' || new Blob([raw]).size > MAX_BACKUP_BYTES) throw new Error('백업 파일은 2MB 이하만 가져올 수 있습니다.');
  let env; try{env=JSON.parse(raw);}catch{throw new Error('상속한눈 백업 파일을 선택해 주세요.');}
  if(!env || typeof env!=='object' || Array.isArray(env) || env.application!=='sangsokhannun' || env.version!==1 || env.kdf!=='PBKDF2-SHA256' || env.iterations!==ITERATIONS || env.cipher!=='AES-GCM' || Object.keys(env).some(k=>!['application','version','kdf','iterations','cipher','salt','iv','data'].includes(k))) throw new Error('지원하지 않는 백업 파일 형식입니다.');
  const salt = from64(env.salt,16), iv = from64(env.iv,12), data = from64(env.data,MAX_BACKUP_BYTES);
  if(salt.length!==16 || iv.length!==12 || data.length<16) throw new Error('백업 파일이 손상되었습니다.');
  return {envelope:env,salt,iv,data};
}
export async function openVault(raw,password,validate) {
  const parsed = parseEnvelope(raw);
  const key = await derive(password,parsed.salt);
  let plaintext;
  try {plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:parsed.iv,additionalData:encoder.encode('sangsokhannun:v1')},key,parsed.data);}
  catch{throw new Error('비밀번호가 맞지 않거나 백업 파일이 손상되었습니다.');}
  let decoded; try {decoded=JSON.parse(decoder.decode(plaintext));}catch{throw new Error('백업 내용이 올바르지 않습니다.');}
  const result=validate(decoded);
  if(!result.valid) throw new Error('백업 자료를 확인할 수 없습니다: '+result.errors.slice(0,2).join(', '));
  return {state:result.value,session:{salt:parsed.salt,key},envelope:parsed.envelope};
}
export function storedVault() {try{return localStorage.getItem(STORAGE_KEY);}catch{throw new Error('브라우저 저장 공간을 읽을 수 없습니다. 지금은 임시로 이용하고, 자료는 암호화 백업으로 보관해 주세요.');}}
export function storeVault(envelope) {try{localStorage.setItem(STORAGE_KEY,JSON.stringify(envelope));}catch{throw new Error('기기 저장 공간을 사용할 수 없습니다. 백업 파일을 내려받아 주세요.');}}
export function removeVault() {try{localStorage.removeItem(STORAGE_KEY);}catch{throw new Error('이 브라우저에서 저장된 자료를 삭제할 수 없습니다. 브라우저 설정에서 사이트 데이터를 삭제해 주세요.');}}
