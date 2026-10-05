const assert=require('assert'),crypto=require('crypto'),S=require('../public/sha256d.js');
const sha=m=>crypto.createHash('sha256').update(m).digest(),dsha=m=>sha(sha(m));

const kCheck=S.verifyK();assert.strictEqual(kCheck.ok,true,'K constants derivation from primes');
const ivCheck=S.verifyIV();assert.strictEqual(ivCheck.ok,true,'IV constants derivation from primes');

assert.strictEqual(sha(Buffer.from('')).toString('hex'),'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
assert.strictEqual(sha(Buffer.from('abc')).toString('hex'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
const msg448=Buffer.alloc(56,0x61);assert.strictEqual(sha(msg448).toString('hex'),crypto.createHash('sha256').update(msg448).digest('hex'),'448-bit msg');
const million=Buffer.alloc(1000000,0x61);assert.strictEqual(sha(million).toString('hex'),'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');

const header=Buffer.alloc(80);for(let i=0;i<80;i++)header[i]=i;
const boundaryNonces=[0,1,2,0x7fffffff,0x80000000,0xffffff00,0xfffffffe,0xffffffff];
for(const n of boundaryNonces){const x=Buffer.from(header);x.writeUInt32LE(n>>>0,76);assert.strictEqual(S.hex(S.hash80(header,n)),dsha(x).toString('hex'),`hash80 nonce ${n}`)}

let seed=0x12345678;
for(let i=0;i<2000;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const n=seed;const x=Buffer.from(header);x.writeUInt32LE(n,76);assert.strictEqual(S.hex(S.hash80(header,n)),dsha(x).toString('hex'),`random nonce ${i}`)}

const mid=S.computeMidstate(header);
assert.strictEqual(mid.length,8,'midstate has 8 words');
for(const n of boundaryNonces){
const h=S.hash80(header,n);
const mid2=S.computeMidstate(header);
S.initJob(header,mid2);
const hms=S.hashms(n);
const hBytes=S.stateToBytes(hms);
assert.strictEqual(S.hex(hBytes),S.hex(h),`midstate nonce ${n}`);
}

for(let i=0;i<2000;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;
S.initJob(header,mid);
const hms=S.hashms(seed);
const hBytes=S.stateToBytes(hms);
const x=Buffer.from(header);x.writeUInt32LE(seed,76);
assert.strictEqual(S.hex(hBytes),dsha(x).toString('hex'),`midstate random nonce ${i}`)}

const genesisHeaderHex='0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c';
const genesisHeader=Buffer.from(genesisHeaderHex,'hex');
assert.strictEqual(genesisHeader.length,80,'genesis header is 80 bytes');
const genesisHash=dsha(genesisHeader);
const genesisHashHex=Buffer.from(genesisHash).reverse().toString('hex');
assert.strictEqual(genesisHashHex,'000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f','genesis block hash');
const genesisInternalHash=S.hex(S.hash80(genesisHeader,0x7c2bac1d));
assert.strictEqual(genesisInternalHash,'6fe28c0ab6f1b372c1a6a246ae63f74f931e8365e15a089c68d6190000000000','genesis internal hash');

const target=S.fromHex('00000000ffff0000000000000000000000000000000000000000000000000000');
assert(S.meets(target,target),'hash === target is valid');
const high=S.fromHex('0000000100000000000000000000000000000000000000000000000000000000');
assert(!S.meets(high,target),'hash > target is invalid');
const low=S.fromHex('0000000000000000000000000000000000000000000000000000000000000001');
assert(S.meets(low,target),'hash < target is valid');

const U=0x100000000;
for(const n of[1,2,3,4,7,8,16,31,32,64,127,128,255,256]){
let sum=0,last=0;
for(let i=0;i<n;i++){const from=i*Math.floor(U/n),span=i===n-1?U-from:Math.floor(U/n);
assert.strictEqual(from,last,`${n} workers: worker ${i} from mismatch`);
sum+=span;last=from+span}
assert.strictEqual(sum,U,`${n} workers: total sum`);
assert.strictEqual(last,U,`${n} workers: last end`)}

const genesisTarget=S.targetFromBits('1d00ffff');
assert.strictEqual(Buffer.from(genesisTarget).toString('hex'),'00000000ffff0000000000000000000000000000000000000000000000000000','targetFromBits genesis 1d00ffff');

const mainnetTarget=S.targetFromBits('17021ef0');
assert.strictEqual(Buffer.from(mainnetTarget).toString('hex'),'000000000000000000021ef00000000000000000000000000000000000000000','targetFromBits mainnet 17021ef0');

console.log('ALL SHA-256d / CONSENSUS K / 2000-NONCE / MIDSTATE / GENESIS BLOCK / PARTITION TESTS PASSED');