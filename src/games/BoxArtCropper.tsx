import { useEffect, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import FocusButton from '../ui/FocusButton';
import FocusRange from '../ui/FocusRange';
import FocusSelect from '../ui/FocusSelect';
import FocusGroup, { FocusProvider } from '../ui/FocusGroup';
import { useFocusGroup } from '../ui/focusGroups';
import { useLanding } from '../ui/focusStore';
import { cropFrame } from './crop';
export default function BoxArtCropper({path,onUse,onCancel}:{path:string;onUse:(path:string)=>void;onCancel:()=>void}) {
  const [size,setSize]=useState<{width:number;height:number}|null>(null);
  const [shape,setShape]=useState('portrait'); const [zoom,setZoom]=useState(100);
  const [horizontal,setHorizontal]=useState(50),[vertical,setVertical]=useState(50);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const {ref,focusKey}=useFocusGroup('menu',{current:'box-art-use'});useLanding('box-art-use');
  useEffect(()=>{
    const back=(event:KeyboardEvent)=>{if(['Escape','Backspace','BrowserBack'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();if(!busy)onCancel();}};
    window.addEventListener('keydown',back,true);return()=>window.removeEventListener('keydown',back,true);
  },[busy,onCancel]);
  const ratio=shape==='square'?1:shape==='wide'?16/9:shape==='original'&&size?size.width/size.height:3/4;
  const crop=size?cropFrame(size.width,size.height,ratio,zoom,horizontal,vertical):null;
  async function applyImage() {
    if(!crop||busy)return;setBusy(true);setError('');
    try { onUse(await invoke<string>('game_crop_artwork',{path,crop})); }
    catch(reason){setError(String(reason));}finally{setBusy(false);}
  }
  return <FocusProvider value={focusKey}><div className="leave-backdrop box-art-backdrop"><section className="leave box-art-cropper" role="dialog" aria-modal="true" aria-label="Preview and crop box art" ref={ref}>
    <h2>Preview and crop box art</h2><p>Your original image stays unchanged. Adjust the frame, then use the image. Save the shortcut to keep it.</p>
    <img className="box-art-source" src={convertFileSrc(path)} alt="" onLoad={(event)=>setSize({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})} onError={()=>setError('This image could not be displayed. Choose another image.')}/>
    <div className="box-art-workspace">
      <div className="box-art-preview" style={{aspectRatio:String(ratio)}} aria-label="Cropped box art preview">{size&&crop&&<svg viewBox={`${crop.x*size.width} ${crop.y*size.height} ${crop.width*size.width} ${crop.height*size.height}`}><image href={convertFileSrc(path)} width={size.width} height={size.height}/></svg>}</div>
      <FocusGroup kind="list" className="box-art-controls">
        <label>Shape<FocusSelect label="Box art shape" value={shape} choices={[{value:'portrait',label:'Box art (3:4)'},{value:'square',label:'Square'},{value:'wide',label:'Widescreen'},{value:'original',label:'Original shape'}]} onChange={setShape}/></label>
        <label>Zoom {zoom}%<FocusRange label="Box art zoom" value={zoom} min={100} max={300} step={5} onChange={setZoom}/></label>
        <label>Horizontal position<FocusRange label="Box art horizontal position" value={horizontal} min={0} max={100} onChange={setHorizontal}/></label>
        <label>Vertical position<FocusRange label="Box art vertical position" value={vertical} min={0} max={100} onChange={setVertical}/></label>
        <FocusButton disabled={busy} onSelect={()=>{setZoom(100);setHorizontal(50);setVertical(50);setShape('portrait');}}>Reset crop</FocusButton>
      </FocusGroup>
    </div>
    {error&&<p role="alert">{error}</p>}
    <FocusGroup kind="row" className="games-actions"><FocusButton disabled={busy} onSelect={onCancel}>Cancel crop</FocusButton><FocusButton focusKey="box-art-use" disabled={busy||!size||!!error} onSelect={()=>void applyImage()}>{busy?'Preparing image…':'Use image'}</FocusButton></FocusGroup>
  </section></div></FocusProvider>;
}
