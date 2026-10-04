const assert=require('assert'),crypto=require('crypto'),S=require('../public/sha256d.js');
function h(msg){return crypto.createHash('sha256').update(msg).digest('hex')}
assert.strictEqual(h(Buffer.from('','utf8')), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
assert.strictEqual(h(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
const primes=[];for(let n=2;primes.length<64;n++){let ok=true;for(let d=2;d*d<=n;d++)if(n%d===0){ok=false;break}if(ok)primes.push(n)}
function fracRoot(x){let y=Math.sqrt(x),f=y-Math.floor(y);return Math.floor(f*4294967296)>>>0}
function fracCbrt(x){let y=Math.cbrt(x),f=y-Math.floor(y);return Math.floor(f*4294967296)>>>0}
for(let i=0;i<64;i++)assert.strictEqual(S.K[i],fracCbrt(primes[i]),`K[${i}]`);
const msg=Buffer.from('abc');const ref=crypto.createHash('sha256').update(crypto.createHash('sha256').update(msg).digest()).digest('hex');assert.strictEqual(S.hex(S.d(msg)),ref);
const header=Buffer.alloc(80);for(let i=0;i<80;i++)header[i]=i;
for(const n of [0,1,0x7fffffff,0x80000000,0xffffff00,0xffffffff]){const x=Buffer.from(header);x.writeUInt32LE(n>>>0,76);const ref2=crypto.createHash('sha256').update(crypto.createHash('sha256').update(x).digest()).digest('hex');assert.strictEqual(S.hex(S.hash80(header,n)),ref2,`nonce ${n}`)}
const target=S.fromHex('00000000ffff0000000000000000000000000000000000000000000000000000');assert(S.meets(target,target));const high=S.fromHex('0000000100000000000000000000000000000000000000000000000000000000');assert(!S.meets(high,target));
const U=0x100000000;for(const n of [1,2,3,7,16]){let spans=[],sum=0,last=0;for(let i=0;i<n;i++){let from=i*Math.floor(U/n),span=i===n-1?U-from:Math.floor(U/n);assert.strictEqual(from,last);spans.push([from,from+span]);sum+=span;last=from+span}assert.strictEqual(sum,U);assert.strictEqual(last,U)}
console.log('ALL CORE TESTS PASSED');
