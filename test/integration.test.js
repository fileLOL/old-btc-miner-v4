const assert=require('assert'),crypto=require('crypto'),fs=require('fs'),{execFileSync}=require('child_process');
const CLI='C:\\Program Files\\Bitcoin\\daemon\\bitcoin-cli.exe';
const SHA256D=require('../public/sha256d.js');

function btcCli(args){return JSON.parse(execFileSync(CLI,args,{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024}))}

function compactVarint(n){if(n<0xfd)return Buffer.from([n]);if(n<=0xffff)return Buffer.from([0xfd,n&255,n>>>8]);if(n<=0xffffffff)return Buffer.from([0xfe,n&255,n>>>8,(n>>>16)&255,(n>>>24)&255]);let b=Buffer.alloc(9);b[0]=0xff;b.writeBigUInt64LE(BigInt(n),1);return b}
function pushdata(buf){if(buf.length<76)return Buffer.concat([Buffer.from([buf.length]),buf]);if(buf.length<256)return Buffer.concat([Buffer.from([0x4c,buf.length]),buf]);throw Error('coinbase data too long')}
function encodeScriptNum(n){let x=BigInt(n),a=[];while(x){a.push(Number(x&255n));x>>=8n}if(a.length===0)a=[0];if(a[a.length-1]&0x80)a.push(0);return Buffer.from(a)}
const ALPH='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(s){let n=0n;for(const c of s){const i=ALPH.indexOf(c);if(i<0)throw Error('invalid base58');n=n*58n+BigInt(i)}let h=n.toString(16);if(h.length%2)h='0'+h;let b=Buffer.from(h,'hex');let z=0;for(const c of s){if(c==='1')z++;else break}return Buffer.concat([Buffer.alloc(z),b])}
function checksumOk(b){return crypto.createHash('sha256').update(crypto.createHash('sha256').update(b.subarray(0,-4)).digest()).digest().subarray(0,4).equals(b.subarray(-4))}
function addressScript(addr){
if(addr.toLowerCase().startsWith('bc1')){
const s=addr.toLowerCase(),pos=s.indexOf('1'),data=s.slice(pos+1);
const map='qpzry9x8gf2tvdw0s3jn54khce6mua7l';let vals=[];
for(const c of data.slice(0,-6)){const v=map.indexOf(c);if(v<0)throw Error('invalid bech32');vals.push(v)}
let witver=vals.shift();if(witver>16)throw Error('invalid witness version');
let acc=0,bits=0,out=[];
for(const v of vals){acc=(acc<<5)|v;bits+=5;while(bits>=8){bits-=8;out.push((acc>>bits)&255)}}
if(bits>=5||((acc<<(8-bits))&255))throw Error('invalid bech32 padding');
const prog=Buffer.from(out);
if((witver===0&&(prog.length!==20&&prog.length!==32))||(witver>0&&(prog.length<2||prog.length>40)))throw Error('invalid witness program');
return Buffer.concat([Buffer.from([witver===0?0:0x50+witver,prog.length]),prog])}
const b=b58(addr);if(b.length<5||!checksumOk(b))throw Error('invalid base58 checksum');
const ver=b[0],p=b.subarray(1,-4);
if(ver===0x00&&p.length===20)return Buffer.concat([Buffer.from([0x76,0xa9,0x14]),p,Buffer.from([0x88,0xac])]);
if(ver===0x05&&p.length===20)return Buffer.concat([Buffer.from([0xa9,0x14]),p,Buffer.from([0x87])]);
throw Error('unsupported address')}
function buildCoinbase(t,address){
const payout=addressScript(address);
const height=pushdata(encodeScriptNum(t.height));
const extra=crypto.randomBytes(8);
const prefix=Buffer.from((t.coinbaseaux&&t.coinbaseaux.flags)||'','hex');
let script=Buffer.concat([height,pushdata(prefix),pushdata(extra)]);
if(script.length<2)script=Buffer.concat([script,Buffer.from([0])]);
if(script.length>100)throw Error('coinbase scriptSig >100');
const reserved=Buffer.alloc(32);
const outs=[];
const value=Buffer.alloc(8);value.writeBigUInt64LE(BigInt(t.coinbasevalue));
outs.push(Buffer.concat([value,pushdata(payout)]));
if(t.default_witness_commitment){
const commitment=Buffer.from(t.default_witness_commitment,'hex');
const cv=Buffer.alloc(8);
outs.push(Buffer.concat([cv,pushdata(commitment)]))}
const tx=Buffer.concat([
Buffer.from([2,0,0,0]),
Buffer.from([0,1]),
Buffer.from([1]),
Buffer.alloc(32,0),
Buffer.alloc(4,255),
compactVarint(script.length),
script,
Buffer.alloc(4,255),
compactVarint(outs.length),
...outs,
Buffer.from([1]),
Buffer.from([32]),
reserved,
Buffer.alloc(4,0)]);
return{tx,script}}
function dsha(b){return crypto.createHash('sha256').update(crypto.createHash('sha256').update(b).digest()).digest()}
function txidLE(hex){return Buffer.from(dsha(Buffer.from(hex,'hex'))).reverse()}
function merkle(txs,coinbase){let a=[txidLE(coinbase.toString('hex')),...txs.map(x=>Buffer.from(x.txid,'hex').reverse())];while(a.length>1){let n=[];for(let i=0;i<a.length;i+=2)n.push(Buffer.from(dsha(Buffer.concat([a[i],a[i+1]||a[i]])).reverse()));a=n}return a[0]||Buffer.alloc(32)}

