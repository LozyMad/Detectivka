const test=require('node:test'),assert=require('node:assert/strict');const {calculateFee}=require('../backend/services/playerScoring');
test('fee formula matches the agreed examples and caps efficient investigations',()=>{
 for(const [points,trips,fee]of [[45,20,1620],[45,40,1146],[30,10,720],[50,10,2000],[50,1,2000],[50,0,0],[0,20,0]])assert.equal(calculateFee({points,max_points:50,trips,max_fee:2000,standard_trips:20}).fee,fee);
 assert.equal(calculateFee({points:0,max_points:0,trips:10,max_fee:2000,standard_trips:20}).fee,0);
});
test('custom fee limits normalize to the same 2000-point rating scale',()=>{
 const a=calculateFee({points:9,max_points:10,trips:20,max_fee:2000,standard_trips:20});const b=calculateFee({points:9,max_points:10,trips:20,max_fee:5000,standard_trips:20});assert.equal(a.fee,1620);assert.equal(b.fee,4050);assert.equal(a.rating_points,b.rating_points);assert.equal(calculateFee({points:4,max_points:5,trips:1,max_fee:1,standard_trips:20}).rating_points,1280);
});
test('invalid formula input cannot yield NaN, infinity or a negative fee',()=>{
 const base={points:1,max_points:5,trips:1,max_fee:2000,standard_trips:20};for(const bad of [{points:-1},{points:6},{points:1.5},{max_points:NaN},{trips:Infinity},{trips:-2},{max_fee:0},{standard_trips:0}])assert.throws(()=>calculateFee({...base,...bad}),e=>e.status===400);
});
