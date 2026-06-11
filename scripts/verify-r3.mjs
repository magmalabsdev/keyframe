import puppeteer from 'puppeteer-core';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const p=await b.newPage(); await p.setViewport({width:1680,height:1050});
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>m.type()==='error'&&errs.push(m.text())); p.on('dialog',d=>d.accept());
const ok=(n,c)=>console.log((c?'PASS':'FAIL')+' '+n);
await p.goto('http://localhost:5174/',{waitUntil:'networkidle2'}); await new Promise(r=>setTimeout(r,800));
await p.evaluate(()=>{const kf=window.__kf; kf.doc.getState().removeObjects(kf.getActiveScene().objects.filter(o=>!o.parentId).map(o=>o.id));});

// A: brep-face colors
await (await p.$('input[accept*="stl"]')).uploadFile('/tmp/cube-faces.step');
await new Promise(r=>setTimeout(r,8000));
const colA=await p.evaluate(()=>window.__kf.getActiveScene().objects.map(o=>o.material.color));
console.log('A STEP brep color(s):',JSON.stringify(colA));
ok('A: STEP face color not gray', colA.length>0 && !colA.every(c=>/^#9|^#6|^#8|^#a|^#b/.test(c)) && colA.some(c=>c!=='#b8c0cc'));

// reset
await p.evaluate(()=>{const kf=window.__kf; kf.doc.getState().removeObjects(kf.getActiveScene().objects.filter(o=>!o.parentId).map(o=>o.id));});
await (await p.$('input[accept*="stl"]')).uploadFile('/tmp/box.stl','/tmp/house.obj');
await new Promise(r=>setTimeout(r,1800));

// F: group then ungroup
const fr=await p.evaluate(async()=>{
  const kf=window.__kf; const roots=kf.getActiveScene().objects.filter(o=>!o.parentId);
  const ids=roots.map(o=>o.id);
  const before=roots.map(o=>({id:o.id,pos:o.transform.position.slice()}));
  kf.editor.getState().setSelection(ids);
  kf.groupSelection();
  await new Promise(r=>setTimeout(r,200));
  let s=kf.getActiveScene(); const groups=s.objects.filter(o=>o.type==='group');
  const grp=groups[0];
  const kids=s.objects.filter(o=>o.parentId===grp.id);
  // move group +100 x and check a child's world via three
  const r=kf.getR3F(); r.scene.updateMatrixWorld(true);
  kf.doc.getState().setObjectTransform(grp.id,{position:[grp.transform.position[0]+100,grp.transform.position[1],grp.transform.position[2]],rotation:[0,0,0],scale:[1,1,1]});
  await new Promise(rr=>setTimeout(rr,150)); r.scene.updateMatrixWorld(true);
  const childWorldAfter = (()=>{const m=r.scene.getObjectByName(kids[0].id); return m?[m.matrixWorld.elements[12],m.matrixWorld.elements[13],m.matrixWorld.elements[14]]:null;})();
  // ungroup
  kf.editor.getState().setSelection([grp.id]); kf.ungroupSelection();
  await new Promise(rr=>setTimeout(rr,200));
  s=kf.getActiveScene();
  const afterGroups=s.objects.filter(o=>o.type==='group').length;
  const afterRoots=s.objects.filter(o=>!o.parentId);
  return {groupCount:groups.length, kids:kids.length, childWorldAfter, afterGroups, afterRootCount:afterRoots.length, rootPosAfter:afterRoots.map(o=>o.transform.position.map(Math.round))};
});
console.log('F:',JSON.stringify(fr));
ok('F: group created with 2 children', fr.groupCount===1 && fr.kids===2);
ok('F: moving group moves child world (x≈+100)', fr.childWorldAfter && Math.abs(fr.childWorldAfter[0])>50);
ok('F: ungroup removes group, restores 2 roots', fr.afterGroups===0 && fr.afterRootCount===2);
ok('F: child x baked ≈100 after ungroup', fr.rootPosAfter.some(p=>Math.abs(p[0])>=80));

// D: zoom in past old limit
const dz=await p.evaluate(async()=>{
  const kf=window.__kf; const c=kf.getR3F(); // controls not exposed; use cameraState distance
  const before=kf.getCameraState();
  // dispatch wheel events on canvas to dolly in
  const cv=document.querySelector('canvas');
  for(let i=0;i<40;i++){ cv.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,clientX:840,clientY:500})); }
  await new Promise(r=>setTimeout(r,300));
  const after=kf.getCameraState();
  const dist=v=>Math.hypot(v.position[0]-v.target[0],v.position[1]-v.target[1],v.position[2]-v.target[2]);
  return {before:dist(before), after:dist(after)};
});
console.log('D zoom dist before/after:',dz.before.toFixed(1),dz.after.toFixed(1));
ok('D: zoomed in (distance decreased)', dz.after < dz.before);

await b.close();
console.log(errs.length?('ERRORS: '+errs.join(' | ')):'no errors');
