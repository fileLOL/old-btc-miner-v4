importScripts('/sha256d.js');
let running=false, job=null, from=0, span=0;
self.onmessage=e=>{const m=e.data||{}; if(m.type==='stop'){running=false;return;} if(m.type==='start'){job=m.job;from=m.from>>>0;span=m.span;running=true;run();}};
function run(){if(!running)return;const start=performance.now(),end=from+span;let n=from>>>0,count=0;while(running && count<2048 && (n!==end && !(span===0))){const h=SHA256D.hash80(job.header,n);count++;n=(n+1)>>>0;if(SHA256D.meets(h,job.target)){running=false;self.postMessage({type:'nonce',nonce:(n-1)>>>0,hash:SHA256D.hex(h),block:buildBlock(job,(n-1)>>>0)});return;}if(performance.now()-start>=20)break;}from=n;self.postMessage({type:'rate',count});if(from===end || (span===0)){running=false;self.postMessage({type:'exhausted'});return;}setTimeout(run,0);}
function buildBlock(job,nonce){const h=new Uint8Array(job.header);h[76]=nonce&255;h[77]=(nonce>>>8)&255;h[78]=(nonce>>>16)&255;h[79]=(nonce>>>24)&255;return SHA256D.hex(h)+job.bodyHex;}
