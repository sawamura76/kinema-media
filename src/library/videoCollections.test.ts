import { describe, expect, it } from 'vitest';
import { filterCollectionTitles, type VideoCollections } from './videoCollections';
const library: VideoCollections = { collections: [], roots: [], titles: [{ title_id:1, collection_id:1 }, { title_id:2, collection_id:3 }, { title_id:1, collection_id:3 }] };
describe('video collection browsing', () => {
  it('filters by folder membership while supporting shared titles and All collections', () => {
    const titles=[{id:1},{id:2},{id:3}];
    expect(filterCollectionTitles(titles,library,1)).toEqual([{id:1}]);
    expect(filterCollectionTitles(titles,library,3)).toEqual([{id:1},{id:2}]);
    expect(filterCollectionTitles(titles,library,4)).toEqual([]);
    expect(filterCollectionTitles(titles,library,0)).toBe(titles);
    expect(filterCollectionTitles(titles,null,1)).toBe(titles);
  });
});
