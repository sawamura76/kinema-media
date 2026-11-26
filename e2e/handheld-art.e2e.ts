import {test,expect} from '@playwright/test';
import {pause} from './kb';
test.beforeEach(async({page})=>{await page.addInitScript(()=>{localStorage.setItem('kinemaMockMusic','1');localStorage.setItem('kinema.music.language','en');});await page.goto('/');});
test('handheld resets saved scale and removes its slider',async({page})=>{
 await page.evaluate(()=>localStorage.setItem('kinemaMockPersistedLayout',JSON.stringify([['ui_mode','handheld'],['handheld_scale','115']])));
 await page.reload();await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.documentElement).fontSize)).toBe('20px');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Playback',exact:true}).click();
 await expect(page.getByRole('slider',{name:'Handheld interface scale',exact:true})).toHaveCount(0);
 await page.reload();await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.documentElement).fontSize)).toBe('20px');
});

test('bumper events cycle primary tabs and leave an open dialog alone',async({page})=>{
 const bump=(key:string)=>page.evaluate((key)=>window.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true})),key);
 await page.locator('.top-nav').getByRole('button',{name:'Home',exact:true}).click();
 await bump('KinemaNextTab');await expect(page.locator('.top-nav .active')).toHaveAttribute('aria-label','Movies');
 await bump('KinemaPreviousTab');await expect(page.locator('.top-nav .active')).toHaveAttribute('aria-label','Home');
 await bump('KinemaPreviousTab');await expect(page.locator('.top-nav .active')).toHaveAttribute('aria-label','Games');
 await page.locator('.games-empty').getByRole('button',{name:'Manage games & apps',exact:true}).click();
 await bump('KinemaNextTab');await expect(page.getByRole('dialog',{name:'Manage games & apps',exact:true})).toBeVisible();
 await expect(page.locator('.top-nav .active')).toHaveAttribute('aria-label','Games');
});
test('box art previews, crops and cancels without replacing a saved draft',async({page})=>{
 await page.route('http://asset.localhost/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="450" height="600" fill="red"/><rect x="450" width="450" height="600" fill="blue"/></svg>'}));
 await page.locator('.top-nav').getByRole('button',{name:'Games',exact:true}).click();
 await page.locator('.games-empty').getByRole('button',{name:'Manage games & apps',exact:true}).click();
 await page.getByRole('button',{name:'Add game or app',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Game or app shortcut',exact:true});
 await page.evaluate(()=>localStorage.setItem('kinemaMockPick','C:/cover.png'));
 await editor.getByRole('button',{name:'Choose cover art',exact:true}).click();
 const cropper=page.getByRole('dialog',{name:'Preview and crop box art',exact:true});
 await expect(cropper.getByRole('button',{name:'Use image',exact:true})).toBeEnabled();
 await cropper.getByRole('slider',{name:'Box art horizontal position',exact:true}).fill('100');
 await cropper.getByRole('slider',{name:'Box art zoom',exact:true}).fill('150');
 const bounds=(await cropper.getByLabel('Cropped box art preview',{exact:true}).boundingBox())!;expect(bounds.width/bounds.height).toBeCloseTo(3/4,1);
 await page.screenshot({path:'work/box-art-cropper.png'});
 await cropper.getByRole('button',{name:'Use image',exact:true}).click();
 await expect(editor.getByRole('img',{name:'Cover preview'})).toHaveAttribute('src',/cropped-game-cover/);
 const applied=await page.evaluate(()=>JSON.parse(localStorage.getItem('kinemaMockBoxArtCrop')!));expect(applied.x+applied.width).toBeCloseTo(1);
 await editor.getByRole('button',{name:'Choose cover art',exact:true}).click();await page.keyboard.press('Escape');
 await expect(cropper).toHaveCount(0);await expect(editor).toBeVisible();
 await expect(editor.getByRole('img',{name:'Cover preview'})).toHaveAttribute('src',/cropped-game-cover/);
});