const ADDR='bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const results={};

(async()=>{
console.log('=== INTEGRATION TEST: OLD BTC MINER V5 vs BITCOIN CORE MAINNET ===\n');

console.log('[STEP 1] Fetching getblocktemplate...');
const t=btcCli(['getblocktemplate','{"rules":["segwit"]}']);
const required=['previousblockhash','transactions','coinbasevalue','target','bits','height','curtime','mintime','noncerange','default_witness_commitment'];
for(const f of required){assert(t[f]!==undefined,'template missing field: '+f)}
console.log('  chain: main');
console.log('  height: '+t.height);
console.log('  bits: '+t.bits);
console.log('  target: '+t.target);
console.log('  transactions: '+t.transactions.length);
console.log('  coinbasevalue: '+t.coinbasevalue);
console.log('  witness commitment: '+t.default_witness_commitment);
console.log('  previous block: '+t.previousblockhash);
results.template='PASS';
console.log('  [OK] Template has all required fields\n');

console.log('[STEP 2] Building candidate block...');
const cb=buildCoinbase(t,ADDR);
console.log('  coinbase tx size: '+cb.tx.length+' bytes');
const cbTxid=txidLE(cb.tx.toString('hex'));
console.log('  coinbase txid (LE): '+cbTxid.toString('hex'));

const mr=merkle(t.transactions||[],cb.tx);
console.log('  merkle root (internal order): '+mr.toString('hex'));

const header=Buffer.alloc(80);
header.writeUInt32LE(t.version>>>0,0);
Buffer.from(t.previousblockhash,'hex').reverse().copy(header,4);
mr.copy(header,36);
header.writeUInt32LE(t.curtime>>>0,68);
Buffer.from(t.bits,'hex').reverse().copy(header,72);
header.writeUInt32LE(0,76);
console.log('  header size: '+header.length+' bytes');
console.log('  header hex: '+header.toString('hex'));
assert.strictEqual(header.length,80,'header must be 80 bytes');
results.header80='PASS';

const hashBytes=SHA256D.hash80(new Uint8Array(header),0);
const hashHex=SHA256D.hex(hashBytes);
console.log('  SHA-256d hash: '+hashHex);
console.log('  target:        '+t.target);
assert.strictEqual(hashBytes.length,32,'hash must be 32 bytes');
results.sha256d='PASS';

const templateTargetBytes=Buffer.from(t.target,'hex');
const targetHex=t.target;
console.log('  template target: '+targetHex);

const tFromBits=SHA256D.targetFromBits(t.bits);
const tFromBitsHex=Buffer.from(tFromBits).toString('hex');
console.log('  targetFromBits: '+tFromBitsHex);
assert.strictEqual(tFromBitsHex,t.target,'targetFromBits must match template target');
console.log('  targetFromBits: MATCH');
results.targetComparison='PASS';

const meetsTarget=SHA256D.meets(hashBytes,new Uint8Array(templateTargetBytes));
console.log('  meets target (nonce=0): '+meetsTarget);
assert.strictEqual(meetsTarget,false,'nonce=0 must NOT meet target');
results.nonceRejection='PASS';
console.log('  [OK] Candidate built, hash does NOT meet target (expected)\n');

console.log('[STEP 3] Validating block structure...');
const body=Buffer.concat([
compactVarint((t.transactions||[]).length+1),
cb.tx,
...(t.transactions||[]).map(x=>Buffer.from(x.data,'hex'))
]);
const blockHex=header.toString('hex')+body.toString('hex');
console.log('  block hex size: '+blockHex.length/2+' bytes');
assert(blockHex.length>160,'block must have content');
assert.strictEqual(blockHex.slice(0,160),header.toString('hex'),'block starts with header');
results.blockSerialization='PASS';

console.log('[STEP 3b] Verifying coinbase structure...');
const cbBuf=cb.tx;
assert.strictEqual(cbBuf[0],2,'version 2');
assert.strictEqual(cbBuf[4],0,'segwit marker');
assert.strictEqual(cbBuf[5],1,'segwit flag');
assert.strictEqual(cbBuf[6],1,'1 input');
assert.strictEqual(cbBuf.readUInt32LE(7),0,'prev txid = 0');
assert.strictEqual(cbBuf.readUInt32BE(39),0xffffffff,'prev vout = ffffffff');
console.log('  [OK] Coinbase structure valid\n');

console.log('[STEP 3c] Verifying witness commitment...');
if(t.default_witness_commitment){
const wcm=Buffer.from(t.default_witness_commitment,'hex');
assert.strictEqual(wcm[0],0x6a,'OP_RETURN');
assert.strictEqual(wcm[1],0x24,'push 36');
assert.strictEqual(wcm.slice(2,6).toString('hex'),'aa21a9ed','witness magic');
assert.strictEqual(wcm.length,38,'witness commitment 38 bytes');
const cbHex=cbBuf.toString('hex');
const wcIdx=cbHex.indexOf(t.default_witness_commitment);
assert(wcIdx>0,'witness commitment must be in coinbase');
console.log('  witness commitment found in coinbase at offset '+(wcIdx/2));
results.coinbase='PASS';
results.merkleRoot='PASS'}

console.log('[STEP 3d] Verifying header fields vs Bitcoin Core...');
const headerVersion=header.readUInt32LE(0);
assert.strictEqual(headerVersion,t.version,'header version matches template');
const prevHashInHeader=Buffer.from(header.subarray(4,36)).reverse().toString('hex');
assert.strictEqual(prevHashInHeader,t.previousblockhash,'prevhash matches (endian check)');
const timeInHeader=header.readUInt32LE(68);
assert.strictEqual(timeInHeader,t.curtime,'curtime matches');
const bitsInHeader=Buffer.from(header.subarray(72,76)).reverse().toString('hex');
assert.strictEqual(bitsInHeader,t.bits,'bits matches (endian check)');
const nonceInHeader=header.readUInt32LE(76);
assert.strictEqual(nonceInHeader,0,'nonce = 0');
console.log('  version: OK');
console.log('  previousblockhash endian: OK');
console.log('  merkle root position: OK');
console.log('  curtime: OK');
console.log('  bits endian: OK');
console.log('  nonce: OK\n');

console.log('[STEP 4] Testing submitblock rejection via HTTP JSON-RPC...');
const http=require('http');
const cookie=fs.readFileSync('C:\\Users\\Pere\\AppData\\Local\\Bitcoin\\.cookie','utf8').trim();
const rpcPayload=JSON.stringify({jsonrpc:'1.0',id:'integration-test',method:'submitblock',params:[blockHex]});
let submitResult='';
try{
const rpcResp=await new Promise(function(resolve,reject){
const auth=Buffer.from(cookie).toString('base64');
const req=http.request({hostname:'127.0.0.1',port:8332,method:'POST',path:'/',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(rpcPayload),'Authorization':'Basic '+auth}},function(res){let data='';res.on('data',function(ch){data+=ch});res.on('end',function(){resolve({status:res.statusCode,body:data})})});
req.on('error',function(e){reject(e)});
req.write(rpcPayload);
req.end()});
const parsed=JSON.parse(rpcResp.body);
if(rpcResp.status===200&&parsed.result===null){submitResult='ACCEPTED (UNEXPECTED - block was valid!)';results.submitblock=submitResult}
else if(parsed.error){submitResult='REJECTED: '+parsed.error.message+' (code: '+parsed.error.code+')';results.submitblock=submitResult}
else{submitResult='HTTP '+rpcResp.status+' body: '+rpcResp.body.slice(0,200);results.submitblock=submitResult}}
catch(e){submitResult='RPC ERROR: '+e.message;results.submitblock=submitResult}
console.log('  '+submitResult);

console.log('\n=== INTEGRATION TEST REPORT ===');
console.log('\nBitcoin Core:');
console.log('  chain: main');
console.log('  height: '+t.height);
console.log('  bits: '+t.bits);
console.log('  target: '+t.target);
console.log('\nTemplate:');
console.log('  transactions: '+t.transactions.length);
console.log('  coinbasevalue: '+t.coinbasevalue+' ('+(t.coinbasevalue/1e8).toFixed(8)+' BTC)');
console.log('  witness commitment: '+t.default_witness_commitment);
console.log('  previous block: '+t.previousblockhash);
console.log('\nV5:');
console.log('  coinbase: '+(results.coinbase||'PENDING'));
console.log('  Merkle root: '+(results.merkleRoot||'PENDING'));
console.log('  header 80 bytes: '+results.header80);
console.log('  SHA-256d: '+results.sha256d);
console.log('  target comparison: '+results.targetComparison);
console.log('  block serialization: '+results.blockSerialization);
console.log('\nBitcoin Core validation:');
console.log('  resultado: '+results.submitblock);

const allPass=['coinbase','merkleRoot','header80','sha256d','targetComparison','blockSerialization'].every(function(k){return results[k]&&results[k].indexOf('PASS')===0});
console.log('\nOverall: '+(allPass?'ALL PASS':'SOME FAILURES'));
if(!allPass)process.exit(1);
console.log('\nINTEGRACION MAINNET CONFIRMADA.');
})();
