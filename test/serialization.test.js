const assert=require('assert');
// Consensus byte-order invariants used by server.js.
const bits=Buffer.from('1d00ffff','hex').reverse(); assert.strictEqual(bits.toString('hex'),'ffff001d');
const h=Buffer.alloc(80); bits.copy(h,72); assert.strictEqual(h.readUInt32LE(72),0x1d00ffff);
const crypto=require('crypto'); const d=b=>crypto.createHash('sha256').update(crypto.createHash('sha256').update(b).digest()).digest();
const tx=Buffer.from('01000000000000000000','hex'); const internal=Buffer.from(d(tx)).reverse(); const root=Buffer.from(d(Buffer.concat([internal,internal]))).reverse(); assert.strictEqual(root.length,32);
console.log('SERIALIZATION TESTS PASSED');
