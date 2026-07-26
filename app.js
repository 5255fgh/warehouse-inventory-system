(function loadInventoryScripts(){
  const scripts=['app-core.js','app-actions.js'];
  const load=index=>{
    if(index>=scripts.length)return;
    const script=document.createElement('script');
    script.src=scripts[index];
    script.onload=()=>load(index+1);
    script.onerror=()=>console.error('脚本加载失败：'+scripts[index]);
    document.body.appendChild(script);
  };
  load(0);
})();
