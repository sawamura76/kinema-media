import { describe,expect,it } from 'vitest';
import { browseGames,gameCollections,type Shortcut } from './model';
const shortcut=(id:number,title:string,platform:string,kind:'game'|'app'='game'):Shortcut=>({id,title,platform,kind,target:'steam://rungameid/'+id,arguments:[],working_directory:'',artwork:null});
describe('game sidebar collections',()=>{
  it('keeps launcher groups case-insensitive without changing saved shortcuts',()=>{
    const games=[shortcut(1,'Game 10','Steam'),shortcut(2,'Game 2',' steam '),shortcut(3,'Player','Utilities','app')];
    const groups=gameCollections(games);
    expect(groups.map((group)=>[group.key,group.count])).toEqual([['all',3],['games',2],['apps',1],['platform:steam',2],['platform:utilities',1]]);
    expect(games[1].platform).toBe(' steam ');
    expect(browseGames(games,'platform:steam','','az').map((game)=>game.id)).toEqual([2,1]);
    expect(browseGames(games,'apps','','az').map((game)=>game.id)).toEqual([3]);
  });
  it('searches within a selected collection, supports reverse order, and keeps unlabelled entries',()=>{
    const games=[shortcut(1,'Alpha',''),shortcut(2,'Beta','Emulators'),shortcut(3,'Gamma','Utilities','app')];
    expect(browseGames(games,'all','','za').map((game)=>game.id)).toEqual([3,2,1]);
    expect(browseGames(games,'games','utilities','az')).toEqual([]);
    expect(browseGames(games,'all','EMULATORS','az').map((game)=>game.id)).toEqual([2]);
    expect(gameCollections(games).find((group)=>group.key==='all')?.count).toBe(3);
  });
});
