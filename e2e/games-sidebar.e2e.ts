import { test,expect,type Page } from '@playwright/test';
const seed=[
  {id:1,title:'Alpha Runner',platform:'Steam',kind:'game'},
  {id:2,title:'Zenith',platform:'Steam',kind:'game'},
  {id:3,title:'Orbit',platform:'Epic',kind:'game'},
  {id:4,title:'VLC player',platform:'Utilities',kind:'app'},
  {id:5,title:'RetroArch',platform:'Emulators',kind:'app'},
].map((game)=>({...game,target:'steam://rungameid/'+game.id,arguments:[],working_directory:'',artwork:'C:/mock/'+(game.kind==='app'?'app-':'game-')+game.id+'.png'}));
const nav=(page:Page,name:string)=>page.locator('.top-nav').getByRole('button',{name,exact:true}).click();
const sidebar=(page:Page)=>page.locator('.collection-sidebar');
test.beforeEach(async({page})=>{
  await page.addInitScript((rows)=>localStorage.setItem('kinemaMockGames',JSON.stringify(rows)),seed);
  await page.route('http://asset.localhost/**',(route)=>{
    const id=Number(route.request().url().match(/(\d+)\.png/)?.[1]??1),color=['#415a91','#685b91','#986041','#28756b','#6e4d86'][id%5];
    return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${color}"/><stop offset="1" stop-color="#111b2e"/></linearGradient></defs><rect width="400" height="600" fill="url(#g)"/><circle cx="290" cy="180" r="130" fill="#ffffff16"/><path d="M-20 500 420 260v340H0" fill="#0004"/><text x="35" y="510" fill="white" font-size="40">${seed.find((game)=>game.id===id)?.title??'GAME'}</text></svg>`});
  });
  await page.goto('/');await nav(page,'Games');
});
test('games and apps match the library sidebar design with platform groups, search and sorting',async({page})=>{
  await expect(sidebar(page).getByRole('button',{name:'All games & apps (5)',exact:true})).toBeVisible();
  await expect(sidebar(page).getByRole('button',{name:'Games (3)',exact:true})).toBeVisible();
  await expect(sidebar(page).getByRole('button',{name:'Apps (2)',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Add game or app',exact:true})).toHaveCount(0);
  await expect(page.locator('.game-tile')).toHaveCount(5);
  await page.screenshot({path:'work/games-sidebar-desktop.png'});
  await sidebar(page).getByRole('button',{name:'Steam (2)',exact:true}).click();
  await expect(page.locator('.game-tile strong')).toHaveText(['Alpha Runner','Zenith']);
  expect(await page.evaluate(()=>localStorage.getItem('kinemaMockLaunchedGame'))).toBeNull();
  await page.getByRole('button',{name:'Search games and apps',exact:true}).click();
  await page.getByRole('searchbox').fill('zen');
  await expect(page.locator('.game-tile strong')).toHaveText(['Zenith']);
  await page.getByRole('button',{name:'Search games and apps',exact:true}).click();
  await page.getByRole('combobox',{name:'Sort games and apps by',exact:true}).selectOption('za');
  await expect(page.locator('.game-tile strong')).toHaveText(['Zenith','Alpha Runner']);
  await page.getByRole('button',{name:'Launch Zenith',exact:true}).click();
  expect(await page.evaluate(()=>localStorage.getItem('kinemaMockLaunchedGame'))).toBe('2');
  await sidebar(page).getByRole('button',{name:'Apps (2)',exact:true}).click();
  await expect(page.locator('.game-tile')).toHaveCount(2);
  await expect(page.locator('.kind-app img').first()).toHaveCSS('object-fit','cover');
  await nav(page,'Movies');await nav(page,'Games');
  await expect(sidebar(page).getByRole('button',{name:'Apps (2)',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('combobox',{name:'Sort games and apps by',exact:true})).toHaveValue('za');
});
test('management edits groups and titles without launching and Cancel leaves the shortcut untouched',async({page})=>{
  await sidebar(page).getByRole('button',{name:'Manage collections',exact:true}).click();
  const manager=page.getByRole('dialog',{name:'Manage games & apps',exact:true});
  await manager.getByRole('combobox',{name:'Shortcut to manage',exact:true}).selectOption('1');
  await manager.getByRole('button',{name:'Edit selected',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'Game or app shortcut',exact:true});
  await editor.getByLabel('Title',{exact:true}).fill('Do not save');
  await editor.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(manager.getByRole('combobox').locator('option:checked')).toHaveText('Alpha Runner');
  await manager.getByRole('button',{name:'Edit selected',exact:true}).click();
  await editor.getByLabel('Title',{exact:true}).fill('Alpha Remastered');
  await editor.getByLabel('Platform or launcher',{exact:true}).fill('Favorites');
  await editor.getByRole('button',{name:'Save',exact:true}).click();
  await expect(manager.getByRole('combobox').locator('option:checked')).toHaveText('Alpha Remastered');
  await manager.getByRole('button',{name:'Done',exact:true}).click();
  await expect(sidebar(page).getByRole('button',{name:'Favorites (1)',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('kinemaMockLaunchedGame'))).toBeNull();
});
test('controller navigation reaches the sidebar and Handheld management opens above a closed drawer',async({page})=>{
  const tiles=page.locator('.game-tile');await expect(tiles).toHaveCount(5);
  await tiles.first().focus();await page.keyboard.press('ArrowLeft');
  await expect(sidebar(page).getByRole('button',{name:'All games & apps (5)',exact:true})).toHaveClass(/focused/);
  await page.keyboard.press('ArrowRight');await expect(tiles.first()).toHaveClass(/focused/);
  await page.keyboard.press('ArrowRight');await expect(tiles.nth(1)).toHaveClass(/focused/);
  await nav(page,'Settings');
  await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Playback',exact:true}).click();
  await page.getByRole('radiogroup',{name:'Where Kinema is used',exact:true}).getByRole('button',{name:'Handheld',exact:true}).click();
  await page.setViewportSize({width:854,height:480});await nav(page,'Games');
  await expect(sidebar(page)).toHaveCount(0);
  const toggle=page.getByRole('button',{name:'Collections',exact:true});
  await toggle.click();await sidebar(page).getByRole('button',{name:'Apps (2)',exact:true}).click();
  await expect(sidebar(page)).toHaveCount(0);await expect(tiles).toHaveCount(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const title=page.getByRole('heading',{name:'Apps',exact:true});
  await expect(title).toBeVisible();
  const top=(await title.boundingBox())!.y, navBottom=await page.locator('.top-nav').evaluate((node)=>node.getBoundingClientRect().bottom);
  expect(top).toBeGreaterThanOrEqual(navBottom-1);
  await page.screenshot({path:'work/games-sidebar-handheld.png'});
  await toggle.click();await sidebar(page).getByRole('button',{name:'Manage collections',exact:true}).click();
  await expect(sidebar(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});
