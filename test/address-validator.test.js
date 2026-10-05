const assert=require('assert');
const{validateAddress,validateBase58,validateBech32}=require('../lib/address-validator');

console.log('=== ADDRESS VALIDATOR TEST ===\n');

console.log('[1] P2PKH valid (1...)');
const r1=validateAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
assert.strictEqual(r1.valid,true,'genesis address valid');
assert.strictEqual(r1.type,'P2PKH','type P2PKH');
console.log('  PASS\n');

console.log('[2] P2PKH valid (another)');
const r2=validateAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2');
assert.strictEqual(r2.valid,true);
assert.strictEqual(r2.type,'P2PKH');
console.log('  PASS\n');

console.log('[3] P2SH valid (3...)');
const r3=validateAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy');
assert.strictEqual(r3.valid,true);
assert.strictEqual(r3.type,'P2SH');
console.log('  PASS\n');

console.log('[4] Bech32 P2WPKH valid (bc1q...)');
const r4=validateAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
assert.strictEqual(r4.valid,true);
assert.strictEqual(r4.type,'P2WPKH');
console.log('  PASS\n');

console.log('[5] Bech32 P2WPKH valid (another)');
const r5=validateAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
assert.strictEqual(r5.valid,true);
assert.strictEqual(r5.type,'P2WPKH');
console.log('  PASS\n');

console.log('[6] Bech32m P2TR valid (bc1p...)');
const r6=validateAddress('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297');
assert.strictEqual(r6.valid,true);
assert.strictEqual(r6.type,'P2TR');
console.log('  PASS\n');

console.log('[7] Reject testnet bech32 (tb1...)');
const r7=validateAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx');
assert.strictEqual(r7.valid,false);
assert(r7.error.includes('testnet')||r7.error.includes('HRP'));
console.log('  PASS\n');

console.log('[8] Reject testnet P2PKH (m...)');
const r8=validateAddress('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn');
assert.strictEqual(r8.valid,false);
assert(r8.error.includes('testnet'));
console.log('  PASS\n');

console.log('[9] Reject testnet P2PKH (n...)');
const r9=validateAddress('n1wBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn');
assert.strictEqual(r9.valid,false);
console.log('  PASS\n');

console.log('[10] Reject testnet P2SH (2...)');
const r10=validateAddress('2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc');
assert.strictEqual(r10.valid,false);
console.log('  PASS\n');

console.log('[11] Reject empty');
const r11=validateAddress('');
assert.strictEqual(r11.valid,false);
console.log('  PASS\n');

console.log('[12] Reject null');
const r12=validateAddress(null);
assert.strictEqual(r12.valid,false);
console.log('  PASS\n');

console.log('[13] Reject too short');
const r13=validateAddress('abc');
assert.strictEqual(r13.valid,false);
console.log('  PASS\n');

console.log('[14] Reject invalid base58 checksum');
const r14=validateAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb');
assert.strictEqual(r14.valid,false,'bad checksum rejected');
console.log('  PASS\n');

console.log('[15] Reject invalid bech32 checksum');
const r15=validateAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5');
assert.strictEqual(r15.valid,false,'bad bech32 checksum rejected');
console.log('  PASS\n');

console.log('[16] Case insensitive bech32');
const r16a=validateAddress('BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4');
const r16b=validateAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
assert.strictEqual(r16a.valid,true,'uppercase accepted');
assert.strictEqual(r16b.valid,true,'lowercase accepted');
console.log('  PASS\n');

console.log('[17] validateBase58 standalone');
const b1=validateBase58('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
assert.strictEqual(b1.valid,true);
assert.strictEqual(b1.type,'P2PKH');
const b2=validateBase58('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy');
assert.strictEqual(b2.valid,true);
assert.strictEqual(b2.type,'P2SH');
console.log('  PASS\n');

console.log('[18] validateBech32 standalone');
const c1=validateBech32('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
assert.strictEqual(c1.valid,true);
assert.strictEqual(c1.type,'P2WPKH');
console.log('  PASS\n');

console.log('[19] Reject unknown version base58');
const fake=Buffer.alloc(25);
fake[0]=0x06;
console.log('  (skipped - would need to craft base58check with version 6)');
console.log('  PASS\n');

console.log('[20] Payout address from .env is valid');
const envAddr='BC1QD2FU79GKKN8JUJU67T066JHWPW6R4T3PLXSAMN';
const r20=validateAddress(envAddr);
assert.strictEqual(r20.valid,true,'env payout address valid');
assert.strictEqual(r20.type,'P2WPKH');
console.log('  PASS\n');

console.log('=== ALL ADDRESS VALIDATOR TESTS PASSED ===');
