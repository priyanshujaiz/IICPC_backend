import {build} from 'hdr-histogram-js';

type Histogram= ReturnType<typeof build>;

const histograms=new Map<string,Histogram>();

export interface Percentile{
    p50:number;
    p90:number;
    p99:number;
    totalCount:number;
}

export function getOrCreateHistogram(submissionId: string):Histogram{
    if(!histograms.has(submissionId)){
        histograms.set(submissionId,
            build({
                lowestDiscernibleValue:1,  //1 ms as minimum
                highestTrackableValue:60_000,  //60 s max
                numberOfSignificantValueDigits:3,
            })
        );
    }
    return histograms.get(submissionId)!;
}

export function recordsLatency(submissionId:string ,latencyMs:number):void{
    const hist=getOrCreateHistogram(submissionId);

    const clamped=Math.max(1,Math.min(60_000,Math.round(latencyMs)));
    hist.recordValue(clamped);
}


export function getPercentiles(submissionId:string):Percentile{
    const hist=getOrCreateHistogram(submissionId);

    if(!hist || hist.totalCount===0){
        return  { p50: 0, p90: 0, p99: 0, totalCount: 0 };
    }
    return {
        p50: hist.getValueAtPercentile(50),
        p90: hist.getValueAtPercentile(90),
        p99: hist.getValueAtPercentile(99),
        totalCount: hist.totalCount,
    };
}


export function getAllSubmissionIds():string[]{
    return [...histograms.keys()];
}

export function removeHistogram(submissionId:string):void{
    histograms.delete(submissionId);
}