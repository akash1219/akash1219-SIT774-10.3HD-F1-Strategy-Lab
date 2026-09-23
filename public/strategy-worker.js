// Web Worker: deterministic hypothetical race simulation. No network or DOM access.
// Real API data is context only. The calculation uses the explicit assumptions sent by strategy.js.
function rng(seed){let x=seed|0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return((x>>>0)/4294967296);};}
const compoundOffset={SOFT:-0.55,MEDIUM:0,HARD:0.65};
self.onmessage=async(e)=>{
  if(e.data.type!=='run')return;
  const {seed,totalLaps,baseLapSeconds,fuelEffectMs,trafficLossMs,pitLossSeconds,stints}=e.data.payload;
  const random=rng(seed), laps=[]; let total=0,pitStops=0;
  for(let lap=1;lap<=totalLaps;lap++){
    const stint=stints.find(s=>lap>=s.startLap&&lap<=s.endLap); if(!stint){self.postMessage({type:'error',message:`No stint covers lap ${lap}`});return;}
    const age=lap-stint.startLap;
    const fuel=(totalLaps-lap)*(fuelEffectMs/1000);
    const degradation=age*(stint.degradationMsPerLap/1000);
    const traffic=(random()-0.5)*2*(trafficLossMs/1000);
    const variation=(random()-0.5)*0.18;
    let lapTime=baseLapSeconds+compoundOffset[stint.compound]+fuel+degradation+traffic+variation;
    const isPit=lap<totalLaps&&stints.some(s=>s.startLap===lap+1);
    if(isPit){lapTime+=pitLossSeconds;pitStops++;}
    lapTime=Math.max(30,lapTime); total+=lapTime;
    laps.push({lap,compound:stint.compound,tyreAge:age+1,lapTime:Number(lapTime.toFixed(3)),pit:isPit});
    if(lap===1||lap%5===0||lap===totalLaps) self.postMessage({type:'progress',percent:Math.round(lap/totalLaps*100),lap});
    if(lap%10===0) await new Promise(r=>setTimeout(r,0));
  }
  const avg=total/totalLaps;
  self.postMessage({type:'complete',result:{totalTimeSeconds:Number(total.toFixed(3)),averageLapSeconds:Number(avg.toFixed(3)),pitStops,laps,seed}});
};
