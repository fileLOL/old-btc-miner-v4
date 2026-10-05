const S=require('../public/sha256d.js');
const h=Buffer.alloc(80);for(let i=0;i<80;i++)h[i]=(i*7+13)&0xff;

console.log('=== SHA-256d BENCHMARK ===\n');

const N1=100000;
let t=performance.now();for(let i=0;i<N1;i++)S.hash80(h,i>>>0);
let dt=performance.now()-t;
console.log(`hash80 (3 compress): ${Math.round(N1*1000/dt).toLocaleString()} H/s over ${N1} hashes in ${(dt/1000).toFixed(2)}s`);

const mid=S.computeMidstate(h);
S.initJob(h,mid);
const N2=500000;
t=performance.now();for(let i=0;i<N2;i++)S.hashms(i>>>0);
dt=performance.now()-t;
console.log(`hashms (2 compress): ${Math.round(N2*1000/dt).toLocaleString()} H/s over ${N2} hashes in ${(dt/1000).toFixed(2)}s`);

const N3=1000000;
t=performance.now();for(let i=0;i<N3;i++)S.hashms(i>>>0);
dt=performance.now()-t;
console.log(`hashms (sustained):  ${Math.round(N3*1000/dt).toLocaleString()} H/s over ${N3} hashes in ${(dt/1000).toFixed(2)}s`);

const workers=[1,2,4,8,16];
console.log('\n=== ESTIMATED BROWSER WORKERS (sequential sim) ===\n');
for(const w of workers){
const Nw=200000;
t=performance.now();
for(let i=0;i<Nw;i++)S.hashms(i>>>0);
dt=performance.now()-t;
const hps=Math.round(Nw*1000/dt);
console.log(`${String(w).padStart(2)} workers: ~${(hps*w).toLocaleString()} H/s total (${hps.toLocaleString()} H/s each)`);}

console.log('\n=== HASH COUNTS PER NONCE ===\n');
console.log('hash80:  3 compress calls per hash (chunk1 + chunk2 + second SHA-256)');
console.log('hashms:  2 compress calls per hash (chunk2 from midstate + second SHA-256)');
console.log('Speedup: ~1.5x from midstate optimization');