for(const mode of ['Handheld','TV']) test(`${mode}: highlighting primary tabs opens them and bumpers keep the ring on the menu`,async({page})=>{
 await page.locator('.top-nav').getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Playback',exact:true}).click();
 await page.getByRole('radiogroup',{name:'Where Kinema is used'}).getByRole('button',{name:mode,exact:true}).click();
 await page.locator('.top-nav').getByRole('button',{name:'Music',exact:true}).click();
 await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'KinemaNextTab',bubbles:true})));
 await expect(page.locator('.top-nav .active')).toHaveAttribute('aria-label','Games');
 await expect(page.locator('.top-nav .focused')).toHaveAttribute('aria-label','Games');
 await page.keyboard.press('ArrowLeft');
 await expect(page.locator('.top-nav .active')).toHaveAttribute('aria-label','Music');
 await expect(page.locator('.top-nav .focused')).toHaveAttribute('aria-label','Music');
 await page.keyboard.press('ArrowLeft');
 await expect(page.locator('.top-nav .active')).toHaveAttribute('aria-label','TV shows');
 await page.keyboard.press('ArrowRight');
 await expect(page.locator('.top-nav .active')).toHaveAttribute('aria-label','Music');
 await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'KinemaPreviousTab',bubbles:true})));
 await expect(page.locator('.top-nav .focused')).toHaveAttribute('aria-label','TV shows');
 await expect(page.locator('.top-nav .active')).toHaveAttribute('aria-label','TV shows');
 await page.screenshot({path:`work/top-nav-auto-${mode}.png`});
 await page.locator('.top-nav').getByRole('button',{name:'Music',exact:true}).click();
 await page.getByRole('button',{name:'Album',exact:true}).click();
 await page.getByRole('button',{name:'First album Test artist',exact:true}).click();
 await expect(page.locator('.music-album-detail')).toBeVisible();
 for(let step=0;step<5&&await page.locator('.music-album-detail').count();step++)await page.keyboard.press('ArrowUp');
 await expect(page.locator('.music-album-detail')).toHaveCount(0);
 await expect(page.locator('.top-nav .focused')).toHaveAttribute('aria-label','Music');

});
test('PC arrows highlight tabs without opening them until Enter',async({page})=>{
 await page.locator('.top-nav').getByRole('button',{name:'Music',exact:true}).click();
 await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'KinemaNextTab',bubbles:true})));
 await expect(page.locator('.top-nav .focused')).toHaveAttribute('aria-label','Games');
 await page.keyboard.press('ArrowLeft');
 await expect(page.locator('.top-nav .focused')).toHaveAttribute('aria-label','Music');
 await expect(page.locator('.top-nav .active')).toHaveAttribute('aria-label','Games');
 await page.keyboard.press('Enter');await expect(page.locator('.top-nav .active')).toHaveAttribute('aria-label','Music');
});

test('physical-style standard gamepad bumpers switch once per press',async({page})=>{
 await page.evaluate(()=>{
   const buttons=Array.from({length:16},()=>({pressed:false,value:0,touched:false}));
   const pad={connected:true,mapping:'standard',axes:[0,0,0,0],buttons};
   Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[pad]});
   (window as unknown as {testPad:typeof pad}).testPad=pad;
 });
 await page.locator('.top-nav').getByRole('button',{name:'Music',exact:true}).click();
 const press=async(index:number,on:boolean)=>page.evaluate(({index,on})=>{
   const pad=(window as unknown as {testPad:{buttons:{pressed:boolean;value:number}[]}}).testPad;
   pad.buttons[index].pressed=on;pad.buttons[index].value=on?1:0;
 },{index,on});
 await press(5,true);await expect(page.locator('.top-nav .active')).toHaveAttribute('aria-label','Games');
 await pause(page,250,'Hold the physical-style bumper across animation frames to check it does not repeat');await expect(page.locator('.top-nav .active')).toHaveAttribute('aria-label','Games');
 await press(5,false);await pause(page,80,'Let the gamepad poll observe bumper release before the next press');await press(4,true);
 await expect(page.locator('.top-nav .active')).toHaveAttribute('aria-label','Music');
 await press(4,false);
});
test('saved excessive scale resets to 100 and fullscreen buttons remain square',async({page})=>{
 await page.evaluate(()=>localStorage.setItem('kinemaMockPersistedLayout',JSON.stringify([['ui_mode','handheld'],['handheld_scale','150']])));
 await page.reload();await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.documentElement).fontSize)).toBe('20px');
 await page.setViewportSize({width:1280,height:720});
 await page.locator('.top-nav').getByRole('button',{name:'Music',exact:true}).click();
 await page.getByRole('button',{name:'Album',exact:true}).click();
 await page.getByRole('button',{name:'First album Test artist',exact:true}).click();
 await page.getByRole('button',{name:'▶ Play',exact:true}).click();
 const fullscreen=page.getByRole('button',{name:'Open full-screen music',exact:true});
 for(const width of [1280,854]){
   await page.setViewportSize({width,height:720});
   const rect=(await fullscreen.boundingBox())!;expect(Math.abs(rect.width-rect.height)).toBeLessThan(1);
   const centre=(await page.locator('.music-player .player-group-centre').boundingBox())!,right=(await page.locator('.music-player .player-group-right').boundingBox())!;expect(centre.x+centre.width).toBeLessThanOrEqual(right.x+1);
 }
 await fullscreen.click();
 const exit=page.locator('.music-player').getByRole('button',{name:'Exit full-screen music',exact:true});
 const rect=(await exit.boundingBox())!;expect(Math.abs(rect.width-rect.height)).toBeLessThan(1);
 await page.screenshot({path:'work/handheld-115-round-controls.png'});
});

