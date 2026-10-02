import { useEffect, useRef, useState, type ReactNode } from 'react';
import { buildOutputFilename } from '@/lib/api';
import { useMultiFileProcessor } from '@/hooks/useMultiFileProcessor';
import { useMediaJob } from './useMediaJob';
import { MediaBatchStudio, MediaBusy, MediaFinished, MediaLayout, MediaPreview, MediaRun, MediaUpload } from "./MediaStudio";
import { type MediaKind } from "./media-files";
import { fileCount } from "@/skins/experience/file-format-label";
export function MediaSingleTask({title,endpoint,accepts,params,outputExt,suffix,kind='image',resultKind,options,preview,valid=true,note}:{title:string;endpoint:string;accepts:string;params?:Record<string,string|number|boolean>;outputExt:string|((file:File)=>string);suffix:string|null;kind?:MediaKind;resultKind?:MediaKind;options:ReactNode;preview?:(file:File)=>ReactNode;valid?:boolean;note?:string}) {
 const[file,setFile]=useState<File|null>(null);const job=useMediaJob();
 if(job.result && job.status==='done')return <MediaFinished result={job.result} kind={resultKind||kind} onReset={job.reset}/>;
 // The page's H1 names the job, so the stage needs no heading of its own before a run.
 return <MediaLayout busy={job.busy} settings={<>{options}{note&&<p className="ms-caption">{note}</p>}</>}
  action={<MediaRun label={title} busy={job.busy} canRun={!!file&&valid} bar={{count:file?fileCount(1,kind==='video'?'video':kind==='audio'?'audio file':kind==='image'?'image':'file'):undefined}} onRun={()=>file&&job.run({endpoint,file,params,name:buildOutputFilename(file.name,suffix,typeof outputExt === "function" ? outputExt(file) : outputExt)})} error={job.error}/>}>
  {file?<>{preview?preview(file):<MediaPreview file={file} name={file.name} kind={kind}/>}<MediaUpload compact accepts={accepts} disabled={job.busy} title="Choose a different file" onFiles={files=>{setFile(files[0]);job.reset();}}/></>:<MediaUpload accepts={accepts} disabled={job.busy} title={kind==='video'?'Bring your clip.':kind==='audio'?'Bring your sound.':'Bring your image.'} onFiles={files=>{setFile(files[0]);job.reset();}}/>}
  {job.busy&&<><MediaBusy/><button type="button" className="ms-text" onClick={job.cancel}>Cancel request</button></>}
 </MediaLayout>;
}
export function ConfiguredMediaBatch({title,endpoint,accepts,params,outputExt,suffix,kind='video',resultKind,options,preview,valid=true}:{title:string;endpoint:string;accepts:string;params?:Record<string,string|number|boolean>;outputExt:string;suffix:string|null;kind?:MediaKind;resultKind?:MediaKind;options:ReactNode;preview?:(file:File)=>ReactNode;valid?:boolean}) {
 const proc=useMultiFileProcessor();const[phase,setPhase]=useState<'idle'|'processing'|'done'>('idle');const downloaded=useRef(false);
 useEffect(()=>{if(phase==='done'&&proc.doneCount>0&&!downloaded.current){downloaded.current=true;proc.downloadAll('media-results');}},[phase,proc]);
 const run=async(retry:boolean|'transient'=false)=>{downloaded.current=false;setPhase('processing');await proc.run({endpoint,params,outputExt,outputSuffix:suffix},retry);setPhase('done');};
 return <MediaBatchStudio proc={proc} phase={phase} title={title} accepts={accepts} kind={kind} resultKind={resultKind} options={options} action={title} onRun={run} onReset={()=>{proc.reset();setPhase('idle');downloaded.current=false;}} onDownload={()=>proc.downloadAll('media-results')} canProcess={valid} preview={preview}/>;
}
