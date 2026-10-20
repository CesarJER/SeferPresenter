import { afterEach, expect, it, vi } from 'vitest';
import { loadCatalog, saveCatalog } from '../src/utils/catalogApi';
import type { CatalogConflict } from '../src/utils/catalogMerge';
const a = {id:'sal2',title:'Sal 2'}, b = {id:'sal6',title:'Sal 6'};
const options = {validate:(value:unknown)=>({ok:Array.isArray(value) && value.every(v=>v && typeof v.id==='string'),errors:[]})};
const response = (data:unknown, etag='"base"', status=200) => new Response(JSON.stringify(data),{status,headers:{ETag:etag}});
afterEach(()=>vi.unstubAllGlobals());
it('merges different records, saves with the fresh revision and returns all persisted records', async()=>{
 const fetch = vi.fn().mockResolvedValueOnce(response([a,b])).mockResolvedValueOnce(response({},'',412))
  .mockResolvedValueOnce(response([a,{...b,title:'Remote'}],'"fresh"')).mockResolvedValueOnce(response({},'"saved"'));
 vi.stubGlobal('fetch',fetch);
 const base=await loadCatalog<typeof a>('/catalog');
 const saved=await saveCatalog('/catalog',[{...a,title:'Local'},b],base,options);
 expect(saved).toEqual([{...a,title:'Local'},{...b,title:'Remote'}]);
 expect(fetch.mock.calls[3][1].headers['If-Match']).toBe('"fresh"');
 fetch.mockResolvedValueOnce(response({},'"next"'));
 await saveCatalog('/catalog',saved,saved,options);
 expect(fetch.mock.calls[4][1].headers['If-Match']).toBe('"saved"');
});
it('keeps an immutable editing base and waits for an explicit same-record decision',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(response([a])).mockResolvedValueOnce(response({},'',412))
  .mockResolvedValueOnce(response([{...a,title:'Remote'}],'"fresh"')).mockResolvedValueOnce(response({},'"saved"'));
 vi.stubGlobal('fetch',fetch);const base=await loadCatalog<typeof a>('/catalog');base[0].title='Local';
 let inspected:CatalogConflict[]=[];
 const saved=await saveCatalog('/catalog',base,base,{...options,resolve:async conflicts=>{inspected=conflicts;expect(fetch).toHaveBeenCalledTimes(3);return {'item:sal2':'remote'};}});
 expect(inspected[0].base).toEqual(a);expect(saved[0].title).toBe('Remote');
});
it('reviews again if the server changes the same record while the choice is open',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(response([a])).mockResolvedValueOnce(response({},'',412))
  .mockResolvedValueOnce(response([{...a,title:'Remote 1'}],'"r1"')).mockResolvedValueOnce(response({},'',412))
  .mockResolvedValueOnce(response([{...a,title:'Remote 2'}],'"r2"')).mockResolvedValueOnce(response({},'"saved"'));
 vi.stubGlobal('fetch',fetch);const base=await loadCatalog<typeof a>('/catalog');
 const resolve=vi.fn().mockResolvedValue({'item:sal2':'local'});
 await saveCatalog('/catalog',[{...a,title:'Local'}],base,{...options,resolve});
 expect(resolve).toHaveBeenCalledTimes(2);expect(resolve.mock.calls[1][0][0].remote.title).toBe('Remote 2');
 expect(fetch.mock.calls[5][1].headers['If-Match']).toBe('"r2"');
});
it.each(['cancel','invalid','network'])('preserves the draft and never overwrites after %s',async mode=>{
 const fetch=vi.fn().mockResolvedValueOnce(response([a])).mockResolvedValueOnce(response({},'',412));
 if(mode==='network')fetch.mockRejectedValueOnce(new Error('offline'));
 else fetch.mockResolvedValueOnce(response(mode==='invalid'?[null]:[{...a,title:'Remote'}],'"fresh"'));
 vi.stubGlobal('fetch',fetch);const base=await loadCatalog<typeof a>('/catalog');const draft=[{...a,title:'Local'}];
 await expect(saveCatalog('/catalog',draft,base,{...options,resolve:async()=>null})).rejects.toThrow();
 expect(draft[0].title).toBe('Local');expect(fetch.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
});
it('stops after three failed writes without asking for a choice that cannot be saved',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(response([a])).mockResolvedValueOnce(response({},'',412))
  .mockResolvedValueOnce(response([{...a,title:'Remote 1'}],'"r1"')).mockResolvedValueOnce(response({},'',412))
  .mockResolvedValueOnce(response([{...a,title:'Remote 2'}],'"r2"')).mockResolvedValueOnce(response({},'',412));
 vi.stubGlobal('fetch',fetch);const base=await loadCatalog<typeof a>('/catalog');const resolve=vi.fn().mockResolvedValue({'item:sal2':'local'});
 await expect(saveCatalog('/catalog',[{...a,title:'Local'}],base,{...options,resolve})).rejects.toThrow('volvió a cambiar');
 expect(resolve).toHaveBeenCalledTimes(2);expect(fetch.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(3);
});
it('does not write after the editor is closed during conflict review',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(response([a])).mockResolvedValueOnce(response({},'',412))
  .mockResolvedValueOnce(response([{...a,title:'Remote'}],'"fresh"'));
 vi.stubGlobal('fetch',fetch);const base=await loadCatalog<typeof a>('/catalog');const controller=new AbortController();
 await expect(saveCatalog('/catalog',[{...a,title:'Local'}],base,{...options,signal:controller.signal,resolve:async()=>{controller.abort();return {'item:sal2':'local'};}})).rejects.toThrow();
 expect(fetch.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
});
