import { useRef } from 'react';
import { useNavKey } from './focusGroups';
import { useNavLeaf } from './focusStore';
export default function FocusRange({label,value,min,max,step=1,onChange}:{label:string;value:number;min:number;max:number;step?:number;onChange:(value:number)=>void}) {
  const ref=useRef<HTMLInputElement>(null); const key=useNavKey();
  const adjust=(value:number)=>onChange(Math.max(min,Math.min(max,value)));
  const leaf=useNavLeaf(key,ref,{on:true,onArrow:(arrow)=>{
    if(arrow!=='left'&&arrow!=='right')return false;
    adjust(value+(arrow==='left'?-step:step));return true;
  }});
  return <input ref={ref} type="range" aria-label={label} min={min} max={max} step={step} value={value} className={leaf.focused?'focused':''} onChange={(event)=>adjust(Number(event.target.value))} {...leaf.props}/>;
}
