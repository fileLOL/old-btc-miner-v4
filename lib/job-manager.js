const crypto=require('crypto'),SHA256D=require('../public/sha256d.js'),{buildJob}=require('./block-builder');
class JobManager{
constructor(config){this.config=config;this.currentTemplate=null;this.currentJob=null;this.activeJobs=new Map();this.jobCounter=0;this.blockTarget=null}
setTemplate(t){
this.currentTemplate=t;
this.blockTarget=[...Buffer.from(t.target,'hex')];
const prevJobId=this.currentJob?this.currentJob.jobId:null;
for(const[id,job]of this.activeJobs){if(id!==null)job.stale=true}
const jobId='job_'+(++this.jobCounter)+'_'+crypto.randomBytes(4).toString('hex');
const job=buildJob(t,this.config.PAYOUT_ADDRESS);
job.jobId=jobId;
job.stale=false;
job.createdAt=Date.now();
job.previousblockhash=t.previousblockhash;
  job.shareTarget=this.calculateShareTarget(this.blockTarget);
job.blockTarget=this.blockTarget;
this.currentJob=job;
this.activeJobs.set(jobId,job);
this.cleanupOldJobs();
return job}
calculateShareTarget(blockTargetBytes){
const diff=Number(this.config.SHARE_DIFFICULTY);
if(!Number.isFinite(diff)||diff<=0)throw Error('Invalid SHARE_DIFFICULTY');

let blockBigInt=0n;
for(let i=0;i<blockTargetBytes.length;i++){blockBigInt=(blockBigInt<<8n)|BigInt(blockTargetBytes[i])}

let target=blockBigInt*BigInt(Math.round(diff*1e8))/100000000n;

const maxTarget=(1n<<256n)-1n;
if(target>maxTarget)target=maxTarget;

const result=new Uint8Array(32);
for(let i=31;i>=0;i--){
result[i]=Number(target&0xFFn);
target>>=8n;
}
return[...result];
}
getJob(jobId){return this.activeJobs.get(jobId)||null}
isStale(jobId){const j=this.activeJobs.get(jobId);return!j||j.stale}
getCurrentJob(){return this.currentJob}
cleanupOldJobs(){
const now=Date.now();
const timeout=this.config.JOB_TIMEOUT_MS;
for(const[id,job]of this.activeJobs){
if(now-job.createdAt>timeout&&id!==this.currentJob.jobId){
this.activeJobs.delete(id)}}
if(this.activeJobs.size>20){
const sorted=[...this.activeJobs.entries()].sort((a,b)=>b[1].createdAt-a[1].createdAt);
const toDelete=sorted.slice(10);
for(const[id]of toDelete){if(id!==this.currentJob.jobId)this.activeJobs.delete(id)}}}
getStats(){return{
currentJobId:this.currentJob?this.currentJob.jobId:null,
height:this.currentTemplate?this.currentTemplate.height:null,
activeJobs:this.activeJobs.size,
staleJobs:[...this.activeJobs.values()].filter(j=>j.stale).length}}
}
module.exports=JobManager;
