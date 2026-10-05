const path=require('path');
const fs=require('fs');
const Database=require('better-sqlite3');
const{validateAddress}=require('./address-validator');

class TestPayoutRunner{
constructor(config,btcCliFn){
this.config=config;
this.btcCli=btcCliFn;
this.db=null;
this.processing=false}

getTestDbPath(){
return this.config.TEST_PAYOUT_DB_PATH||path.join(__dirname,'..','data','test-payout.db')}

getTestAddress(){
return this.config.TEST_PAYOUT_ADDRESS||process.env.TEST_PAYOUT_ADDRESS||''}

getTestAmountSat(){
return this.config.TEST_PAYOUT_SAT||parseInt(process.env.TEST_PAYOUT_SAT||'50000',10)}

isRealEnabled(){
const envVal=process.env.ENABLE_REAL_PAYOUT_TEST;
if(envVal!==undefined)return envVal==='true';
if(this.config.ENABLE_REAL_PAYOUT_TEST!==undefined)return this.config.ENABLE_REAL_PAYOUT_TEST===true;
return false}

isDryRun(){
return this.config.PAYOUT_DRY_RUN!==false}

initTestDb(){
const dbPath=this.getTestDbPath();
const dirPath=path.dirname(dbPath);
if(!fs.existsSync(dirPath))fs.mkdirSync(dirPath,{recursive:true});
if(fs.existsSync(dbPath)){
try{fs.unlinkSync(dbPath)}catch(e){throw new Error('could not remove existing test DB: '+e.message)}}
if(this.db){try{this.db.close()}catch(e){}}
this.db=new Database(dbPath);
this.db.pragma('journal_mode = WAL');
this.db.pragma('foreign_keys = ON');
this.db.exec(`
CREATE TABLE test_balances (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  confirmed_sat INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
INSERT INTO test_balances (id, confirmed_sat, updated_at) VALUES (1, 0, 0);
CREATE TABLE test_payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount_sat INTEGER NOT NULL,
  destination TEXT NOT NULL,
  txid TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at INTEGER NOT NULL,
  broadcast_at INTEGER,
  confirmed_at INTEGER
);
CREATE TABLE test_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  amount_sat INTEGER NOT NULL DEFAULT 0,
  details TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_test_audit_type ON test_audit_log(type);
CREATE INDEX idx_test_audit_created ON test_audit_log(created_at);
`);
return this.db}

_requireDb(){
if(!this.db)throw new Error('test DB not initialised; call initTestDb() first')}

getTestBalance(){
this._requireDb();
const row=this.db.prepare('SELECT confirmed_sat FROM test_balances WHERE id = 1').get();
return row?row.confirmed_sat:0}

setTestBalance(amountSat){
this._requireDb();
this.db.prepare('UPDATE test_balances SET confirmed_sat = ?, updated_at = ? WHERE id = 1')
.run(amountSat,Date.now())}

logAudit(type,amountSat,details){
this._requireDb();
this.db.prepare('INSERT INTO test_audit_log (type, amount_sat, details, created_at) VALUES (?, ?, ?, ?)')
.run(type,amountSat,JSON.stringify(details||{}),Date.now())}

getAuditTrail(){
this._requireDb();
return this.db.prepare('SELECT * FROM test_audit_log ORDER BY created_at DESC').all()}

getTestPayouts(){
this._requireDb();
return this.db.prepare('SELECT * FROM test_payouts ORDER BY created_at DESC').all()}

async preflightChecks(destination,amountSat){
const errors=[];
if(!destination||typeof destination!=='string'){
errors.push('destination address required')}
else{
const v=validateAddress(destination);
if(!v.valid)errors.push('invalid destination: '+v.error);
if(!destination.toLowerCase().startsWith('bc1')&&destination[0]!=='1'&&destination[0]!=='3'){
errors.push('destination must be mainnet')}}
if(!Number.isInteger(amountSat)||amountSat<=0){
errors.push('amount must be positive integer')}
else{
if(amountSat<this.config.MIN_PAYOUT_SAT){
errors.push('amount below MIN_PAYOUT_SAT ('+this.config.MIN_PAYOUT_SAT+')')}
if(amountSat>this.config.MAX_PAYOUT_SAT){
errors.push('amount above MAX_PAYOUT_SAT ('+this.config.MAX_PAYOUT_SAT+')')}}
const balance=this.getTestBalance();
if(balance<amountSat){
errors.push('insufficient test balance: have '+balance+', need '+amountSat)}
try{
const chainInfo=await this.btcCli(['getblockchaininfo']);
const chain=JSON.parse(chainInfo);
if(chain.chain!=='main')errors.push('Bitcoin Core not on mainnet: '+chain.chain)}
catch(e){errors.push('Bitcoin Core unreachable: '+e.message)}
try{
const walletInfo=await this.btcCli(['getwalletinfo']);
const wallet=JSON.parse(walletInfo);
if(wallet.walletname!=='revblocks'){
errors.push('wallet is not revblocks: '+wallet.walletname)}}
catch(e){errors.push('wallet unreachable: '+e.message)}
try{
const balances=await this.btcCli(['getbalances']);
const bal=JSON.parse(balances);
const spendable=Math.round((bal.mine.trusted||0)*1e8);
if(spendable<amountSat){
errors.push('insufficient wallet spendable: '+spendable+' sat < '+amountSat+' sat')}}
catch(e){errors.push('getbalances failed: '+e.message)}
const existing=this.db.prepare(
"SELECT id FROM test_payouts WHERE status IN ('pending','broadcast') AND amount_sat = ? AND destination = ?"
).get(amountSat,destination);
if(existing){errors.push('identical payout already exists (id='+existing.id+')')}
return errors}

async run(){
if(this.processing){
return{success:false,error:'test runner already processing'}}
this.processing=true;
try{
    if(!this.db){this.initTestDb()}
    const destination=this.getTestAddress();
    const amountSat=this.getTestAmountSat();
    this.setTestBalance(amountSat);
    this.logAudit('test_balance_initialized',amountSat,{balance:this.getTestBalance()});
    const isReal=this.isRealEnabled();
const isDry=this.isDryRun();
this.logAudit('test_payout_start',amountSat,{destination,isReal,isDry});
if(!destination){
this.logAudit('test_payout_aborted',amountSat,{reason:'no TEST_PAYOUT_ADDRESS'});
return{success:false,error:'TEST_PAYOUT_ADDRESS not configured'}}
const preflight=await this.preflightChecks(destination,amountSat);
if(preflight.length>0){
this.logAudit('test_payout_aborted',amountSat,{reason:'preflight_failed',errors:preflight});
return{success:false,error:'preflight checks failed',details:preflight}}
const payoutId=this.db.prepare(
'INSERT INTO test_payouts (amount_sat, destination, status, created_at) VALUES (?, ?, ?, ?)'
).run(amountSat,destination,'pending',Date.now()).lastInsertRowid;
this.db.prepare('UPDATE test_balances SET confirmed_sat = confirmed_sat - ?, updated_at = ? WHERE id = 1')
.run(amountSat,Date.now());
this.logAudit('test_payout_created',amountSat,{payout_id:payoutId,destination});
if(isDry||!isReal){
const simulated=true;
this.db.prepare('UPDATE test_payouts SET status = ?, txid = ?, broadcast_at = ? WHERE id = ?')
.run(isDry?'dry_run':'simulated',(isDry?'dry_run_':'simulated_')+Date.now(),Date.now(),payoutId);
this.db.prepare('UPDATE test_balances SET confirmed_sat = confirmed_sat + ?, updated_at = ? WHERE id = 1')
.run(amountSat,Date.now());
this.logAudit(isDry?'test_payout_dry_run':'test_payout_simulated',amountSat,{payout_id:payoutId});
return{success:true,dryRun:isDry,simulated:simulated,payout_id:payoutId,amount_sat:amountSat,destination:destination,txid:null,restored:true}}
try{
const amountBtc=(amountSat/1e8).toFixed(8);
const txidRaw=await this.btcCli(['sendtoaddress',destination,amountBtc]);
const txid=txidRaw.trim();
this.db.prepare('UPDATE test_payouts SET status = ?, txid = ?, broadcast_at = ? WHERE id = ?')
.run('broadcast',txid,Date.now(),payoutId);
this.logAudit('test_payout_broadcast',amountSat,{payout_id:payoutId,txid:txid});
return{success:true,dryRun:false,simulated:false,payout_id:payoutId,amount_sat:amountSat,destination:destination,txid:txid,restored:false}}
catch(sendError){
this.db.prepare('UPDATE test_balances SET confirmed_sat = confirmed_sat + ?, updated_at = ? WHERE id = 1')
.run(amountSat,Date.now());
this.db.prepare('UPDATE test_payouts SET status = ?, error = ? WHERE id = ?')
.run('failed',sendError.message,payoutId);
this.logAudit('test_payout_failed',amountSat,{payout_id:payoutId,error:sendError.message});
this.logAudit('test_payout_reversed',amountSat,{payout_id:payoutId,reason:'sendtoaddress_failed'});
return{success:false,error:sendError.message,payout_id:payoutId,restored:true}}}
finally{
this.processing=false}}

close(){
if(this.db){
try{this.db.close()}catch(e){}
this.db=null}
const dbPath=this.getTestDbPath();
if(fs.existsSync(dbPath)){
try{fs.unlinkSync(dbPath)}catch(e){}}
return true}

getState(){
if(!this.db)return null;
return{balance:this.getTestBalance(),payouts:this.getTestPayouts(),audit:this.getAuditTrail()}}}

module.exports=TestPayoutRunner;
