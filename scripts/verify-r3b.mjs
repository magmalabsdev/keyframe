import puppeteer from 'puppeteer-core';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const p=await b.newPage(); await p.setViewport({width:1680,height:1050});
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
const ok=(n,c)=>console.log((c?'PASS':'FAIL')+' '+n);
await p.goto('http://localhost:5174/',{waitUntil:'networkidle2'}); await new Promise(r=>setTimeout(r,800));
await p.evaluate(()=>{const kf=window.__kf; kf.doc.getState().removeObjects(kf.getActiveScene().objects.filter(o=>!o.parentId).map(o=>o.id));});
await (await p.$('input[accept*="stl"]')).uploadFile('/tmp/box.stl');
await new Promise(r=>setTimeout(r,1500));

// B: render preview hides build plate + plays once
await p.evaluate(()=>window.__kf.doc.getState().setSceneDuration(900));
await p.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('Render'))?.click();});
await new Promise(r=>setTimeout(r,200));
const mid=await p.evaluate(()=>{const e=window.__kf.editor.getState(); const r=window.__kf.getR3F(); let plateVisible=true; r.scene.traverse(o=>{if(o.userData&&o.userData.excludeFromRender) plateVisible=o.visible;}); return {renderPreview:e.renderPreview, playing:e.playing, plateVisible};});
console.log('B mid-render:',JSON.stringify(mid));
await p.screenshot({path:'/tmp/r3-render.png'});
await new Promise(r=>setTimeout(r,1200));
const end=await p.evaluate(()=>{const e=window.__kf.editor.getState(); return {renderPreview:e.renderPreview, playing:e.playing};});
console.log('B end:',JSON.stringify(end));
ok('B: render hides build plate', mid.plateVisible===false);
ok('B: render preview active during play', mid.renderPreview===true && mid.playing===true);
ok('B: stops at end (no loop) + exits preview', end.playing===false && end.renderPreview===false);

// C: camera keyframe jump
await p.evaluate(()=>window.__kf.doc.getState().setSceneDuration(5000));
const c=await p.evaluate(async()=>{
  const kf=window.__kf;
  [...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='Top')?.click();
  await new Promise(r=>setTimeout(r,400));
  kf.editor.getState().setPlayhead(0);
  const topState=kf.getCameraState();
  kf.doc.getState().upsertCameraKeyframe(0, topState);
  [...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='Front')?.click();
  await new Promise(r=>setTimeout(r,400));
  kf.editor.getState().setPlayhead(1000);
  kf.doc.getState().upsertCameraKeyframe(1000, kf.getCameraState());
  // now click the FIRST camera keyframe marker (title^="Camera keyframe")
  const marker=document.querySelector('button[title^="Camera keyframe"]');
  marker && marker.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0}));
  await new Promise(r=>setTimeout(r,500));
  const now=kf.getCameraState();
  return {topPos:topState.position.map(Math.round), nowPos:now.position.map(Math.round), playhead:kf.editor.getState().playheadMs};
});
console.log('C:',JSON.stringify(c));
const close=(a,bb)=>Math.hypot(a[0]-bb[0],a[1]-bb[1],a[2]-bb[2])<50;
ok('C: clicking camera kf jumps playhead to 0', c.playhead===0);
ok('C: clicking camera kf moves camera to top view', close(c.nowPos,c.topPos));

// E: multi-select MIXED inspector
await p.evaluate(()=>{const kf=window.__kf; const objs=kf.getActiveScene().objects.filter(o=>!o.parentId); kf.doc.getState().setObjectMaterial(objs[0].id,{color:'#ff0000'});});
await (await p.$('input[accept*="stl"]')).uploadFile('/tmp/house.obj');
await new Promise(r=>setTimeout(r,1500));
await p.evaluate(()=>{const kf=window.__kf; const objs=kf.getActiveScene().objects.filter(o=>!o.parentId); kf.doc.getState().setObjectMaterial(objs[1].id,{color:'#22c55e'}); kf.editor.getState().setSelection(objs.map(o=>o.id));});
await new Promise(r=>setTimeout(r,400));
await p.screenshot({path:'/tmp/r3-mixed.png',clip:{x:1368,y:46,width:312,height:600}});
const mixedTxt=await p.evaluate(()=>document.body.innerText.includes('MIXED'));
ok('E: inspector shows MIXED for differing colors', mixedTxt);
// set color on all → both update
await p.evaluate(()=>{const kf=window.__kf; const ids=kf.editor.getState().selectedIds; kf.doc.getState().setObjectsMaterial(ids,{color:'#4c8bf5'});});
const allBlue=await p.evaluate(()=>{const objs=window.__kf.getActiveScene().objects.filter(o=>!o.parentId); return objs.every(o=>o.material.color==='#4c8bf5');});
ok('E: editing color applies to all selected', allBlue);

await b.close();
console.log(errs.length?('ERRORS: '+errs.join(' | ')):'no errors');
