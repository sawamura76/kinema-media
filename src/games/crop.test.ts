import {expect,it} from 'vitest';
import {cropFrame} from './crop';
it('fits portrait art within a landscape image and moves the frame without leaving it',()=>{
 const left=cropFrame(1600,900,3/4,100,0,50),right=cropFrame(1600,900,3/4,100,100,50);
 expect(left.x).toBe(0); expect(right.x+right.width).toBeCloseTo(1);
 expect(left.height).toBe(1); expect(left.width*1600/(left.height*900)).toBeCloseTo(3/4);
 const zoom=cropFrame(1600,900,1,200,50,100);expect(zoom.y+zoom.height).toBeCloseTo(1);
});
