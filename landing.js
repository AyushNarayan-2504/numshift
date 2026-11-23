/* Client-side navigation; editor state remains in memory while moving between views. */
(() => {
  const landing=document.getElementById('landing'),tools=document.getElementById('toolsPage'),app=document.getElementById('editorApp'),workspaceMenu=document.getElementById('workspaceNavigation');
  function route(){
    const hash=decodeURIComponent(location.hash.slice(1));
    if(hash==='editor'||hash.startsWith('editor/')){
      const mode=hash.split('/')[1];const selected=['standard','beast','ultra'].includes(mode)?mode:'standard';
      landing.hidden=true;tools.hidden=true;app.hidden=false;setMode(selected);window.scrollTo(0,0);
    }else if(hash==='tools'){
      app.hidden=true;landing.hidden=true;tools.hidden=false;document.body.classList.remove('beast-active','ultra-active');window.scrollTo(0,0);
    }else{
      app.hidden=true;tools.hidden=true;landing.hidden=false;document.body.classList.remove('beast-active','ultra-active');
      if(hash&&hash!=='home')requestAnimationFrame(()=>document.getElementById(hash)?.scrollIntoView());else window.scrollTo(0,0);
    }
    document.querySelectorAll('details.nav-menu').forEach(x=>x.open=false);workspaceMenu.open=false;
  }
  for(const [id,name] of [['standardMode','standard'],['beastMode','beast'],['ultraMode','ultra']])document.getElementById(id).addEventListener('click',()=>{history.replaceState(null,'','#editor/'+name);workspaceMenu.open=false});
  document.addEventListener('click',event=>{for(const menu of document.querySelectorAll('details.nav-menu,details.workspace-navigation'))if(menu.open&&!menu.contains(event.target))menu.open=false});
  window.addEventListener('hashchange',route);route();
})();
