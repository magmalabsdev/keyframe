import puppeteer from 'puppeteer-core';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const p=await b.newPage(); await p.setViewport({width:1680,height:1050});
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>m.type()==='error'&&errs.push(m.text())); p.on('dialog',d=>d.accept());
const out=[]; const ok=(n,c)=>out.push((c?'PASS':'FAIL')+' '+n);
await p.goto('http://localhost:5174/',{waitUntil:'networkidle2'}); await new Promise(r=>setTimeout(r,800));
const reset=async()=>{await p.evaluate(()=>{const kf=window.__kf; kf.doc.getState().removeObjects(kf.getActiveScene().objects.filter(o=>!o.parentId).map(o=>o.id));});};
const imp=async(...f)=>{await (await p.$('input[accept*="stl"]')).uploadFile(...f); await new Promise(r=>setTimeout(r,1400));};
const run=async(name,fn)=>{try{ok(name,await fn());}catch(e){out.push('ERR '+name+': '+e.message);}};

await reset(); await imp('/tmp/box.stl');

// 1 Animations
await run('1 idle rotate + fade',async()=>p.evaluate(()=>{
  const kf=window.__kf; const id=kf.firstObjectId();
  kf.doc.getState().setObjectIdle(id,{type:'rotate',speed:1,axis:'z'});
  kf.doc.getState().setObjectTransition(id,'start',{type:'fade',durationMs:1000});
  const o=kf.getActiveScene().objects[0];
  const r1=kf.poseObjectAtTime(o,1000).rotation[2];
  const op0=kf.poseObjectAtTime(o,0).opacityMul, op5=kf.poseObjectAtTime(o,500).opacityMul;
  return Math.abs(r1-90)<2 && op0<0.05 && Math.abs(op5-0.5)<0.1;
}));

// 2 Place on face
await reset(); await imp('/tmp/box.stl');
await run('2 place-on-face rests on plate (minZ~0)',async()=>p.evaluate(async()=>{
  const kf=window.__kf; const id=kf.firstObjectId();
  kf.doc.getState().setObjectTransform(id,{position:[0,0,200],rotation:[35,20,0],scale:[1,1,1]});
  await new Promise(r=>setTimeout(r,120));
  const r=kf.getR3F(); r.scene.updateMatrixWorld(true);
  const node=r.scene.getObjectByName(id); const m=r.scene.getObjectByName(id+'__mesh');
  const pos=m.geometry.getAttribute('position');
  const ux=pos.getX(1)-pos.getX(0),uy=pos.getY(1)-pos.getY(0),uz=pos.getZ(1)-pos.getZ(0);
  const vx=pos.getX(2)-pos.getX(0),vy=pos.getY(2)-pos.getY(0),vz=pos.getZ(2)-pos.getZ(0);
  const normal=node.up.clone().set(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx).normalize();
  kf.placeObjectFaceDown(id, node, normal);
  await new Promise(r=>setTimeout(r,150)); r.scene.updateMatrixWorld(true);
  m.updateMatrixWorld(true); const e=m.matrixWorld.elements; let minZ=1e9;
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);const wz=e[2]*x+e[6]*y+e[10]*z+e[14];if(wz<minZ)minZ=wz;}
  return Math.abs(minZ)<1.5;
}));

// 3 Center of rotation (offset pivot, rotate, geometry orbits origin)
await reset(); await imp('/tmp/box.stl');
await run('3 center-of-rotation pivots geometry about origin',async()=>p.evaluate(async()=>{
  const kf=window.__kf; const id=kf.firstObjectId();
  kf.doc.getState().setObjectCenterOfRotation(id,[100,0,0]);
  kf.doc.getState().setObjectTransform(id,{position:[0,0,0],rotation:[0,0,90],scale:[1,1,1]});
  await new Promise(r=>setTimeout(r,150));
  const r=kf.getR3F(); r.scene.updateMatrixWorld(true);
  const m=r.scene.getObjectByName(id+'__mesh'); const e=m.matrixWorld.elements;
  // geometry origin world (cor rotated about object origin) ~ [0,100,0]
  return Math.abs(e[12])<2 && Math.abs(e[13]-100)<2 && Math.abs(e[14])<2;
}));

