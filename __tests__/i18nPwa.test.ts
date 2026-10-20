import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

it('serves a previously fetched locale asset offline and never caches public configuration', async()=>{
  const handlers=new Map<string,(event: unknown)=>void>();
  const stored=new Map<string,Response>();
  const cache={
    match:async(request:Request)=>stored.get(request.url)?.clone(),
    put:async(request:Request,response:Response)=>{stored.set(request.url,response.clone());},
  };
  const fetch=vi.fn().mockResolvedValue(new Response('export default {language:"Français"}',{headers:{'content-type':'text/javascript'}}));
  const self={location:{origin:'https://example.test'},addEventListener:(name:string,handler:(event:unknown)=>void)=>handlers.set(name,handler)};
  vm.runInNewContext(readFileSync('static/audience-sw.js','utf8'),{self,URL,Set,caches:{open:async()=>cache},fetch});
  const request=new Request('https://example.test/assets/common-fr-hash.js');
  let result:Promise<Response>|undefined;
  const event={request,respondWith:(response:Promise<Response>)=>{result=response;}};
  handlers.get('fetch')!(event);
  expect(await (await result!).text()).toContain('Français');
  fetch.mockRejectedValue(new TypeError('offline'));
  handlers.get('fetch')!(event);
  expect(await (await result!).text()).toContain('Français');
  const respondWith=vi.fn();
  handlers.get('fetch')!({request:new Request('https://example.test/api/public-config'),respondWith});
  expect(respondWith).not.toHaveBeenCalled();
  let uncached:Promise<Response>|undefined;
  handlers.get('fetch')!({request:new Request('https://example.test/assets/common-he-uncached.js'),respondWith:(value:Promise<Response>)=>{uncached=value;}});
  await expect(uncached).rejects.toThrow('offline');
});
