// Isolated admin workspace: copied server, database and uploads; live frontend sources.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'output','admin-local');
const source=path.join(root,'backend'),target=path.join(runtime,'backend');
const port=Number(process.env.ADMIN_LOCAL_PORT||3002);
async function main(){
 await new Promise((resolve,reject)=>{const probe=require('node:net').createServer();probe.once('error',()=>reject(Error('Port '+port+' is already in use.')));probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
 fs.mkdirSync(target,{recursive:true});
 const skip=new Set(['node_modules','.env','database.sqlite','database.sqlite-wal','database.sqlite-shm']);
 fs.cpSync(source,target,{recursive:true,filter:file=>!skip.has(path.basename(file))&&(!file.startsWith(path.join(source,'uploads'))||!fs.existsSync(path.join(target,'uploads')))&&(!file.startsWith(path.join(source,'data','scenarios'))||!fs.existsSync(path.join(target,'data','scenarios')))});
 const database=path.join(target,'database.sqlite');
 if(!fs.existsSync(database)){
  const sqlite=require(path.join(source,'node_modules','sqlite3'));
  const db=new sqlite.Database(path.join(source,'database.sqlite'),sqlite.OPEN_READONLY);
  await new Promise((resolve,reject)=>{const backup=db.backup(database);backup.step(-1,error=>backup.finish(finalError=>error||finalError?reject(error||finalError):resolve()));});
  await new Promise(resolve=>db.close(resolve));
 }
 for(const [link,destination]of [[path.join(target,'node_modules'),path.join(source,'node_modules')],[path.join(runtime,'frontend'),path.join(root,'frontend')]])if(!fs.existsSync(link))fs.symlinkSync(destination,link,'junction');
 const sqlite=require(path.join(source,'node_modules','sqlite3')),bcrypt=require(path.join(source,'node_modules','bcryptjs'));
 const db=new sqlite.Database(database),hash=await bcrypt.hash('DetectumLocal2026!',10);
 await new Promise((resolve,reject)=>db.run("UPDATE users SET password=?,is_admin=1,admin_level='super_admin' WHERE username='admin'",[hash],error=>error?reject(error):resolve()));
 await new Promise(resolve=>db.close(resolve));
 Object.assign(process.env,{DB_TYPE:'sqlite',SQLITE_DB_PATH:database,HOST:'127.0.0.1',PORT:String(port),PLAYER_LOCAL_MODE:'1',NODE_ENV:'development',JWT_SECRET:'local-admin-'+crypto.randomBytes(24).toString('hex'),DEPLOY_SECRET:''});
 console.log('Local admin: http://localhost:'+port+'/admin-login');
 console.log('Local copy only. Login: admin / DetectumLocal2026!');
 require(path.join(target,'server.js'));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
