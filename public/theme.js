(()=>{
 let preference='auto',previewTheme=null;
 try{preference=localStorage.getItem('raven-pos-theme')||localStorage.getItem('reven-appearance')||'auto';}catch{}
 if(!['auto','light','dark'].includes(preference))preference='auto';
 const media=matchMedia('(prefers-color-scheme: dark)');
 function apply(){const root=document.documentElement;root.dataset.theme=previewTheme||(preference==='auto'?(media.matches?'dark':'light'):preference);root.dataset.appearance=previewTheme||preference;root.style.colorScheme=root.dataset.theme;document.querySelectorAll('#theme,#login-theme').forEach(select=>select.value=root.dataset.appearance);}
 apply();media.addEventListener('change',apply);
 window.ravenTheme=value=>{if(!['auto','light','dark'].includes(value))return;preference=value;previewTheme=null;try{localStorage.setItem('raven-pos-theme',value);}catch{}apply();};
 window.ravenApplyTheme=value=>{if(!['light','dark'].includes(value))return;previewTheme=value;apply();};
})();
