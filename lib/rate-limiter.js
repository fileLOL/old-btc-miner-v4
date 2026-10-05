class RateLimiter{
constructor(opts){
this.maxPerMinute=(opts&&opts.maxPerMinute)||60;
this.maxSharesPerMinute=(opts&&opts.maxSharesPerMinute)||30;
this.windows=new Map();
this.cleanupInterval=setInterval(()=>this.cleanup(),60000)}
check(minerId,action){
const now=Date.now();
const key=minerId+'_'+action;
let w=this.windows.get(key);
if(!w||now-w.reset>60000){w={count:0,reset:now};this.windows.set(key,w)}
w.count++;
const limit=action==='share'?this.maxSharesPerMinute:this.maxPerMinute;
return w.count<=limit}
cleanup(){
const now=Date.now();
for(const[key,w]of this.windows){if(now-w.reset>120000)this.windows.delete(key)}}
destroy(){clearInterval(this.cleanupInterval)}
}
module.exports=RateLimiter;
