// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AudioSyncEditor } from '../src/components/AudioSyncEditor';
import { remapSyncTimes } from '../src/hooks/useSyncPresentationReview';
import type { Presentation } from '../src/types/presentation';
import type { AudioSyncMap } from '../src/types/audio';
const original:Presentation={id:'p',title:'Sal 2',mode:'standard',background:'',slides:[{id:'s1',label:'Uno',lines:['Primera']},{id:'s2',label:'Dos',lines:['Segunda']}]};
const maps:AudioSyncMap[]=[{id:'m',name:'Map',presentationId:'p',audioSrc:'/test.mp3',cues:[{slideIndex:0,timeSec:1},{slideIndex:1,timeSec:2}],defaultSyncMode:'unilateral',defaultVolume:0.7}];
let remote:Presentation[];
const save=vi.fn();
beforeEach(()=>{
 remote=[original];save.mockReset().mockResolvedValue(undefined);
 vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
 vi.stubGlobal('alert',vi.fn());
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(remote),{headers:{ETag:'"source"'}})));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
const open=()=>render(<AudioSyncEditor isOpen onClose={()=>{}} presentations={[original]} activePresentationId="p" activeAudioSrc="/test.mp3" availableAudioFiles={['/test.mp3']} audioSyncMaps={maps} onAudioSyncMapsChange={save}/>);
it('freezes the old rows, reviews reordered slides and preserves time marks by slide ID',async()=>{
 open();await waitFor(()=>expect((screen.getAllByRole('textbox')[0]as HTMLInputElement).value).toBe('1'));
 fireEvent.change(screen.getAllByRole('textbox')[0],{target:{value:'7.5'}});
 remote=[{...original,slides:[original.slides[1],{...original.slides[0],lines:['Primera revisada']}]}];
 fireEvent(window,new Event('focus'));
 await screen.findByText('La presentación ha cambiado');
 expect((screen.getAllByRole('textbox')[0]as HTMLInputElement).value).toBe('7.5');
 expect((screen.getByRole('button',{name:'GUARDAR CONFIGURACIÓN'})as HTMLButtonElement).disabled).toBe(true);
 expect(save).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Actualizar diapositivas y revisar marcas'}));
 await waitFor(()=>expect((screen.getAllByRole('textbox')[0]as HTMLInputElement).value).toBe('2'));
 expect((screen.getAllByRole('textbox')[1]as HTMLInputElement).value).toBe('7.5');
 fireEvent.click(screen.getByRole('button',{name:'GUARDAR CONFIGURACIÓN'}));
 await waitFor(()=>expect(save).toHaveBeenCalled());
 expect(save.mock.calls[0][0][0].cues).toEqual([{slideIndex:0,timeSec:2},{slideIndex:1,timeSec:7.5}]);
});
it('checks the source again at save time and blocks a newly changed or deleted presentation',async()=>{
 open();await screen.findByText('Primera');
 remote=[];
 fireEvent.click(screen.getByRole('button',{name:'GUARDAR CONFIGURACIÓN'}));
 await screen.findByText('La presentación ha cambiado');
 expect(save).not.toHaveBeenCalled();
 expect((screen.getAllByRole('textbox')[0]as HTMLInputElement).value).toBe('1');
});
it('remaps verse marks by stable slide ID, discards removed slides only on review and rejects ambiguous IDs',()=>{
 const next={...original,slides:[original.slides[1]]};
 expect(remapSyncTimes(original,next,{'slide-0':'1','slide-1-verse-3':'8'})).toEqual({'slide-0-verse-3':'8'});
 expect(()=>remapSyncTimes(original,{...original,slides:[original.slides[0],original.slides[0]]},{'slide-0':'1'})).toThrow('Ambiguous');
});
