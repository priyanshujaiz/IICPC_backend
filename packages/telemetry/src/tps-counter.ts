interface Window{
    count:number;
    windowStart:number;
}

const windows =new Map<string,Window>();

export function recordEvent(submissionId:string):void{
    const existing=windows.get(submissionId);
    if(existing){
        existing.count++;
    }else{
        windows.set(submissionId,{count:1,windowStart:Date.now()});
    }
}

/**
 * Returns the TPS for the last window and resets the counter.
 * Call this once per flush cycle (every 1000ms).
 */

export function flushTps(submissionId:string):number{
    const existing=windows.get(submissionId);

    if(!existing || existing.count===0)return 0;

    const elapsedSec=(Date.now()-existing.windowStart)/1000;
    const tps=elapsedSec>0?existing.count/elapsedSec:0;

    //Reset the window
    windows.set(submissionId,{count:0,windowStart:Date.now()});

    return Math.round(tps);
}

export function removeTpsWindow(submissionId: string):void{
    windows.delete(submissionId);
}