// 4 Multi-scene
await run('4 add + duplicate scene (+2)',async()=>p.evaluate(()=>{
  const kf=window.__kf; const before=kf.doc.getState().project.scenes.length;
  kf.doc.getState().addScene(); kf.doc.getState().duplicateScene();
  return kf.doc.getState().project.scenes.length===before+2;
}));

// 5 Snapping
await p.evaluate(()=>{const kf=window.__kf; const s=kf.doc.getState(); s.setActiveScene(kf.doc.getState().project.scenes[0].id);});
await reset(); await imp('/tmp/box.stl','/tmp/box.stl');
await run('5 snapping aligns faces (A.x->100)',async()=>p.evaluate(async()=>{
  const kf=window.__kf; const objs=kf.getActiveScene().objects.filter(o=>!o.parentId); const a=objs[0].id,c=objs[1].id;
  kf.doc.getState().setObjectTransform(c,{position:[400,0,0],rotation:[0,0,0],scale:[1,1,1]});
  kf.doc.getState().setObjectTransform(a,{position:[97,0,0],rotation:[0,0,0],scale:[1,1,1]});
  await new Promise(r=>setTimeout(r,150)); const r=kf.getR3F(); r.scene.updateMatrixWorld(true);
  const node=r.scene.getObjectByName(a); kf.editor.getState().setSnapEnabled(true);
  kf.trySnap(a,node,r.scene,kf.getActiveScene().objects);
  return Math.abs(node.position.x-100)<1.5;
}));

// 6 Marquee select (dispatch pointer events over the viewport)
await run('6 marquee selects 2 objects',async()=>p.evaluate(async()=>{
  const kf=window.__kf; kf.editor.getState().clearSelection();
  const objs=kf.getActiveScene().objects.filter(o=>!o.parentId);
  kf.doc.getState().setObjectTransform(objs[0].id,{position:[-200,0,0],rotation:[0,0,0],scale:[1,1,1]});
  kf.doc.getState().setObjectTransform(objs[1].id,{position:[200,0,0],rotation:[0,0,0],scale:[1,1,1]});
  await new Promise(r=>setTimeout(r,150));
  const view=document.querySelector('canvas').parentElement;
  view.dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX:300,clientY:120,bubbles:true}));
  window.dispatchEvent(new PointerEvent('pointermove',{clientX:1300,clientY:760,bubbles:true}));
  window.dispatchEvent(new PointerEvent('pointermove',{clientX:1300,clientY:770,bubbles:true}));
  window.dispatchEvent(new PointerEvent('pointerup',{clientX:1300,clientY:770,bubbles:true}));
  await new Promise(r=>setTimeout(r,150));
  return kf.editor.getState().selectedIds.length===2;
}));

// 8 Lifetime remap
await run('8 lifetime scale remap (0,1000->0,2000)',async()=>p.evaluate(()=>{
  const kf=window.__kf; const id=kf.getActiveScene().objects.filter(o=>!o.parentId)[0].id;
  kf.editor.getState().setPlayhead(0); kf.addKeyframeAtPlayhead(id);
  kf.editor.getState().setPlayhead(1000); kf.applyTransformEdit(id,{position:[50,0,0],rotation:[0,0,0],scale:[1,1,1]});
  kf.doc.getState().remapKeyframeTimes(id,{startMs:0,endMs:1000},{startMs:0,endMs:2000},'scale');
  const t=kf.getActiveScene().objects.find(o=>o.id===id).keyframes.map(k=>Math.round(k.timeMs));
  return t.includes(0)&&t.includes(2000);
}));

await b.close();
out.forEach(l=>console.log(l));
console.log(errs.length?('ERRORS: '+errs.slice(0,3).join(' | ')):'no errors');
