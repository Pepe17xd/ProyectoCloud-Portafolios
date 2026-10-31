const fmtCache = new Map();
function parts(date, timezone) {
  let fmt=fmtCache.get(timezone); if(!fmt){fmt=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});fmtCache.set(timezone,fmt);}
  return Object.fromEntries(fmt.formatToParts(date).map(p=>[p.type,p.value]));
}
export function nextFlowRun({frequency,time='09:00',dayOfWeek=1,timezone='America/Lima'},after=new Date()) {
  if(!['daily','weekly'].includes(frequency)) return null;
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Invalid schedule time');
  if(!Number.isInteger(dayOfWeek)||dayOfWeek<0||dayOfWeek>6) throw new Error('Invalid dayOfWeek');
  new Intl.DateTimeFormat('en',{timeZone:timezone});
  const [hour,minute]=time.split(':').map(Number); const start=Math.floor(after.getTime()/60000)*60000+60000;
  for(let offset=0;offset<=9*24*60;offset++) { const date=new Date(start+offset*60000);const p=parts(date,timezone);const weekday=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday);if(Number(p.hour)===hour&&Number(p.minute)===minute&&(frequency==='daily'||weekday===dayOfWeek))return date.toISOString(); }
  throw new Error('Could not find next schedule time');
}

export async function dispatchDueFlows({store,execute,now=new Date(),limit=20,maxRetries=3,timeoutMs=240000}) {
  const due=await store.listDue(now.toISOString(),limit);const results=[];
  for(const flow of due){
    if(!flow.enabled){results.push({flowId:flow.id,status:'SKIPPED',reason:'DISABLED'});continue;}
    const scheduledFor=flow.nextRunAt;const idempotencyKey=`${flow.id}:${scheduledFor}`;
    const lease=await store.claim({flow,idempotencyKey,scheduledFor,now:now.toISOString()});if(!lease){results.push({flowId:flow.id,status:'SKIPPED',reason:'ALREADY_CLAIMED'});continue;}
    let outcome;
    for(let attempt=1;attempt<=maxRetries;attempt++){
      let timer;try { const value=await Promise.race([execute(flow,{idempotencyKey,scheduledFor}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('FLOW_TIMEOUT')),timeoutMs);})]);clearTimeout(timer);await store.finish({flow,idempotencyKey,status:'SUCCEEDED',value,attempt,completedAt:new Date().toISOString()});outcome={flowId:flow.id,status:'SUCCEEDED',attempt};break; }
      catch(error){clearTimeout(timer);await store.recordFailure({flow,idempotencyKey,attempt,message:String(error.message||'Execution failed').slice(0,240),at:new Date().toISOString()});if(attempt===maxRetries){await store.finish({flow,idempotencyKey,status:'FAILED',attempt,completedAt:new Date().toISOString()});outcome={flowId:flow.id,status:'FAILED',attempt};}else await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**(attempt-1),8000)));}
    }
    await store.advance({flow,scheduledFor,completedAt:new Date().toISOString()});results.push(outcome);
  }
  return results;
}
