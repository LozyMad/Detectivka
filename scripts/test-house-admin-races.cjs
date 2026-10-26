const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {randomUUID}=require('node:crypto');
function fixture(fetch){
  const nodes=new Map(['houses-error','houses-retry'].map(id=>[id,{hidden:true,textContent:''}]));
  const window={};
  const source=fs.readFileSync('frontend/js/admin-houses.js','utf8').replace('window.adminHouses={load};',`window.adminHouses={load};window.testHouse={mutate,refreshDetail,getCurrent:()=>current};selected='fixture';current={house:{id:'fixture',revision:0},teams:[]};`);
  vm.runInNewContext(source,{window,document:{getElementById:id=>nodes.get(id)||null},fetch,crypto:{randomUUID},localStorage:{getItem:()=> 'admin-token'},AbortSignal,console,location:{}});
  return window.testHouse;
}
const json=data=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
test('rapid consecutive agency saves use the accepted revision before the detail reload finishes',async()=>{
  const revisions=[];
  const f=fixture(async(_path,options)=>{revisions.push(JSON.parse(options.body).revision);return json({room_id:revisions.length});});
  await f.mutate('/fixture/teams',{name:'А',password:'secret'});
  await f.mutate('/fixture/teams',{name:'Б',password:'secret'});
  assert.deepEqual(revisions,[0,1]);assert.equal(f.getCurrent().house.revision,2);
});
test('a polling response started before a save cannot restore an obsolete house revision',async()=>{
  let resolveRead;
  const f=fixture(async(_path,options)=>options.method==='POST'?json({ok:true}):new Promise(resolve=>{resolveRead=resolve;}));
  const read=f.refreshDetail();
  await f.mutate('/fixture/teams',{name:'А',password:'secret'});
  resolveRead(json({house:{id:'fixture',revision:0},teams:[]}));await read;
  assert.equal(f.getCurrent().house.revision,1);
});
test('a lost deletion response keeps the same key and revision for retry and clears the deleted detail',async()=>{
  const requests=[];let unavailable=true;
  const f=fixture(async(_path,options)=>{requests.push(JSON.parse(options.body));if(unavailable)throw Error('Connection lost');return json({ok:true,deleted:true});});
  const body={revision:0,confirmed:true};
  await assert.rejects(f.mutate('/fixture',body,'DELETE'),/Connection lost/);
  assert.equal(f.getCurrent().house.id,'fixture');unavailable=false;
  await f.mutate('/fixture',body,'DELETE');assert.deepEqual(requests[0],requests[1]);assert.equal(f.getCurrent(),null);
});