for(const scale of [85,100,115])for(const width of [1280,854])test(`visualizer check marks stay inside boxes at ${scale}% and ${width}px`,async({page})=>{
 await page.addInitScript((scale)=>localStorage.setItem('kinemaMockPersistedLayout',JSON.stringify([['ui_mode','handheld'],['handheld_scale',String(scale)]])),scale);
 await page.reload();await page.setViewportSize({width,height:width===854?480:720});
 await page.locator('.top-nav').getByRole('button',{name:'Music',exact:true}).click();
 await page.getByRole('button',{name:'Album',exact:true}).click();
 await page.getByRole('button',{name:'First album Test artist',exact:true}).click();
 await page.getByRole('button',{name:'▶ Play',exact:true}).click();
 await page.getByRole('button',{name:'Open full-screen music',exact:true}).click();
 await page.getByRole('button',{name:'Visualizer',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'Visualizer',exact:true});
 for(const category of ['Art','Butterchurn','Spectrum analyzer']){
  await panel.getByRole('button',{name:/^Category:/}).click();
  await panel.locator('.music-viz-dropdown').getByRole('button',{name:category,exact:true}).click();
  await expect(panel.locator('.music-viz-check').first()).toBeVisible();
  const checks=await panel.locator('.music-viz-check').evaluateAll((buttons)=>buttons.map((button)=>{
   const box=button.getBoundingClientRect(),mark=button.querySelector('svg')!.getBoundingClientRect();
   return {square:Math.abs(box.width-box.height)<1,inside:mark.left>=box.left&&mark.right<=box.right&&mark.top>=box.top&&mark.bottom<=box.bottom,centered:Math.abs((mark.left+mark.right-box.left-box.right)/2)<1&&Math.abs((mark.top+mark.bottom-box.top-box.bottom)/2)<1};
  }));
  expect(checks.length).toBeGreaterThan(0);for(const check of checks)expect(check).toEqual({square:true,inside:true,centered:true});
 }
 if(scale===115&&width===854)await page.screenshot({path:'work/visualizer-checks-115-handheld.png'});
});

test('physical controller media buttons control music',async({page})=>{
 await page.evaluate(()=>{
  const pad={connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0,touched:false}))};
  Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[pad]});
  (window as unknown as {testPad:typeof pad}).testPad=pad;
 });
 await page.locator('.top-nav').getByRole('button',{name:'Music',exact:true}).click();
 await page.getByRole('button',{name:'Album',exact:true}).click();
 await page.getByRole('button',{name:'First album Test artist',exact:true}).click();
 await page.getByRole('button',{name:'\u25b6 Play',exact:true}).click();
 const press=async(index:number,on:boolean)=>page.evaluate(({index,on})=>{
  const pad=(window as unknown as {testPad:{buttons:{pressed:boolean;value:number}[]}}).testPad;
  pad.buttons[index].pressed=on;pad.buttons[index].value=on?1:0;
 },{index,on});
 const release=async(index:number)=>{await press(index,false);await pause(page,80,'Observe controller release before next press');};
 await press(7,true);await expect(page.locator('.music-player')).toContainText('Song 2');await expect(page.locator('.music-loading')).toHaveCount(0);
 await pause(page,450,'Held trigger should skip once');await expect(page.locator('.music-player')).toContainText('Song 2');await release(7);
 await press(6,true);await expect(page.locator('.music-player')).toContainText('Song 1');await release(6);
 const state=(key:'paused'|'mute')=>page.evaluate((key)=>(window as unknown as {__fakeMpv:{paused:boolean;mute:boolean}}).__fakeMpv[key],key);
 for(const [index,key] of [[3,'paused'],[2,'mute']] as const){
  await press(index,true);await expect.poll(()=>state(key)).toBe(true);
  if(key==='mute'){await expect(page.locator('.music-player').getByRole('slider',{name:'Volume',exact:true})).toHaveValue('0');await expect(page.locator('.music-player').getByRole('img',{name:'Muted',exact:true})).toBeVisible();}
  await pause(page,450,'Held face button must not repeat');await expect.poll(()=>state(key)).toBe(true);await release(index);
  await press(index,true);await expect.poll(()=>state(key)).toBe(false);await release(index);
  if(key==='mute')await expect(page.locator('.music-player').getByRole('slider',{name:'Volume',exact:true})).not.toHaveValue('0');
 }
});

test('playback cover opens its album from another page and fullscreen',async({page})=>{
 await page.locator('.top-nav').getByRole('button',{name:'Music',exact:true}).click();
 await page.getByRole('button',{name:'Album',exact:true}).click();
 await page.getByRole('button',{name:'First album Test artist',exact:true}).click();
 await page.getByRole('button',{name:'\u25b6 Play',exact:true}).click();
 await page.locator('.top-nav').getByRole('button',{name:'Games',exact:true}).click();
 await page.getByRole('button',{name:'Open album: First album',exact:true}).click();
 await expect(page.locator('.music-album-detail')).toContainText('First album');
 await expect(page.getByRole('button',{name:'\u25b6 Play',exact:true})).toHaveClass(/focused/);
 await page.getByRole('button',{name:'Open full-screen music',exact:true}).click();
 await page.getByRole('button',{name:'Open album: First album',exact:true}).click();
 await expect(page.locator('.music-album-detail')).toContainText('First album');
 await expect(page.locator('.music-player')).toContainText('Song 1');
});
