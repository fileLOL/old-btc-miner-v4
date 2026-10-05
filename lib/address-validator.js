const crypto=require('crypto');
const BECH32_MAP='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const ALPH='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58decode(s){let n=0n;for(const c of s){const i=ALPH.indexOf(c);if(i<0)return null;n=n*58n+BigInt(i)}let h=n.toString(16);if(h.length%2)h='0'+h;let b=Buffer.from(h,'hex');let z=0;for(const c of s){if(c==='1')z++;else break}return Buffer.concat([Buffer.alloc(z),b])}
function base58checkOk(buf){
if(buf.length<5)return false;
const payload=buf.subarray(0,-4);
const checksum=buf.subarray(-4);
const h1=crypto.createHash('sha256').update(payload).digest();
const h2=crypto.createHash('sha256').update(h1).digest();
return h2.subarray(0,4).equals(checksum)}
function bech32Polymod(values){
let c=1;
for(const v of values){
const b=c>>>25;
c=((c&0x1ffffff)<<5)^v;
if(b&1)c^=0x3b6a57b2;
if(b&2)c^=0x26508e6d;
if(b&4)c^=0x1ea119fa;
if(b&8)c^=0x3d4233dd;
if(b&16)c^=0x2a1462b3}
return c}
function bech32HrpExpand(hrp){
const ret=[];
for(let i=0;i<hrp.length;i++)ret.push(hrp.charCodeAt(i)>>5);
ret.push(0);
for(let i=0;i<hrp.length;i++)ret.push(hrp.charCodeAt(i)&31);
return ret}
function bech32Verify(hrp,data){
const combined=[...bech32HrpExpand(hrp),...data];
return bech32Polymod(combined)===1}
function bech32mVerify(hrp,data){
const combined=[...bech32HrpExpand(hrp),...data];
return bech32Polymod(combined)===0x2bc830a3}
function bech32Decode(addr){
const lowered=addr.toLowerCase();
const pos=lowered.lastIndexOf('1');
if(pos<1||pos+7>lowered.length)return null;
const hrp=lowered.slice(0,pos);
const dataStr=lowered.slice(pos+1);
const vals=[];
for(const c of dataStr){const v=BECH32_MAP.indexOf(c);if(v<0)return null;vals.push(v)}
return{hrp,data:vals}}
function convertBits(data,fromBits,toBits,pad){
let acc=0,bits=0;
const ret=[];
const maxv=(1<<toBits)-1;
for(const v of data){
if(v<0||v>>fromBits)return null;
acc=(acc<<fromBits)|v;
bits+=fromBits;
while(bits>=toBits){bits-=toBits;ret.push((acc>>bits)&maxv)}}
if(pad){if(bits>0)ret.push((acc<<(toBits-bits))&maxv)}
else{if(bits>=fromBits)return null;if((acc<<(toBits-bits))&maxv)return null}
return ret}
function validateAddress(addr){
if(!addr||typeof addr!=='string')return{valid:false,error:'empty address'};
const trimmed=addr.trim();
if(trimmed.length<14||trimmed.length>62)return{valid:false,error:'invalid length'};
if(trimmed.toLowerCase().startsWith('bc1'))return validateBech32(trimmed);
if(trimmed[0]==='1'||trimmed[0]==='3')return validateBase58(trimmed);
if(trimmed.toLowerCase().startsWith('tb1')||trimmed[0]==='m'||trimmed[0]==='n'||trimmed[0]==='2')return{valid:false,error:'testnet addresses not allowed'};
return{valid:false,error:'unsupported address format'}}
function validateBase58(addr){
const buf=b58decode(addr);
if(!buf||buf.length<5)return{valid:false,error:'invalid base58 encoding'};
if(!base58checkOk(buf))return{valid:false,error:'invalid checksum'};
const ver=buf[0];
const payload=buf.subarray(1,-4);
if(payload.length!==20)return{valid:false,error:'invalid payload length'};
if(ver===0x00)return{valid:true,type:'P2PKH'};
if(ver===0x05)return{valid:true,type:'P2SH'};
return{valid:false,error:'unknown address version'}}
function validateBech32(addr){
const decoded=bech32Decode(addr);
if(!decoded)return{valid:false,error:'invalid bech32 encoding'};
if(decoded.hrp!=='bc')return{valid:false,error:'invalid HRP: expected bc'};
const data=decoded.data;
if(data.length<7)return{valid:false,error:'bech32 data too short'};
const checksumData=data.slice(0,-6);
const witnessVersion=data[0];
let isBech32m=false,isBech32=false;
try{isBech32=bech32Verify(decoded.hrp,data)}catch{}
try{isBech32m=bech32mVerify(decoded.hrp,data)}catch{}
if(!isBech32&&!isBech32m)return{valid:false,error:'invalid bech32/bech32m checksum'};
if(witnessVersion===0&&!isBech32)return{valid:false,error:'witness v0 must use bech32'};
if(witnessVersion>0&&!isBech32m)return{valid:false,error:'witness v1+ must use bech32m'};
const converted=convertBits(checksumData.slice(1),5,8,false);
if(!converted)return{valid:false,error:'invalid data conversion'};
const prog=Buffer.from(converted);
if(witnessVersion===0){
if(prog.length!==20&&prog.length!==32)return{valid:false,error:'invalid witness v0 program length'}}
else if(witnessVersion===1){
if(prog.length!==32)return{valid:false,error:'invalid taproot program length'}}
else{if(prog.length<2||prog.length>40)return{valid:false,error:'invalid witness program length'}}
if(witnessVersion===0&&prog.length===20)return{valid:true,type:'P2WPKH'};
if(witnessVersion===0&&prog.length===32)return{valid:true,type:'P2WSH'};
if(witnessVersion===1&&prog.length===32)return{valid:true,type:'P2TR'};
return{valid:true,type:'WITNESS_V'+witnessVersion}}
module.exports={validateAddress,validateBase58,validateBech32};
