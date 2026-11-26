export interface Shortcut {
  id: number | null; title: string; target: string; arguments: string[];
  working_directory: string; artwork: string | null; platform: string; kind: 'game' | 'app';
}
export type GameSort = 'az' | 'za' | 'platform';
export interface GameCollection { id: number; key: string; name: string; count: number; platform?: string }
const normalized = (text: string) => text.normalize('NFC').trim().toLocaleLowerCase();
export function gameCollections(games: Shortcut[]): GameCollection[] {
  const platforms = new Map<string, { name: string; count: number }>();
  for (const game of games) {
    const key = normalized(game.platform); if (!key) continue;
    const group = platforms.get(key) ?? { name: game.platform.trim(), count: 0 };
    group.count++; platforms.set(key,group);
  }
  return [
    { id: 0, key:'all', name:'All games & apps', count:games.length },
    { id: 1, key:'games', name:'Games', count:games.filter((item)=>item.kind==='game').length },
    { id: 2, key:'apps', name:'Apps', count:games.filter((item)=>item.kind==='app').length },
    ...[...platforms].sort((a,b)=>a[1].name.localeCompare(b[1].name)).map(([key,group],index)=>({id:index+3,key:'platform:'+key,name:group.name,count:group.count,platform:group.name})),
  ];
}
export function browseGames(games: Shortcut[], collection: string, query: string, sort: GameSort): Shortcut[] {
  const needle=normalized(query);
  return games.filter((game)=> (collection==='games' ? game.kind==='game' : collection==='apps' ? game.kind==='app' : collection.startsWith('platform:') ? normalized(game.platform)===collection.slice(9) : true) &&
    normalized(game.title+' '+game.platform).includes(needle)).sort((a,b)=>{
      const title=a.title.localeCompare(b.title,undefined,{numeric:true,sensitivity:'base'});
      return sort==='platform' ? normalized(a.platform).localeCompare(normalized(b.platform)) || title : sort==='za' ? -title : title;
    });
}
