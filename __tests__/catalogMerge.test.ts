import { describe, expect, it } from 'vitest';
import { mergeCatalog, sameValue } from '../src/utils/catalogMerge';
import { audioSyncCatalogOptions } from '../src/utils/catalogApi';
const a = { id: 'sal2', title: 'Sal 2', slides: ['base'] };
const b = { id: 'sal6', title: 'Sal 6', slides: ['base'] };
const c = { id: 'sal8', title: 'Sal 8', slides: ['base'] };
describe('three-way catalog merge', () => {
  it('combines Sal 2 and Sal 6 without changing either edit', () => {
    const mine = { ...a, slides: ['local'] }, theirs = { ...b, slides: ['remote'] };
    expect(mergeCatalog([a,b], [mine,b], [a,theirs])).toEqual({ items: [mine,theirs], conflicts: [] });
  });
  it('requires a choice for two edits of the same record', () => {
    const mine = { ...a, title: 'Mine' }, theirs = { ...a, title: 'Theirs' };
    const merge = mergeCatalog([a,b], [mine,b], [theirs,b]);
    expect(merge.conflicts).toEqual([{ key: 'item:sal2', label: 'Mine', base: a, local: mine, remote: theirs }]);
    expect(mergeCatalog([a,b], [mine,b], [theirs,b], { 'item:sal2':'local' }).items).toEqual([mine,b]);
    expect(mergeCatalog([a,b], [mine,b], [theirs,b], { 'item:sal2':'remote' }).items).toEqual([theirs,b]);
  });
  it('does not resurrect a remote deletion when the local record is unchanged', () => {
    expect(mergeCatalog([a,b], [a,{...b,title:'Local'}], [b])).toEqual({items:[{...b,title:'Local'}],conflicts:[]});
  });
  it('reviews deletion versus editing and retains the position of a kept record', () => {
    const remote = [{...a,title:'Remote'},b,c];
    expect(mergeCatalog([a,b,c], [b,c], remote).conflicts[0].local).toBeUndefined();
    expect(mergeCatalog([a,b,c], [b,c], remote, {'item:sal2':'remote'}).items).toEqual(remote);
    expect(mergeCatalog([a,b,c], [b,c], remote, {'item:sal2':'local'}).items).toEqual([b,c]);
  });
  it('keeps concurrent additions and identical edits without a conflict', () => {
    expect(mergeCatalog([], [a], [b])).toEqual({items:[b,a],conflicts:[]});
    expect(mergeCatalog([a], [{...a,title:'Same'}], [{...a,title:'Same'}]).conflicts).toEqual([]);
  });
  it('retains one reorder and explicitly reviews incompatible concurrent reorders', () => {
    expect(mergeCatalog([a,b,c], [b,a,c], [a,b,{...c,title:'Remote'}]).items.map(p=>p.id)).toEqual(['sal6','sal2','sal8']);
    expect(mergeCatalog([a,b,c], [b,a,c], [a,c,b]).conflicts.map(p=>p.key)).toEqual(['order']);
    expect(mergeCatalog([a,b,c], [b,a,c], [a,c,b], {order:'local'}).items).toEqual([b,a,c]);
  });
  it('compares object values independently of property order and rejects duplicate keys', () => {
    expect(sameValue({a:1,b:2},{b:2,a:1})).toBe(true);
    expect(()=>mergeCatalog([a,a],[a],[a])).toThrow('duplicate');
  });
  it('treats concurrent new maps for the same presentation and track as a conflict', () => {
    const map = { id:'m1', name:'Map', presentationId:'p',audioSrc:'/test.mp3',cues:[],defaultSyncMode:'unilateral' as const,defaultVolume:0.7 };
    const result = mergeCatalog([], [map], [{...map,id:'m2',defaultVolume:0.5}], {}, audioSyncCatalogOptions.keyOf);
    expect(result.conflicts).toHaveLength(1);
  });
});
