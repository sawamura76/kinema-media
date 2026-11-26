import { expect, it } from 'vitest';
import { gamepadKeys } from './gamepad';
it('maps Ally/Xbox controls and ignores stick drift', () => {
  expect(gamepadKeys([], [0.2, -0.3])).toEqual([]);
  const buttons: boolean[] = []; buttons[0] = true; buttons[15] = true;
  expect(gamepadKeys(buttons, [0, 0])).toEqual(['ArrowRight', 'Enter']);
  expect(gamepadKeys([], [0, -0.8])).toEqual(['ArrowUp']);
});

it('maps bumpers to top navigation rather than page scrolling',()=>{
 const buttons:boolean[]=[];buttons[4]=true;expect(gamepadKeys(buttons,[])).toEqual(['KinemaPreviousTab']);
 buttons[4]=false;buttons[5]=true;expect(gamepadKeys(buttons,[])).toEqual(['KinemaNextTab']);
});

it('maps triggers and face buttons to media controls',()=>{
 for(const [index,key] of [[2,'AudioVolumeMute'],[3,'MediaPlayPause'],[6,'MediaTrackPrevious'],[7,'MediaTrackNext']] as const){
 const buttons:boolean[]=[];buttons[index]=true;expect(gamepadKeys(buttons,[])).toEqual([key]);
 }
});
