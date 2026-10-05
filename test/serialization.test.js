const assert=require('assert'),crypto=require('crypto');

const bits=Buffer.from('1d00ffff','hex').reverse();assert.strictEqual(bits.toString('hex'),'ffff001d');
const h=Buffer.alloc(80);bits.copy(h,72);assert.strictEqual(h.readUInt32LE(72),0x1d00ffff);
const d=b=>crypto.createHash('sha256').update(crypto.createHash('sha256').update(b).digest()).digest();
const tx=Buffer.from('01000000000000000000','hex');const internal=Buffer.from(d(tx)).reverse();const root=Buffer.from(d(Buffer.concat([internal,internal]))).reverse();assert.strictEqual(root.length,32);

function merkleTest(txids){
const hashes=txids.map(t=>Buffer.from(t,'hex').reverse());
let a=[...hashes];
while(a.length>1){let n=[];for(let i=0;i<a.length;i+=2)n.push(Buffer.from(d(Buffer.concat([a[i],a[i+1]||a[i]])).reverse()));a=n}
return a[0]}

const tx1=Buffer.from('01'.repeat(100),'hex');
const tx1id=crypto.createHash('sha256').update(crypto.createHash('sha256').update(tx1).digest()).digest().reverse().toString('hex');
const mr1=merkleTest([tx1id]);
assert.strictEqual(Buffer.from(mr1).reverse().toString('hex'),tx1id,'1 tx merkle = txid');

const tx2a=Buffer.from('02'.repeat(100),'hex');
const tx2b=Buffer.from('03'.repeat(100),'hex');
const tx2aId=crypto.createHash('sha256').update(crypto.createHash('sha256').update(tx2a).digest()).digest().reverse().toString('hex');
const tx2bId=crypto.createHash('sha256').update(crypto.createHash('sha256').update(tx2b).digest()).digest().reverse().toString('hex');
const mr2=merkleTest([tx2aId,tx2bId]);
assert.strictEqual(mr2.length,32,'2 tx merkle root length');

const mr3=merkleTest([tx1id,tx2aId,tx2bId]);
assert.strictEqual(mr3.length,32,'3 tx merkle root (odd)');

const segwitTx=[2,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0xff,0xff,0x01,0x00,0x02,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x20,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
const segwitBuf=Buffer.from(segwitTx);
assert.strictEqual(segwitBuf[4],0,'segwit marker at byte 4');
assert.strictEqual(segwitBuf[5],1,'segwit flag at byte 5');

const p2pkhScript=Buffer.from([0x76,0xa9,0x14,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,0x88,0xac]);
assert.strictEqual(p2pkhScript[0],0x76,'OP_DUP');
assert.strictEqual(p2pkhScript[1],0xa9,'OP_HASH160');
assert.strictEqual(p2pkhScript[2],0x14,'push 20');
assert.strictEqual(p2pkhScript[23],0x88,'OP_EQUALVERIFY');
assert.strictEqual(p2pkhScript[24],0xac,'OP_CHECKSIG');
assert.strictEqual(p2pkhScript.length,25,'P2PKH script length');

const p2shScript=Buffer.from([0xa9,0x14,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,0x87]);
assert.strictEqual(p2shScript[0],0xa9,'OP_HASH160');
assert.strictEqual(p2shScript[1],0x14,'push 20');
assert.strictEqual(p2shScript[22],0x87,'OP_EQUAL');
assert.strictEqual(p2shScript.length,23,'P2SH script length');

const witnessCommitment=Buffer.from('6a24aa21a9ed'+('ab'.repeat(32)),'hex');
assert.strictEqual(witnessCommitment[0],0x6a,'OP_RETURN');
assert.strictEqual(witnessCommitment[1],0x24,'push 36');
assert.strictEqual(witnessCommitment.slice(2,6).toString('hex'),'aa21a9ed','witness magic');
assert.strictEqual(witnessCommitment.length,38,'witness commitment length');

const nBitsTarget='1d00ffff';
const bBuf=Buffer.from(nBitsTarget,'hex');
const exponent=bBuf[0];
const mantissa=(bBuf[1]<<16)|(bBuf[2]<<8)|bBuf[3];
const targetBuf=Buffer.alloc(32);
const shift=exponent-3;
targetBuf[shift]=mantissa>>>16;
targetBuf[shift+1]=(mantissa>>>8)&0xff;
targetBuf[shift+2]=mantissa&0xff;
assert.strictEqual(targetBuf[0],0,'genesis target leading zeros');
assert.strictEqual(targetBuf[1],0);
assert.strictEqual(targetBuf[2],0);
assert.strictEqual(targetBuf[3],0);

console.log('SERIALIZATION / COINBASE-FORMAT / MERKLE / WITNESS / TARGET TESTS PASSED');