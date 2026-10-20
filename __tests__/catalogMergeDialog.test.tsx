// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CatalogMergeDialog } from '../src/components/shared/CatalogMergeDialog';
beforeEach(() => {
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(){this.setAttribute('open','');}});
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(){this.removeAttribute('open');}});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const conflicts=[{key:'item:p',label:'Sal 2',base:{id:'p',title:'Antes'},local:{id:'p',title:'Mío'},remote:{id:'p',title:'Servidor'}}];
it('shows base, local and server differences and requires an explicit choice',()=>{
 const resolve=vi.fn();render(<CatalogMergeDialog conflicts={conflicts} onResolve={resolve}/>);
 const dialog=screen.getByRole('dialog',{name:'Revisar cambios antes de guardar'});
 for(const text of ['Antes','Mío','Servidor'])expect(within(dialog).getByText(text)).toBeTruthy();
 const save=screen.getByRole('button',{name:'Combinar y guardar'}) as HTMLButtonElement;expect(save.disabled).toBe(true);
 fireEvent.click(screen.getByRole('radio',{name:'Conservar la del servidor'}));expect(save.disabled).toBe(false);
 fireEvent.click(save);expect(resolve).toHaveBeenCalledWith({'item:p':'remote'});
});
it('cancels without selecting or saving a version',()=>{
 const resolve=vi.fn();render(<CatalogMergeDialog conflicts={conflicts} onResolve={resolve}/>);
 fireEvent.click(screen.getByRole('button',{name:'Cancelar y seguir editando'}));expect(resolve).toHaveBeenCalledWith(null);
});
it('shows changed slide text directly and omits unchanged slides from the comparison',()=>{
 const unchanged={id:'same',label:'Misma',lines:['Texto sin cambios']};
 const base={id:'p',slides:[{id:'changed',label:'Título',lines:['Antes']},unchanged]};
 render(<CatalogMergeDialog conflicts={[{key:'item:p',label:'Sal 2',base,local:{...base,slides:[{...base.slides[0],lines:['Mío']},unchanged]},remote:{...base,slides:[{...base.slides[0],lines:['Servidor']},unchanged]}}]} onResolve={()=>{}}/>);
 for(const text of ['Antes','Mío','Servidor'])expect(screen.getByText(text)).toBeTruthy();
 expect(screen.queryByText('Texto sin cambios')).toBeNull();
});
