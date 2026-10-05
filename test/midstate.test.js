const assert=require('assert'),crypto=require('crypto'),S=require('../public/sha256d.js');
const sha=m=>crypto.createHash('sha256').update(m).digest(),dsha=m=>sha(sha(m));

const header=Buffer.alloc(80);for(let i=0;i<80;i++)header[i]=(i*7+13)&0xff;

const mid=S.computeMidstate(header);
assert.strictEqual(mid.length,8,'midstate has 8 uint32 words');

const first64=header.subarray(0,64);
const refState=new Uint32Array(8);
refState.set(S.IV);
S.compress(first64,0,refState);
for(let i=0;i<8;i++)assert.strictEqual(mid[i],refState[i],`midstate word ${i}`);

S.initJob(header,mid);
for(let n=0;n<256;n++){
const hms=S.hashms(n);
const hBytes=S.stateToBytes(hms);
const x=Buffer.from(header);x.writeUInt32LE(n>>>0,76);
const ref=dsha(x).toString('hex');
assert.strictEqual(S.hex(hBytes),ref,`midstate nonce ${n}`)}

const h80ref=S.hash80(header,42);
S.initJob(header,mid);
const hmsResult=S.hashms(42);
const hmsBytes=S.stateToBytes(hmsResult);
assert.strictEqual(S.hex(hmsBytes),S.hex(h80ref),'midstate === hash80');

let seed=0xDEADBEEF;
S.initJob(header,mid);
for(let i=0;i<5000;i++){
seed=(Math.imul(seed,1664525)+1013904223)>>>0;
const hms=S.hashms(seed);
const hBytes=S.stateToBytes(hms);
const x=Buffer.from(header);x.writeUInt32LE(seed,76);
assert.strictEqual(S.hex(hBytes),dsha(x).toString('hex'),`5000-nonce midstate ${i}`)}

const target=S.fromHex('00000000ffff0000000000000000000000000000000000000000000000000000');
S.initJob(header,mid);
for(let i=0;i<100;i++){
seed=(Math.imul(seed,1664525)+1013904223)>>>0;
const hms=S.hashms(seed);
const hBytes=S.stateToBytes(hms);
assert.strictEqual(S.meets32(hms,target),S.meets(hBytes,target),`meets32 vs meets nonce ${seed}`)}

console.log('ALL MIDSTATE VERIFICATION TESTS PASSED');