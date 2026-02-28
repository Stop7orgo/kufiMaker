/* ═══════════════════════════════════════════════════
   kufiMaker — v8
   ✓ Blend mode FIXED (bgLayer is sibling of gc, not child)
   ✓ Gap H/V/Dot cells fully interactive like cells
   ✓ Smart corner radius (connected shapes look joined)
   ✓ Default: 24×24, cellSz=30, gap=15, rad=5
═══════════════════════════════════════════════════ */

/* ══════════ STATE ══════════ */
let cols=44, rows=44;
let grid=[], gapH=[], gapV=[], gapD=[];
let cellColors={}, gapHColors={}, gapVColors={}, gapDColors={};
let history=[], redoStack=[];
let tool='draw', drawColor='#F5A623';
let isDrawing=false, lastX=-1, lastY=-1;
let gapDrawing=false;
let bgImg=null, bgVisible=true, bgDragEnable=false;
let bgProps={x:0, y:0, w:0, h:0, opacity:0.5, blend:'normal', rotate:0};
let cellSz=30, gapSz=15, cellRad=5;
let axisEvery=5, showAxis=true, axisColor='#4848486c';
let zoom=1;
let panActive=false, panStart={};
let showRulers=false;
let blocks=[], blockCounter=0;

const gc  = document.getElementById('gridCanvas');
const bgL = document.getElementById('bgLayer');
const vp  = document.getElementById('canvasViewport');
const coordsBar = document.getElementById('coordsBar');
const rulerH = document.getElementById('rulerH');
const rulerV = document.getElementById('rulerV');
function $id(id){return document.getElementById(id);}

/* ══════════ INIT ══════════ */
function computeGridDimensions(){
  const vpW=vp.clientWidth||window.innerWidth-48;
  const vpH=vp.clientHeight||window.innerHeight-76;
  return{
    c:Math.max(5,Math.floor((vpW-40)/(cellSz+gapSz))),
    r:Math.max(5,Math.floor((vpH-40)/(cellSz+gapSz)))
  };
}

function initGrid(c,r){
  if(c==null){const d=computeGridDimensions();c=d.c;r=d.r;}
  document.querySelectorAll('.block-overlay').forEach(e=>e.remove());
  blocks=[];
  gc.innerHTML='';
  cols=c; rows=r;
  $id('gridCols').value=cols; $id('gridRows').value=rows;
  document.documentElement.style.setProperty('--cell-size',cellSz+'px');
  document.documentElement.style.setProperty('--gap',gapSz+'px');

  gc.style.cssText=`
    display:inline-grid;
    grid-template-columns:repeat(${cols},${cellSz}px);
    gap:${gapSz}px; padding:20px;
    position:relative; min-width:max-content;
    transform-origin:top left; transform:scale(${zoom});
  `;

  // Data arrays
  grid  = Array.from({length:r}, ()=>Array(c).fill(0));
  gapH  = Array.from({length:r-1}, ()=>Array(c).fill(0));   // between rows
  gapV  = Array.from({length:r},   ()=>Array(c-1).fill(0)); // between cols
  gapD  = Array.from({length:r-1}, ()=>Array(c-1).fill(0)); // corner dots
  cellColors={}; gapHColors={}; gapVColors={}; gapDColors={};

  // Cell elements
  for(let y=0;y<r;y++) for(let x=0;x<c;x++){
    const el=document.createElement('div');
    el.className='cell'; el.dataset.x=x; el.dataset.y=y;
    el.style.borderRadius=`${cellRad}px`;
    el.style.width=el.style.height=`${cellSz}px`;
    gc.appendChild(el);
  }

  drawAxisLines();
  renderGapElements();
  updateStatus();
  $id('statusGrid').textContent=`${cols}×${rows}`;
  // Scroll to right edge (RTL start)
  requestAnimationFrame(()=>{ vp.scrollLeft = vp.scrollWidth; });
}

let resizeTimer=null;
window.addEventListener('resize',()=>{
  clearTimeout(resizeTimer);
  resizeTimer=setTimeout(()=>{if(!grid.flat().some(v=>v))initGrid();},300);
});
// Fix landscape scroll: force viewport reflow on orientation change
window.addEventListener('orientationchange',()=>{
  setTimeout(()=>{
    // Force viewport to recalculate its scroll dimensions
    vp.style.display='none';
    vp.offsetHeight; // trigger reflow
    vp.style.display='';
  }, 300);
});

function cellEl(x,y){return gc.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`)||null;}

/* ══════════════════════════════════════════════
   SMART RADIUS — final correct model
   
   Grid layout (T = cellSz+gapSz):
     cell(x,y) │ gapV(x,y) │ cell(x+1,y)
     ──────────┼───────────┼────────────
     gapH(x,y) │ gapD(x,y) │ gapH(x+1,y)
     ──────────┼────────────┼───────────
     cell(x,y+1)│gapV(x,y+1)│cell(x+1,y+1)

   RULE: A corner of any element is SQUARE when the corner "slot" of the
   diagonal neighbour (gapD) is filled, OR when BOTH arms extending from
   that corner in the two orthogonal directions are occupied.

   For cell(x,y) BR corner:
     Square if:  gapD(x,y) filled
              OR (right-arm: gapV(x,y) or cell(x+1,y)) AND (below-arm: gapH(x,y) or cell(x,y+1))
              OR right-arm filled alone  [shares full right edge]
              OR below-arm filled alone  [shares full bottom edge]

   Wait — simpler: corner is square if EITHER arm is filled (since sharing an edge
   means the corner point is shared). So:
     BR square if: (gapV(x,y) or cell(x+1,y)) OR (gapH(x,y) or cell(x,y+1)) OR gapD(x,y)

   This is correct. The look-through-diagonal extra conditions I had before
   were for cases like: gapV to right is filled AND gapH below-right is filled.
   But gapH(x+1,y) is not adjacent to cell(x,y) at all — it's too far.
   So the extra conditions were WRONG and were causing phantom squaring.

   FINAL SIMPLE CORRECT FORMULA:
   cell(x,y) corner is square iff any element that DIRECTLY SHARES THAT CORNER POINT is filled.
   
   Directly shares corner point means: shares an edge (→ all edge corners) or corner only.
   
   cell BR shares its BR corner with:
     - gapV(x,y)   [shares right edge → shares BR point]
     - cell(x+1,y) [separated by gapV → does NOT directly share corner]
     - gapH(x,y)   [shares bottom edge → shares BR point]  
     - cell(x,y+1) [separated by gapH → does NOT directly share corner]
     - gapD(x,y)   [shares only the corner point diagonally]

   Wait, but if there's NO gapV between cell(x,y) and cell(x+1,y), they ARE adjacent?
   NO — in our grid there is ALWAYS a gapV slot between horizontally adjacent cells,
   and ALWAYS a gapH slot between vertically adjacent cells.
   The gap slots exist even when empty (value=0).

   So cell(x,y) NEVER directly touches cell(x+1,y) — there is always a gapV slot between them.
   cell(x,y) directly touches: gapV(x,y) on the right, gapH(x,y) below,
                                gapV(x-1,y) on the left, gapH(x,y-1) above,
                                gapD(x-1,y-1) at TL corner, gapD(x,y-1) at TR,
                                gapD(x-1,y) at BL, gapD(x,y) at BR.
   
   That's it. Cells never directly touch other cells.

   CORRECT FINAL FORMULAS:
══════════════════════════════════════════════ */
function isFC(x,y){return x>=0&&x<cols&&y>=0&&y<rows&&grid[y][x]===1;}
function isGH(gx,gy){return gy>=0&&gy<rows-1&&gx>=0&&gx<cols&&gapH[gy][gx]===1;}
function isGV(gx,gy){return gy>=0&&gy<rows&&gx>=0&&gx<cols-1&&gapV[gy][gx]===1;}
function isGD(gx,gy){return gy>=0&&gy<rows-1&&gx>=0&&gx<cols-1&&gapD[gy][gx]===1;}
function rc(b){return(b||cellRad===0)?0:cellRad;}

/* CELL(x,y): touches only its 4 gap-edge neighbours and 4 gapD corner neighbours */
function computeCellRadius(x,y){
  if(cellRad===0) return '0';
  const tl=rc(isGV(x-1,y)||isGH(x,y-1)||isGD(x-1,y-1));
  const tr=rc(isGV(x,  y)||isGH(x,y-1)||isGD(x,  y-1));
  const bl=rc(isGV(x-1,y)||isGH(x,y  )||isGD(x-1,y  ));
  const br=rc(isGV(x,  y)||isGH(x,y  )||isGD(x,  y  ));
  return `${tl}px ${tr}px ${br}px ${bl}px`;
}

/* GAPH(gx,gy): bar between row gy (above) and row gy+1 (below)
   Direct neighbours: cell(gx,gy)[above edge], cell(gx,gy+1)[below edge],
                      gapV(gx-1,gy)[left-top edge], gapV(gx-1,gy+1)[left-bottom edge],
                      gapV(gx,gy)[right-top edge],  gapV(gx,gy+1)[right-bottom edge],
                      gapD(gx-1,gy)[left corner], gapD(gx,gy)[right corner]
   TL corner: shared with cell(gx,gy)[above] and gapV(gx-1,gy)[left-top] and gapD(gx-1,gy)
   TR corner: shared with cell(gx,gy) and gapV(gx,gy) and gapD(gx,gy)
   BL corner: shared with cell(gx,gy+1) and gapV(gx-1,gy+1) and gapD(gx-1,gy)
   BR corner: shared with cell(gx,gy+1) and gapV(gx,gy+1) and gapD(gx,gy)
*/
function computeGHRadius(gx,gy){
  if(cellRad===0) return '0';
  const tl=rc(isFC(gx,gy)  ||isGV(gx-1,gy)  ||isGD(gx-1,gy));
  const tr=rc(isFC(gx,gy)  ||isGV(gx,  gy)  ||isGD(gx,  gy));
  const bl=rc(isFC(gx,gy+1)||isGV(gx-1,gy+1)||isGD(gx-1,gy));
  const br=rc(isFC(gx,gy+1)||isGV(gx,  gy+1)||isGD(gx,  gy));
  return `${tl}px ${tr}px ${br}px ${bl}px`;
}

/* GAPV(gx,gy): bar between col gx (left) and col gx+1 (right)
   TL corner: shared with cell(gx,gy)[left] and gapH(gx,gy-1)[top-left] and gapD(gx,gy-1)
   TR corner: shared with cell(gx+1,gy)[right] and gapH(gx+1,gy-1)[top-right] and gapD(gx,gy-1)
   BL corner: shared with cell(gx,gy)[left] and gapH(gx,gy)[bottom-left] and gapD(gx,gy)
   BR corner: shared with cell(gx+1,gy)[right] and gapH(gx+1,gy)[bottom-right] and gapD(gx,gy)
*/
function computeGVRadius(gx,gy){
  if(cellRad===0) return '0';
  const tl=rc(isFC(gx,  gy)||isGH(gx,  gy-1)||isGD(gx,gy-1));
  const tr=rc(isFC(gx+1,gy)||isGH(gx+1,gy-1)||isGD(gx,gy-1));
  const bl=rc(isFC(gx,  gy)||isGH(gx,  gy)  ||isGD(gx,gy));
  const br=rc(isFC(gx+1,gy)||isGH(gx+1,gy)  ||isGD(gx,gy));
  return `${tl}px ${tr}px ${br}px ${bl}px`;
}

/* GAPD(gx,gy): corner dot — directly touches 1 cell + 1 gapH + 1 gapV at each corner */
function computeGDRadius(gx,gy){
  if(cellRad===0) return '0';
  const maxR = Math.min(cellRad, Math.floor(gapSz/2));
  const r2 = (b)=>b?0:maxR;
  const tl=r2(isFC(gx,  gy)  ||isGH(gx,  gy)||isGV(gx,gy));
  const tr=r2(isFC(gx+1,gy)  ||isGH(gx+1,gy)||isGV(gx,gy));
  const bl=r2(isFC(gx,  gy+1)||isGH(gx,  gy)||isGV(gx,gy+1));
  const br=r2(isFC(gx+1,gy+1)||isGH(gx+1,gy)||isGV(gx,gy+1));
  return `${tl}px ${tr}px ${br}px ${bl}px`;
}

/* ══════════ RENDER ══════════ */
function renderGrid(){
  for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){
    const el=cellEl(x,y); if(!el) continue;
    const v=grid[y][x];
    el.style.background = v?(cellColors[`${x},${y}`]||drawColor):'';
    el.classList.toggle('filled',!!v);
    el.style.borderRadius = v?computeCellRadius(x,y):`${cellRad}px`;
  }
  renderGapElements();
  updateStatus();
}

function renderGapElements(){
  document.querySelectorAll('.gap-h,.gap-v,.gap-d').forEach(e=>e.remove());
  const total=cellSz+gapSz, pad=20;

  // Horizontal gaps (between rows gy and gy+1)
  for(let gy=0;gy<rows-1;gy++) for(let gx=0;gx<cols;gx++){
    const v=gapH[gy][gx];
    const el=document.createElement('div');
    el.className='gap-h'+(v?' filled':'');
    el.dataset.gtype='h'; el.dataset.gx=gx; el.dataset.gy=gy;
    const col=v?(gapHColors[`${gx},${gy}`]||drawColor):'rgba(255,255,255,0.05)';
    el.style.cssText=`position:absolute;left:${pad+gx*total}px;top:${pad+(gy+1)*total-gapSz}px;width:${cellSz}px;height:${gapSz}px;background:${col};z-index:4;pointer-events:auto;cursor:crosshair;border-radius:${v?computeGHRadius(gx,gy):'0'};`;
    gc.appendChild(el);
  }

  // Vertical gaps (between cols gx and gx+1)
  for(let gy=0;gy<rows;gy++) for(let gx=0;gx<cols-1;gx++){
    const v=gapV[gy][gx];
    const el=document.createElement('div');
    el.className='gap-v'+(v?' filled':'');
    el.dataset.gtype='v'; el.dataset.gx=gx; el.dataset.gy=gy;
    const col=v?(gapVColors[`${gx},${gy}`]||drawColor):'rgba(255,255,255,0.05)';
    el.style.cssText=`position:absolute;left:${pad+(gx+1)*total-gapSz}px;top:${pad+gy*total}px;width:${gapSz}px;height:${cellSz}px;background:${col};z-index:4;pointer-events:auto;cursor:crosshair;border-radius:${v?computeGVRadius(gx,gy):'0'};`;
    gc.appendChild(el);
  }

  // Corner dots at intersections
  for(let gy=0;gy<rows-1;gy++) for(let gx=0;gx<cols-1;gx++){
    const v=gapD[gy][gx];
    const el=document.createElement('div');
    el.className='gap-d'+(v?' filled':'');
    el.dataset.gtype='d'; el.dataset.gx=gx; el.dataset.gy=gy;
    const col=v?(gapDColors[`${gx},${gy}`]||drawColor):'rgba(255,255,255,0.03)';
    el.style.cssText=`position:absolute;left:${pad+(gx+1)*total-gapSz}px;top:${pad+(gy+1)*total-gapSz}px;width:${gapSz}px;height:${gapSz}px;background:${col};z-index:5;pointer-events:auto;cursor:crosshair;border-radius:${v?computeGDRadius(gx,gy):'0'};`;
    gc.appendChild(el);
  }
}

function refreshRadiusAround(x,y){
  for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
    const nx=x+dx,ny=y+dy;
    if(nx<0||nx>=cols||ny<0||ny>=rows) continue;
    const el=cellEl(nx,ny); if(!el) continue;
    el.style.borderRadius=grid[ny][nx]?computeCellRadius(nx,ny):`${cellRad}px`;
  }
}
function refreshAllRadius(){
  for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){
    const el=cellEl(x,y); if(!el) continue;
    el.style.borderRadius=grid[y][x]?computeCellRadius(x,y):`${cellRad}px`;
  }
}

/* ══════════ AXIS LINES ══════════ */
function drawAxisLines(){
  document.querySelectorAll('.axis-h,.axis-v').forEach(e=>e.remove());
  if(!showAxis) return;
  const total=cellSz+gapSz, pad=20;
  for(let x=axisEvery;x<cols;x+=axisEvery){
    const el=document.createElement('div'); el.className='axis-v';
    el.style.cssText=`left:${pad+x*total-1}px;top:${pad}px;width:1px;height:${rows*total}px;background:${axisColor};position:absolute;pointer-events:none;z-index:3;`;
    gc.appendChild(el);
  }
  for(let y=axisEvery;y<rows;y+=axisEvery){
    const el=document.createElement('div'); el.className='axis-h';
    el.style.cssText=`top:${pad+y*total-1}px;left:${pad}px;height:1px;width:${cols*total}px;background:${axisColor};position:absolute;pointer-events:none;z-index:3;`;
    gc.appendChild(el);
  }
}
function updateStatus(){$id('statusFilled').textContent=grid.flat().filter(v=>v).length;}

/* ══════════ UNDO/REDO ══════════ */
function snap(){
  return{
    g:grid.map(r=>[...r]),
    gH:gapH.map(r=>[...r]),
    gV:gapV.map(r=>[...r]),
    gD:gapD.map(r=>[...r]),
    cc:{...cellColors},ch:{...gapHColors},cv:{...gapVColors},cd:{...gapDColors}
  };
}
function applySnap(s){
  grid=s.g; gapH=s.gH; gapV=s.gV; gapD=s.gD;
  cellColors=s.cc; gapHColors=s.ch; gapVColors=s.cv; gapDColors=s.cd;
}
function saveState(){history.push(snap());if(history.length>60)history.shift();redoStack=[];}
function undo(){if(!history.length)return;redoStack.push(snap());applySnap(history.pop());renderGrid();}
function redo(){if(!redoStack.length)return;history.push(snap());applySnap(redoStack.pop());renderGrid();}

/* ══════════ COORDS ══════════ */
function getCell(e){
  const rect=gc.getBoundingClientRect();
  const px=(e.clientX-rect.left)/zoom, py=(e.clientY-rect.top)/zoom;
  const pad=20, total=cellSz+gapSz;
  const x=Math.floor((px-pad)/total), y=Math.floor((py-pad)/total);
  if(x<0||y<0||x>=cols||y>=rows) return null;
  return{x,y};
}

/* ══════════ DRAWING ══════════ */
function applyTool(x,y,fresh=false){
  if(x<0||y<0||x>=cols||y>=rows) return;
  const el=cellEl(x,y); if(!el) return;
  if(tool==='draw'){
    if(fresh){
      const nv=grid[y][x]===1?0:1; grid[y][x]=nv;
      if(nv){cellColors[`${x},${y}`]=drawColor;el.classList.add('filled');el.style.background=drawColor;}
      else  {delete cellColors[`${x},${y}`];el.classList.remove('filled');el.style.background='';}
    } else {
      if(grid[y][x]===1) return;
      grid[y][x]=1; cellColors[`${x},${y}`]=drawColor;
      el.classList.add('filled'); el.style.background=drawColor;
    }
    el.style.borderRadius=grid[y][x]?computeCellRadius(x,y):`${cellRad}px`;
    refreshRadiusAround(x,y);
    renderGapElements();
  } else if(tool==='erase'){
    if(grid[y][x]===0) return;
    grid[y][x]=0; delete cellColors[`${x},${y}`];
    el.classList.remove('filled'); el.style.background=''; el.style.borderRadius=`${cellRad}px`;
    refreshRadiusAround(x,y);
    renderGapElements();
  }
  updateStatus();
}

function applyGapTool(gt,gx,gy,toggle=false){
  const erase = tool==='erase';
  if(gt==='h'){
    // toggle: if already filled AND draw tool → erase it; else fill
    const cur=gapH[gy][gx];
    const newVal = erase ? 0 : (toggle && cur===1) ? 0 : 1;
    gapH[gy][gx]=newVal;
    if(newVal) gapHColors[`${gx},${gy}`]=drawColor;
    else delete gapHColors[`${gx},${gy}`];
  } else if(gt==='v'){
    const cur=gapV[gy][gx];
    const newVal = erase ? 0 : (toggle && cur===1) ? 0 : 1;
    gapV[gy][gx]=newVal;
    if(newVal) gapVColors[`${gx},${gy}`]=drawColor;
    else delete gapVColors[`${gx},${gy}`];
  } else if(gt==='d'){
    const cur=gapD[gy][gx];
    const newVal = erase ? 0 : (toggle && cur===1) ? 0 : 1;
    gapD[gy][gx]=newVal;
    if(newVal) gapDColors[`${gx},${gy}`]=drawColor;
    else delete gapDColors[`${gx},${gy}`];
  }
  renderGapElements();
  refreshAllRadius();
}

function floodFill(sx,sy){
  const target=grid[sy][sx], rep=target===1?0:1;
  if(target===rep) return;
  saveState();
  const visited=new Set(), stack=[{x:sx,y:sy}];
  while(stack.length){
    const{x,y}=stack.pop(); const k=`${x},${y}`;
    if(visited.has(k)||x<0||y<0||x>=cols||y>=rows||grid[y][x]!==target) continue;
    visited.add(k); grid[y][x]=rep;
    const el=cellEl(x,y);
    if(el){
      if(rep===1){cellColors[`${x},${y}`]=drawColor;el.classList.add('filled');el.style.background=drawColor;}
      else{delete cellColors[`${x},${y}`];el.classList.remove('filled');el.style.background='';}
    }
    stack.push({x:x+1,y},{x:x-1,y},{x,y:y+1},{x,y:y-1});
  }
  refreshAllRadius();
  renderGapElements();
  updateStatus();
}

/* ══════════ POINTER EVENTS ══════════ */
vp.addEventListener('pointerdown',e=>{
  if(tool==='pan'){
    panActive=true;
    panStart={mx:e.clientX,my:e.clientY,sx:vp.scrollLeft,sy:vp.scrollTop};
    vp.setPointerCapture(e.pointerId); return;
  }
  if(e.target.closest?.('.block-overlay')) return;

  // Gap element click — toggle on first press, fill-only on drag
  const gt=e.target.dataset.gtype;
  if(gt){
    saveState();
    applyGapTool(gt,+e.target.dataset.gx,+e.target.dataset.gy, false);
    gapDrawing=true;
    vp.setPointerCapture(e.pointerId); return;
  }

  const cell=getCell(e); if(!cell) return;
  if(tool==='fill'){floodFill(cell.x,cell.y);return;}
  isDrawing=true;
  if(tool==='draw'||tool==='erase') saveState();
  vp.setPointerCapture(e.pointerId);
  applyTool(cell.x,cell.y,true);
  lastX=cell.x; lastY=cell.y;
});

vp.addEventListener('pointermove',e=>{
  if(panActive){
    vp.scrollLeft=panStart.sx-(e.clientX-panStart.mx);
    vp.scrollTop=panStart.sy-(e.clientY-panStart.my); return;
  }
  const cell=getCell(e);
  if(cell){
    coordsBar.textContent=`X: ${cell.x} — Y: ${cell.y}`;
    $id('statusX').textContent=cell.x; $id('statusY').textContent=cell.y;
  }
  if(gapDrawing){
    const el=document.elementFromPoint(e.clientX,e.clientY);
    if(el&&el.dataset.gtype) applyGapTool(el.dataset.gtype,+el.dataset.gx,+el.dataset.gy);
    return;
  }
  if(!isDrawing||!cell) return;
  if(cell.x===lastX&&cell.y===lastY) return;
  applyTool(cell.x,cell.y,false);
  lastX=cell.x; lastY=cell.y;
});

vp.addEventListener('pointerup',e=>{
  isDrawing=false; panActive=false; gapDrawing=false;
  try{vp.releasePointerCapture(e.pointerId);}catch(err){}
});

/* ══════════════════════════════════════════
   BACKGROUND — BLEND MODE FIX
   
   ROOT CAUSE: gc uses transform:scale() which creates a stacking context.
   Any child element's mix-blend-mode is TRAPPED within gc's stacking context
   and cannot blend with the dark vp background.
   
   FIX: bgLayer stays as a SIBLING of gc inside vp (NOT a child of gc).
   We position it using the gc's bounding rect relative to vp.
   The image's mix-blend-mode now correctly composites against vp background.
══════════════════════════════════════════ */
function applyBg(){
  if(!bgImg){bgL.style.display='none';bgL.innerHTML='';return;}

  const pad=20;
  const gridW=cols*(cellSz+gapSz);
  const gridH=rows*(cellSz+gapSz);

  // Default size on first load
  if(!bgProps.w||bgProps.w===0){
    bgProps.w=Math.round(gridW*zoom*0.8);
    bgProps.h=Math.round(gridH*zoom*0.8);
    bgProps.x=Math.round(gridW*0.1);
    bgProps.y=Math.round(gridH*0.1);
  }

  // Position bgLayer to exactly overlay the grid content area
  // gc.getBoundingClientRect() gives screen coords; subtract vp rect + add scroll
  const gcRect=gc.getBoundingClientRect();
  const vpRect=vp.getBoundingClientRect();
  const offLeft = gcRect.left - vpRect.left + vp.scrollLeft + pad*zoom;
  const offTop  = gcRect.top  - vpRect.top  + vp.scrollTop  + pad*zoom;

  bgL.style.cssText=`
    position:absolute;
    left:${offLeft}px; top:${offTop}px;
    width:${gridW*zoom}px; height:${gridH*zoom}px;
    pointer-events:${bgDragEnable?'auto':'none'};
    z-index:2;
    display:${bgVisible?'block':'none'};
    overflow:visible;
  `;

  bgDragEnable ? buildBgFrame() : buildBgStatic();
}

function buildBgStatic(){
  bgL.innerHTML='';
  const imgDiv=document.createElement('div');
  imgDiv.style.cssText=`
    position:absolute;
    left:${bgProps.x*zoom}px; top:${bgProps.y*zoom}px;
    width:${bgProps.w}px; height:${bgProps.h}px;
    background-image:url(${bgImg});
    background-size:100% 100%; background-repeat:no-repeat;
    opacity:${bgProps.opacity};
    mix-blend-mode:${bgProps.blend};
    transform:rotate(${bgProps.rotate}deg); transform-origin:center center;
    pointer-events:none;
  `;
  bgL.appendChild(imgDiv);
}

function buildBgFrame(){
  bgL.innerHTML='';
  const frame=document.createElement('div');
  frame.id='__bgFrame';
  frame.style.cssText=`
    position:absolute;
    left:${bgProps.x*zoom}px; top:${bgProps.y*zoom}px;
    width:${bgProps.w}px; height:${bgProps.h}px;
    box-sizing:border-box;
    border:2px dashed rgba(66,165,245,0.8);
    pointer-events:auto; z-index:11; touch-action:none;
    transform:rotate(${bgProps.rotate}deg); transform-origin:center center;
  `;
  const imgDiv=document.createElement('div');
  imgDiv.style.cssText=`
    position:absolute; inset:0;
    background-image:url(${bgImg});
    background-size:100% 100%; background-repeat:no-repeat;
    opacity:${bgProps.opacity};
    mix-blend-mode:${bgProps.blend};
    pointer-events:none;
  `;
  frame.appendChild(imgDiv);
  const rl=document.createElement('div'); rl.className='rot-line'; frame.appendChild(rl);
  ['tl','tr','bl','br','tm','bm','lm','rm','rot'].forEach(cls=>{
    const h=document.createElement('div'); h.className=`bg-handle ${cls}`; h.dataset.h=cls; frame.appendChild(h);
  });
  bgL.appendChild(frame);
  attachFrameEvents(frame,imgDiv);
}

function attachFrameEvents(frame,imgEl){
  let action=null, start=null;
  function syncFrame(){
    frame.style.left=(bgProps.x*zoom)+'px'; frame.style.top=(bgProps.y*zoom)+'px';
    frame.style.width=bgProps.w+'px'; frame.style.height=bgProps.h+'px';
    frame.style.transform=`rotate(${bgProps.rotate}deg)`;
    imgEl.style.opacity=bgProps.opacity;
    imgEl.style.mixBlendMode=bgProps.blend;
    $id('bgOpacity').value=bgProps.opacity; $id('bgOpacityVal').textContent=Math.round(bgProps.opacity*100)+'%';
    const sc=Math.round(bgProps.w/(cols*(cellSz+gapSz)*zoom)*100);
    $id('bgScale').value=Math.min(300,sc); $id('bgScaleVal').textContent=Math.min(300,sc)+'%';
    $id('bgX').value=Math.round(bgProps.x); $id('bgXVal').textContent=Math.round(bgProps.x);
    $id('bgY').value=Math.round(bgProps.y); $id('bgYVal').textContent=Math.round(bgProps.y);
  }
  frame.addEventListener('pointerdown',e=>{
    e.stopPropagation(); e.preventDefault();
    action=e.target.dataset.h||'move';
    const fr=frame.getBoundingClientRect();
    start={mx:e.clientX,my:e.clientY,x:bgProps.x,y:bgProps.y,w:bgProps.w,h:bgProps.h,rotate:bgProps.rotate,
           startAngle:Math.atan2(e.clientY-(fr.top+fr.height/2),e.clientX-(fr.left+fr.width/2))};
    frame.setPointerCapture(e.pointerId);
  });
  frame.addEventListener('pointermove',e=>{
    if(!action||!start)return; e.stopPropagation(); e.preventDefault();
    const dx=e.clientX-start.mx, dy=e.clientY-start.my, MIN=30;
    if(action==='rot'){
      const fr=frame.getBoundingClientRect();
      const cur=Math.atan2(e.clientY-(fr.top+fr.height/2),e.clientX-(fr.left+fr.width/2));
      bgProps.rotate=start.rotate+(cur-start.startAngle)*(180/Math.PI);
      frame.style.transform=`rotate(${bgProps.rotate}deg)`; return;
    }
    if(action==='move'){
      bgProps.x=start.x+dx/zoom; bgProps.y=start.y+dy/zoom;
      frame.style.left=(bgProps.x*zoom)+'px'; frame.style.top=(bgProps.y*zoom)+'px';
      syncFrame(); return;
    }
    let nx=start.x,ny=start.y,nw=start.w,nh=start.h;
    if(action==='br'){nw=Math.max(MIN,start.w+dx);nh=Math.max(MIN,start.h+dy);}
    else if(action==='bl'){const d=Math.max(MIN,start.w-dx)-start.w;nw+=d;nx-=d/zoom;nh=Math.max(MIN,start.h+dy);}
    else if(action==='tr'){nw=Math.max(MIN,start.w+dx);const d=Math.max(MIN,start.h-dy)-start.h;nh+=d;ny-=d/zoom;}
    else if(action==='tl'){const dw=Math.max(MIN,start.w-dx)-start.w;nw+=dw;nx-=dw/zoom;const dh=Math.max(MIN,start.h-dy)-start.h;nh+=dh;ny-=dh/zoom;}
    else if(action==='rm'){nw=Math.max(MIN,start.w+dx);}
    else if(action==='lm'){const d=Math.max(MIN,start.w-dx)-start.w;nw+=d;nx-=d/zoom;}
    else if(action==='bm'){nh=Math.max(MIN,start.h+dy);}
    else if(action==='tm'){const d=Math.max(MIN,start.h-dy)-start.h;nh+=d;ny-=d/zoom;}
    bgProps.x=nx;bgProps.y=ny;bgProps.w=nw;bgProps.h=nh; syncFrame();
  });
  frame.addEventListener('pointerup',e=>{try{frame.releasePointerCapture(e.pointerId);}catch(err){}action=null;start=null;});
  frame.addEventListener('pointercancel',e=>{try{frame.releasePointerCapture(e.pointerId);}catch(err){}action=null;start=null;});
}

function syncBgControls(){
  $id('bgX').value=Math.round(bgProps.x); $id('bgXVal').textContent=Math.round(bgProps.x);
  $id('bgY').value=Math.round(bgProps.y); $id('bgYVal').textContent=Math.round(bgProps.y);
  const sc=Math.round(bgProps.w/(cols*(cellSz+gapSz)*zoom)*100);
  $id('bgScale').value=Math.min(300,sc); $id('bgScaleVal').textContent=Math.min(300,sc)+'%';
  $id('bgOpacity').value=bgProps.opacity; $id('bgOpacityVal').textContent=Math.round(bgProps.opacity*100)+'%';
}

/* BG controls */
/* ── setBgImage — مركزي لكل مصادر الصورة ── */
function setBgImage(dataUrl){
  bgImg = dataUrl;
  bgProps.rotate = 0;
  bgProps.opacity = 0.5;
  bgProps.blend = 'normal';

  const img = new Image();
  img.onload = () => {
    const cellTotal = cellSz + gapSz;
    const targetW   = 8 * cellTotal * zoom;
    const ratio     = img.naturalHeight / Math.max(1, img.naturalWidth);
    bgProps.w = targetW;
    bgProps.h = Math.round(targetW * ratio);
    bgProps.x = 2 * cellTotal;
    bgProps.y = 2 * cellTotal;
    bgDragEnable = true;
    if($id('bgDraggable')) $id('bgDraggable').checked = true;
    applyBg();
    syncBgControls();
    updateBgPreview(dataUrl);
    // إظهار الإعدادات فوراً
    const bgCtrl = $id('bgControls');
    if(bgCtrl) bgCtrl.style.display = 'flex';
  };
  img.src = dataUrl;
}

/* ── معاينة الصورة — يُظهر المعاينة ويُخفي upload-zone ── */
function updateBgPreview(dataUrl){
  const uploadZone  = $id('bgUploadZone');
  const previewArea = $id('bgPreviewArea');
  const thumb       = $id('bgPreviewThumb');
  if(dataUrl){
    if(uploadZone)  uploadZone.style.display  = 'none';
    if(previewArea) previewArea.style.display = 'block';
    if(thumb)       thumb.src = dataUrl;
  } else {
    if(uploadZone)  uploadZone.style.display  = '';
    if(previewArea) previewArea.style.display = 'none';
    if(thumb)       thumb.src = '';
    const bgCtrl = $id('bgControls');
    if(bgCtrl) bgCtrl.style.display = 'none';
  }
}

$id('bgFileInput').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f)return;
  const rd=new FileReader();
  rd.onload=ev=>{ setBgImage(ev.target.result); };
  rd.readAsDataURL(f);
});
['bgOpacity','bgScale','bgX','bgY'].forEach(id=>{
  $id(id).addEventListener('input',e=>{
    const v=+e.target.value;
    if(id==='bgOpacity'){bgProps.opacity=v;$id('bgOpacityVal').textContent=Math.round(v*100)+'%';}
    else if(id==='bgScale'){
      const gW=cols*(cellSz+gapSz)*zoom;
      const ratio=bgProps.h/Math.max(1,bgProps.w);
      bgProps.w=Math.round(gW*v/100); bgProps.h=Math.round(bgProps.w*ratio);
      $id('bgScaleVal').textContent=v+'%';
    }
    else if(id==='bgX'){bgProps.x=v;$id('bgXVal').textContent=v;}
    else if(id==='bgY'){bgProps.y=v;$id('bgYVal').textContent=v;}
    applyBg();
  });
});
$id('bgBlendMode').addEventListener('change',e=>{bgProps.blend=e.target.value;applyBg();});
$id('bgDraggable').addEventListener('change',e=>{
  bgDragEnable=e.target.checked; applyBg();
  const p=document.querySelector('.tool-btn[data-tool="pan"]');
  if(p){p.disabled=bgDragEnable;p.style.opacity=bgDragEnable?'0.4':'';if(bgDragEnable&&tool==='pan')setTool('draw');}
});
$id('bgToggle').addEventListener('click',()=>{bgVisible=!bgVisible;$id('bgToggle').textContent=bgVisible?'إخفاء':'إظهار';applyBg();});
$id('bgReset').addEventListener('click',()=>{bgProps.w=0;applyBg();syncBgControls();});
$id('bgRemove').addEventListener('click',()=>{
  bgImg=null; bgL.innerHTML=''; bgL.style.cssText='';
  $id('bgFileInput').value='';
  updateBgPreview(null);
});;

// Re-position bgLayer when vp scrolls (since bgLayer is vp-relative)
vp.addEventListener('scroll',()=>{if(bgImg)applyBg();});

/* ══════════ RULERS ══════════ */
function initRulers(){
  let rHDrag=false,rHStart={};
  rulerH.addEventListener('pointerdown',e=>{rHDrag=true;rHStart={my:e.clientY,top0:rulerH.offsetTop};rulerH.setPointerCapture(e.pointerId);e.stopPropagation();});
  rulerH.addEventListener('pointermove',e=>{if(!rHDrag)return;e.stopPropagation();const t=rHStart.top0+(e.clientY-rHStart.my);rulerH.style.top=t+'px';const gcR=gc.getBoundingClientRect();const row=Math.round(((t+vp.scrollTop-gcR.top)/zoom-20)/(cellSz+gapSz));rulerH.dataset.row='Y:'+Math.max(0,Math.min(rows-1,row));});
  rulerH.addEventListener('pointerup',e=>{rHDrag=false;try{rulerH.releasePointerCapture(e.pointerId);}catch(er){}});
  let rVDrag=false,rVStart={};
  rulerV.addEventListener('pointerdown',e=>{rVDrag=true;rVStart={mx:e.clientX,left0:rulerV.offsetLeft};rulerV.setPointerCapture(e.pointerId);e.stopPropagation();});
  rulerV.addEventListener('pointermove',e=>{if(!rVDrag)return;e.stopPropagation();const l=rVStart.left0+(e.clientX-rVStart.mx);rulerV.style.left=l+'px';const gcR=gc.getBoundingClientRect();const col=Math.round(((l+vp.scrollLeft-gcR.left)/zoom-20)/(cellSz+gapSz));rulerV.dataset.col='X:'+Math.max(0,Math.min(cols-1,col));});
  rulerV.addEventListener('pointerup',e=>{rVDrag=false;try{rulerV.releasePointerCapture(e.pointerId);}catch(er){}});
}
$id('showRulers').addEventListener('change',e=>{showRulers=e.target.checked;rulerH.style.display=showRulers?'block':'none';rulerV.style.display=showRulers?'block':'none';});

/* ══════════ COLORS & TOOLS ══════════ */
// (color listeners handled by SHARED SWATCH SYSTEM above)
$id('bgColor').addEventListener('input',e=>{document.documentElement.style.setProperty('--cell-bg',e.target.value);});
$id('canvasBgColor').addEventListener('input',e=>{$id('canvasArea').style.background=e.target.value;vp.style.background=e.target.value;});
$id('canvasDark').addEventListener('click',()=>{$id('canvasBgColor').value='#0A0C10';$id('canvasBgColor').dispatchEvent(new Event('input'));});
$id('canvasLight').addEventListener('click',()=>{$id('canvasBgColor').value='#F0EDE8';$id('canvasBgColor').dispatchEvent(new Event('input'));});
/* ══════════ SHARED SWATCH SYSTEM ══════════ */
const SWATCH_KEY = 'kufi_swatches';
const DEFAULT_SWATCHES = ['#7C3AED','#A855F7','#EF4444','#22C55E','#3B82F6','#EC4899','#14B8A6','#F5A623','#FFFFFF','#111827'];

function loadSwatchList(){
  try{ return JSON.parse(localStorage.getItem(SWATCH_KEY)) || DEFAULT_SWATCHES; }
  catch(e){ return DEFAULT_SWATCHES; }
}
function saveSwatchList(arr){ localStorage.setItem(SWATCH_KEY, JSON.stringify(arr)); }

function setDrawColorFull(color){
  drawColor = color;
  $id('fillColor').value = color;
  $id('quickColor').value = color;
  $id('colorPreview').style.background = color;
  syncSwatches();
}

function syncSwatches(){
  document.querySelectorAll('.swatch, .float-swatch').forEach(s=>{
    s.classList.toggle('selected', s.dataset.color===drawColor);
  });
}

function buildSwatches(){
  const list = loadSwatchList();

  // ── Panel swatches (tab-tools) ──
  const container = $id('swatchesContainer');
  if(container){
    container.innerHTML='';
    list.forEach(color=>{
      const s=document.createElement('div');
      s.className='swatch'; s.style.background=color; s.dataset.color=color;
      if(color===drawColor) s.classList.add('selected');
      s.addEventListener('click',()=>setDrawColorFull(color));
      // Long press to remove
      let holdTimer=null;
      s.addEventListener('pointerdown',()=>{ holdTimer=setTimeout(()=>{ if(confirm(`حذف اللون ${color} من القائمة؟`)){ removeSwatchColor(color); }},700); });
      s.addEventListener('pointerup',()=>clearTimeout(holdTimer));
      s.addEventListener('pointerleave',()=>clearTimeout(holdTimer));
      container.appendChild(s);
    });
  }

  // ── Floating toolbar swatches ──
  const floatEl = $id('floatSwatches');
  if(floatEl){
    floatEl.innerHTML='';
    list.forEach(color=>{
      const s=document.createElement('div');
      s.className='float-swatch'; s.style.background=color; s.dataset.color=color;
      if(color===drawColor) s.classList.add('selected');
      s.title=color;
      s.addEventListener('click',()=>setDrawColorFull(color));
      floatEl.appendChild(s);
    });
  }
}

function addSwatchColor(color){
  const list = loadSwatchList();
  if(!list.includes(color)){ list.push(color); saveSwatchList(list); }
  buildSwatches();
  setDrawColorFull(color);
}
function removeSwatchColor(color){
  let list = loadSwatchList().filter(c=>c!==color);
  if(list.length===0) list=[...DEFAULT_SWATCHES];
  saveSwatchList(list);
  buildSwatches();
}

/* ── Color dropdown toggle ── */
const colorDropBtn = document.getElementById('colorDropBtn');
const colorDropdown = document.getElementById('colorDropdown');
colorDropBtn.addEventListener('click', e=>{
  e.stopPropagation();
  colorDropdown.classList.toggle('open');
});
document.addEventListener('click', ()=> colorDropdown.classList.remove('open'));
colorDropdown.addEventListener('click', e=> e.stopPropagation());

// Add swatch button (in tools panel)
$id('btnAddSwatch').addEventListener('click',()=>$id('newSwatchColor').click());
$id('newSwatchColor').addEventListener('input',e=>addSwatchColor(e.target.value));

// fillColor + quickColor sync
$id('fillColor').addEventListener('input',e=>setDrawColorFull(e.target.value));
$id('quickColor').addEventListener('input',e=>setDrawColorFull(e.target.value));

function setTool(t){
  tool=t;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));
  vp.classList.toggle('pan-mode',t==='pan');
  $id('statusTool').textContent={draw:'رسم',erase:'ممحاة',fill:'ملء',pan:'تحريك'}[t]||t;
}
document.querySelectorAll('.tool-btn[data-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));

/* ══════════ GRID CONTROLS ══════════ */
$id('cellSizeR').addEventListener('input',e=>{
  cellSz=+e.target.value; $id('cellSizeVal').textContent=cellSz;
  document.documentElement.style.setProperty('--cell-size',cellSz+'px');
  gc.style.gridTemplateColumns=`repeat(${cols},${cellSz}px)`;
  document.querySelectorAll('.cell').forEach(c=>{c.style.width=c.style.height=cellSz+'px';});
  drawAxisLines(); renderGapElements(); refreshAllRadius(); applyBg();
});
$id('gapSizeR').addEventListener('input',e=>{
  gapSz=+e.target.value; $id('gapSizeVal').textContent=gapSz;
  gc.style.gap=`${gapSz}px`;
  document.documentElement.style.setProperty('--gap',gapSz+'px');
  drawAxisLines(); renderGapElements(); refreshAllRadius();
});
$id('cellRadR').addEventListener('input',e=>{
  cellRad=+e.target.value; $id('cellRadVal').textContent=cellRad;
  refreshAllRadius(); renderGapElements();
});
$id('showAxis').addEventListener('change',e=>{showAxis=e.target.checked;drawAxisLines();});
$id('axisColor').addEventListener('input',e=>{axisColor=e.target.value;drawAxisLines();});
$id('axisEveryR').addEventListener('input',e=>{axisEvery=+e.target.value;$id('axisEveryVal').textContent=axisEvery;drawAxisLines();});

$id('applyGridSize').addEventListener('click',()=>{
  const c=Math.max(5,Math.min(120,+$id('gridCols').value));
  const r=Math.max(5,Math.min(120,+$id('gridRows').value));
  if(grid.flat().some(v=>v)){showConfirm('تغيير الحجم سيمسح المحتوى؟',()=>initGrid(c,r));}
  else initGrid(c,r);
});
document.querySelectorAll('[data-preset]').forEach(b=>{
  b.addEventListener('click',()=>{
    const[c,r]=b.dataset.preset.split(',').map(Number);
    $id('gridCols').value=c;$id('gridRows').value=r;$id('applyGridSize').click();
  });
});

/* ══════════ ZOOM ══════════ */
function setZoom(z){
  zoom=Math.max(0.25,Math.min(5,z));
  gc.style.transform=`scale(${zoom})`;
  gc.style.transformOrigin='top left';
  const txt=Math.round(zoom*100)+'%';
  const zl=$id('zoomLevel2'); if(zl) zl.textContent=txt;
  if(bgImg) applyBg();
}
// Wire topbar zoom buttons (they live in topbarRow2)
$id('zoomIn2').addEventListener('click',()=>setZoom(zoom+0.1));
$id('zoomOut2').addEventListener('click',()=>setZoom(zoom-0.1));
$id('zoomFit2').addEventListener('click',()=>{setZoom(1);vp.scrollTo({top:0,left:0,behavior:'smooth'});});
vp.addEventListener('wheel',e=>{
  if(e.ctrlKey||e.metaKey){e.preventDefault();setZoom(zoom+(e.deltaY<0?0.1:-0.1));}
},{passive:false});

/* ══════════ LETTER BLOCKS ══════════ */
/* ══════════════════════════════════════════════
   LETTER LIBRARY — IndexedDB + Editor
══════════════════════════════════════════════ */

/* ══════════ LETTER LIBRARY — External JSON + IndexedDB ══════════
   Flow:
   1. openDB()  — open IndexedDB 'KufiLetters' v2
   2. First run: fetch letters.json → seed DB (store._default + user overrides)
   3. loadMergedLetters() — merge defaults + user overrides → CUSTOM_LETTERS
   4. User edits → saved to DB as user overrides (ch key)
   5. "Reset to default" → delete all user overrides, reload defaults
══════════════════════════════════════════════════════════════════ */

let lettersDB = null;
let CUSTOM_LETTERS = {};
let DEFAULT_LETTERS = {}; // loaded from letters.json, immutable at runtime

/* ── IndexedDB ── */
function openDB(){
  return new Promise((res,rej)=>{
    const req = indexedDB.open('KufiLetters', 2);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      // letters store: user overrides keyed by ch
      if(!db.objectStoreNames.contains('letters'))
        db.createObjectStore('letters', {keyPath:'ch'});
      // meta store: flags like _defaultVersion
      if(!db.objectStoreNames.contains('meta'))
        db.createObjectStore('meta', {keyPath:'k'});
    };
    req.onsuccess = e => { lettersDB = e.target.result; res(lettersDB); };
    req.onerror   = () => rej(req.error);
  });
}

function dbGetAll(store='letters'){
  return new Promise(res=>{
    const tx = lettersDB.transaction(store,'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result||[]);
    req.onerror   = () => res([]);
  });
}
function dbGet(key, store='meta'){
  return new Promise(res=>{
    const tx = lettersDB.transaction(store,'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => res(req.result||null);
    req.onerror   = () => res(null);
  });
}
function dbPut(obj, store='letters'){
  return new Promise(res=>{
    const tx = lettersDB.transaction(store,'readwrite');
    tx.objectStore(store).put(obj);
    tx.oncomplete = () => res();
    tx.onerror    = () => res();
  });
}
function dbDelete(ch, store='letters'){
  return new Promise(res=>{
    const tx = lettersDB.transaction(store,'readwrite');
    tx.objectStore(store).delete(ch);
    tx.oncomplete = () => res();
  });
}
function dbClearStore(store='letters'){
  return new Promise(res=>{
    const tx = lettersDB.transaction(store,'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => res();
  });
}

/* ── Fetch default letters.json ── */
async function fetchDefaultLetters(){
  try{
    // Build URL relative to the HTML file location (works on GitHub Pages /repo/ paths)
    const base = document.currentScript?.src
      ? new URL('.', document.currentScript.src).href
      : new URL('.', location.href).href;
    const url = new URL('letters.json', base).href;
    const r = await fetch(url);
    if(!r.ok) throw new Error('not found');
    const json = await r.json();
    return json.letters || {};
  }catch(e){
    console.warn('letters.json not found, library will be empty');
    return {};
  }
}

/* ── Seed DB on first run (or when default version changes) ── */
async function seedDefaultsIfNeeded(){
  const defaults = await fetchDefaultLetters();
  DEFAULT_LETTERS = defaults;
  const meta = await dbGet('_defaultVersion');
  const currentVer = 1; // bump this when you update letters.json
  if(!meta || meta.v !== currentVer){
    // First time or version changed — nothing to clear
    // (user overrides stay, we just update our in-memory defaults)
    await dbPut({k:'_defaultVersion', v: currentVer}, 'meta');
  }
}

/* ── Build CUSTOM_LETTERS: defaults merged with user overrides ── */
async function loadMergedLetters(){
  await seedDefaultsIfNeeded();
  const userOverrides = await dbGetAll('letters');
  CUSTOM_LETTERS = {};

  // 1. Load defaults
  Object.entries(DEFAULT_LETTERS).forEach(([ch, v])=>{
    const rows = v.m.length, cols = v.m[0]?.length||1;
    CUSTOM_LETTERS[ch] = {
      name: v.name,
      m:    v.m,
      gH:   v.gH || Array.from({length:rows-1}, ()=>Array(cols).fill(0)),
      gV:   v.gV || Array.from({length:rows},   ()=>Array(cols-1).fill(0)),
      gD:   v.gD || Array.from({length:rows-1}, ()=>Array(cols-1).fill(0)),
      _builtin: true
    };
  });

  // 2. Overlay user overrides (user edits win)
  userOverrides.forEach(obj=>{
    const rows = obj.m.length, cols = obj.m[0]?.length||1;
    CUSTOM_LETTERS[obj.ch] = {
      name: obj.name, m: obj.m,
      gH:   obj.gH || Array.from({length:rows-1}, ()=>Array(cols).fill(0)),
      gV:   obj.gV || Array.from({length:rows},   ()=>Array(cols-1).fill(0)),
      gD:   obj.gD || Array.from({length:rows-1}, ()=>Array(cols-1).fill(0)),
      _builtin: false
    };
  });
}

async function saveLetterToDB(ch, name, m){
  await dbPut({ch, name, m, gH:[], gV:[], gD:[]});
  CUSTOM_LETTERS[ch] = {name, m, gH:[], gV:[], gD:[], _builtin:false};
}

async function deleteLetterFromDB(ch){
  await dbDelete(ch);
  // Restore from defaults if it exists there
  if(DEFAULT_LETTERS[ch]){
    const v = DEFAULT_LETTERS[ch];
    const rows = v.m.length, cols = v.m[0].length;
    CUSTOM_LETTERS[ch] = {
      name: v.name, m: v.m,
      gH: v.gH || Array.from({length:rows-1}, ()=>Array(cols).fill(0)),
      gV: v.gV || Array.from({length:rows},   ()=>Array(cols-1).fill(0)),
      gD: v.gD || Array.from({length:rows-1}, ()=>Array(cols-1).fill(0)),
      _builtin: true
    };
  } else {
    delete CUSTOM_LETTERS[ch];
  }
}

/* ── Reset ALL user overrides → back to letters.json ── */
async function resetToDefaults(){
  await dbClearStore('letters');
  await loadMergedLetters();
  buildLetters($id('libSearch').value);
}

/* ── Build Library UI ── */
function buildLetters(filter=''){
  const lib=$id('letterLibrary'); lib.innerHTML='';
  const fl=filter.trim().toLowerCase();
  Object.entries(CUSTOM_LETTERS)
    .filter(([ch,{name}])=>!fl||ch.includes(fl)||name.toLowerCase().includes(fl))
    .forEach(([ch,{name,m,gH,gV,_builtin}])=>{
    const card=document.createElement('div'); card.className='letter-card';
    // mini preview via canvas (correct, no mirror issue)
    const rows=m.length, cols=m[0]?.length||1;
    const dotSz=3, gapDotSz=1, T=dotSz+gapDotSz;
    const cw=cols*T-gapDotSz, ch2=rows*T-gapDotSz;
    const cv=document.createElement('canvas'); cv.width=cw; cv.height=ch2;
    cv.style.cssText=`display:block;image-rendering:pixelated;`;
    const ctx=cv.getContext('2d');
    ctx.clearRect(0,0,cw,ch2);
    // cells
    m.forEach((row,y)=>row.forEach((v,x)=>{
      if(!v) return;
      ctx.fillStyle='#F5A623';
      ctx.fillRect(x*T,y*T,dotSz,dotSz);
    }));
    // gapH
    if(gH) gH.forEach((row,y)=>row.forEach((v,x)=>{
      if(!v) return;
      ctx.fillStyle='#F5A623';
      ctx.fillRect(x*T,(y+1)*T-gapDotSz,dotSz,gapDotSz);
    }));
    // gapV
    if(gV) gV.forEach((row,y)=>row.forEach((v,x)=>{
      if(!v) return;
      ctx.fillStyle='#F5A623';
      ctx.fillRect((x+1)*T-gapDotSz,y*T,gapDotSz,dotSz);
    }));
    const nm=document.createElement('div'); nm.className='lc-name'; nm.textContent=name+(_builtin?'':' ✎');
    const chLbl=document.createElement('div'); chLbl.className='lc-char'; chLbl.textContent=ch;
    // action buttons overlay
    const acts=document.createElement('div'); acts.className='lc-actions';
    const editBtn=document.createElement('button'); editBtn.className='lc-act-btn'; editBtn.title='تعديل';
    editBtn.innerHTML='✎';
    editBtn.addEventListener('click',e=>{e.stopPropagation();openEditor(ch);});
    acts.appendChild(editBtn);
    card.appendChild(acts);
    card.appendChild(cv);card.appendChild(chLbl);card.appendChild(nm);
    card.addEventListener('click',()=>addLetter(ch));
    lib.appendChild(card);
  });
  if(lib.children.length===0){
    lib.innerHTML=`<div style="color:var(--muted);font-size:11px;text-align:center;padding:12px;grid-column:1/-1;">لا توجد نتائج</div>`;
  }
}

$id('libSearch').addEventListener('input',e=>buildLetters(e.target.value));

/* ── Letter Editor ── */
/* ══════════════════════════════════════════════
   LETTER EDITOR — Real grid with cells + gapH + gapV + gapD
   Mirrors the main canvas so letters look identical when placed
══════════════════════════════════════════════ */

let leMatrix=[];            // cells [rows][cols]
let leGapH=[];              // horizontal gaps [rows-1][cols]
let leGapV=[];              // vertical gaps   [rows][cols-1]
let leGapD=[];              // corner dots     [rows-1][cols-1]
let leEditCh=null;
let leDrawing=false, leDrawVal=1, leDrawType=null;
let leTool='draw'; // 'draw' | 'erase'

// Editor display constants — calculated from available space
const LE_PAD=8;

function leCalcSizes(rows,cols){
  const maxW=Math.min(window.innerWidth*0.88, 400) - LE_PAD*2 - 20;
  const maxH=Math.min(window.innerHeight*0.5, 300) - LE_PAD*2;
  // cellSz and gapSz proportional to main canvas ratio (gap = 0.33 * cell)
  const totalCols = cols + (cols-1)*0.38;
  const totalRows = rows + (rows-1)*0.38;
  const szFromW = maxW / totalCols;
  const szFromH = maxH / totalRows;
  const cSz = Math.max(8, Math.min(28, Math.floor(Math.min(szFromW,szFromH))));
  const gSz = Math.max(3, Math.round(cSz * 0.38));
  return {cSz, gSz};
}

function leInitArrays(rows,cols,keepExisting=false){
  const oldM=leMatrix, oldH=leGapH, oldV=leGapV, oldD=leGapD;
  leMatrix = Array.from({length:rows},(_,y)=>Array.from({length:cols},(_,x)=>keepExisting?(oldM[y]?.[x]||0):0));
  leGapH   = Array.from({length:rows-1},(_,y)=>Array.from({length:cols},(_,x)=>keepExisting?(oldH[y]?.[x]||0):0));
  leGapV   = Array.from({length:rows},(_,y)=>Array.from({length:cols-1},(_,x)=>keepExisting?(oldV[y]?.[x]||0):0));
  leGapD   = Array.from({length:rows-1},(_,y)=>Array.from({length:cols-1},(_,x)=>keepExisting?(oldD[y]?.[x]||0):0));
}

function openEditor(ch=null){
  leEditCh=ch;
  const existing = ch ? CUSTOM_LETTERS[ch] : null;
  $id('leModalTitle').textContent = ch ? `تعديل: ${ch}` : 'حرف جديد';
  $id('leChar').value = ch||'';
  $id('leName').value = existing?.name||'';
  $id('leDeleteBtn').style.display = ch ? 'block':'none';
  const rows = existing ? existing.m.length : 5;
  const cols = existing ? existing.m[0].length : 5;
  $id('leGridH').value=rows; $id('leGridW').value=cols;
  // Load existing data
  leMatrix = existing ? existing.m.map(r=>[...r]) : Array.from({length:rows},()=>Array(cols).fill(0));
  leGapH   = existing?.gH ? existing.gH.map(r=>[...r]) : Array.from({length:rows-1},()=>Array(cols).fill(0));
  leGapV   = existing?.gV ? existing.gV.map(r=>[...r]) : Array.from({length:rows},()=>Array(cols-1).fill(0));
  leGapD   = existing?.gD ? existing.gD.map(r=>[...r]) : Array.from({length:rows-1},()=>Array(cols-1).fill(0));
  leTool='draw'; leSetTool('draw');
  renderLeEditor();
  $id('letterEditorModal').classList.add('open');
}

function leSetTool(t){
  leTool=t;
  document.querySelectorAll('.le-tool-btn').forEach(b=>b.classList.toggle('active',b.dataset.letool===t));
}
document.querySelectorAll('.le-tool-btn').forEach(b=>b.addEventListener('click',()=>leSetTool(b.dataset.letool)));

/* ── Render the editor grid (absolute-positioned like main canvas) ── */
function renderLeEditor(){
  const rows=leMatrix.length, cols=leMatrix[0]?.length||1;
  const {cSz, gSz} = leCalcSizes(rows,cols);
  const total = cSz + gSz;
  const W = LE_PAD*2 + cols*cSz + (cols-1)*gSz;
  const H = LE_PAD*2 + rows*cSz + (rows-1)*gSz;
  const eg=$id('leEditorGrid');
  eg.innerHTML='';
  eg.style.width=W+'px'; eg.style.height=H+'px';

  // Cells
  for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){
    const el=document.createElement('div');
    el.className='le-gcell'+(leMatrix[y][x]?' on':'');
    el.dataset.t='c'; el.dataset.x=x; el.dataset.y=y;
    const R=leMatrix[y][x]?leCellRad(x,y,cSz):`${Math.min(cSz/4,4)}px`;
    el.style.cssText=`left:${LE_PAD+x*total}px;top:${LE_PAD+y*total}px;width:${cSz}px;height:${cSz}px;border-radius:${R};`;
    eg.appendChild(el);
  }
  // gapH (horizontal — between rows)
  for(let gy=0;gy<rows-1;gy++) for(let gx=0;gx<cols;gx++){
    const v=leGapH[gy][gx];
    const el=document.createElement('div');
    el.className='le-gH'+(v?' on':'');
    el.dataset.t='h'; el.dataset.x=gx; el.dataset.y=gy;
    el.style.cssText=`left:${LE_PAD+gx*total}px;top:${LE_PAD+(gy+1)*total-gSz}px;width:${cSz}px;height:${gSz}px;border-radius:${v?leGHRad(gx,gy,cSz):'0'};`;
    eg.appendChild(el);
  }
  // gapV (vertical — between cols)
  for(let gy=0;gy<rows;gy++) for(let gx=0;gx<cols-1;gx++){
    const v=leGapV[gy][gx];
    const el=document.createElement('div');
    el.className='le-gV'+(v?' on':'');
    el.dataset.t='v'; el.dataset.x=gx; el.dataset.y=gy;
    el.style.cssText=`left:${LE_PAD+(gx+1)*total-gSz}px;top:${LE_PAD+gy*total}px;width:${gSz}px;height:${cSz}px;border-radius:${v?leGVRad(gx,gy,cSz):'0'};`;
    eg.appendChild(el);
  }
  // gapD (corner dots)
  for(let gy=0;gy<rows-1;gy++) for(let gx=0;gx<cols-1;gx++){
    const v=leGapD[gy][gx];
    const el=document.createElement('div');
    el.className='le-gD'+(v?' on':'');
    el.dataset.t='d'; el.dataset.x=gx; el.dataset.y=gy;
    const dr=v?Math.min(Math.floor(gSz/2),3):0;
    el.style.cssText=`left:${LE_PAD+(gx+1)*total-gSz}px;top:${LE_PAD+(gy+1)*total-gSz}px;width:${gSz}px;height:${gSz}px;border-radius:${dr}px;`;
    eg.appendChild(el);
  }

  // Pointer events
  let drawing=false, dVal=1, dType=null;
  eg.onpointerdown=e=>{
    const el=e.target; if(!el.dataset.t) return;
    e.preventDefault(); drawing=true;
    eg.setPointerCapture(e.pointerId);
    const t=el.dataset.t, x=+el.dataset.x, y=+el.dataset.y;
    dType=t;
    const cur=leGetVal(t,x,y);
    dVal = leTool==='erase' ? 0 : (cur?0:1); // toggle on first click
    leSetVal(t,x,y,dVal);
    leRefreshEl(el,t,x,y,cSz,gSz);
    leRefreshNeighbours(t,x,y,cSz,gSz);
  };
  eg.onpointermove=e=>{
    if(!drawing) return;
    const raw=document.elementFromPoint(e.clientX,e.clientY);
    const el=raw?.closest?.('[data-t]')||raw;
    if(!el?.dataset?.t) return;
    const t=el.dataset.t, x=+el.dataset.x, y=+el.dataset.y;
    if(t!==dType) return; // only paint same type during drag
    if(leGetVal(t,x,y)===dVal) return;
    leSetVal(t,x,y,dVal);
    leRefreshEl(el,t,x,y,cSz,gSz);
    leRefreshNeighbours(t,x,y,cSz,gSz);
  };
  eg.onpointerup=()=>{drawing=false;};
  eg.onpointercancel=()=>{drawing=false;};
}

function leGetVal(t,x,y){
  if(t==='c') return leMatrix[y]?.[x]||0;
  if(t==='h') return leGapH[y]?.[x]||0;
  if(t==='v') return leGapV[y]?.[x]||0;
  if(t==='d') return leGapD[y]?.[x]||0;
  return 0;
}
function leSetVal(t,x,y,v){
  if(t==='c'&&leMatrix[y]) leMatrix[y][x]=v;
  else if(t==='h'&&leGapH[y]) leGapH[y][x]=v;
  else if(t==='v'&&leGapV[y]) leGapV[y][x]=v;
  else if(t==='d'&&leGapD[y]) leGapD[y][x]=v;
}

/* ── Smart radius functions for the editor (mirrors main canvas) ── */
function leFC(x,y){const r=leMatrix.length,c=leMatrix[0]?.length||0;return x>=0&&x<c&&y>=0&&y<r&&leMatrix[y][x]===1;}
function leGH(x,y){const r=leGapH.length,c=leGapH[0]?.length||0;return y>=0&&y<r&&x>=0&&x<c&&leGapH[y][x]===1;}
function leGV(x,y){const r=leGapV.length,c=leGapV[0]?.length||0;return y>=0&&y<r&&x>=0&&x<c&&leGapV[y][x]===1;}
function leGD(x,y){const r=leGapD.length,c=leGapD[0]?.length||0;return y>=0&&y<r&&x>=0&&x<c&&leGapD[y][x]===1;}
function leRc(blocked,cSz){return(blocked)?0:Math.min(cSz/4,4);}

function leCellRad(x,y,cSz){
  const tl=leRc(leGV(x-1,y)||leGH(x,y-1)||leGD(x-1,y-1),cSz);
  const tr=leRc(leGV(x,  y)||leGH(x,y-1)||leGD(x,  y-1),cSz);
  const bl=leRc(leGV(x-1,y)||leGH(x,y  )||leGD(x-1,y  ),cSz);
  const br=leRc(leGV(x,  y)||leGH(x,y  )||leGD(x,  y  ),cSz);
  return `${tl}px ${tr}px ${br}px ${bl}px`;
}
function leGHRad(gx,gy,cSz){
  const tl=leRc(leFC(gx,gy)  ||leGV(gx-1,gy)  ||leGD(gx-1,gy),cSz);
  const tr=leRc(leFC(gx,gy)  ||leGV(gx,  gy)  ||leGD(gx,  gy),cSz);
  const bl=leRc(leFC(gx,gy+1)||leGV(gx-1,gy+1)||leGD(gx-1,gy),cSz);
  const br=leRc(leFC(gx,gy+1)||leGV(gx,  gy+1)||leGD(gx,  gy),cSz);
  return `${tl}px ${tr}px ${br}px ${bl}px`;
}
function leGVRad(gx,gy,cSz){
  const tl=leRc(leFC(gx,  gy)||leGH(gx,  gy-1)||leGD(gx,gy-1),cSz);
  const tr=leRc(leFC(gx+1,gy)||leGH(gx+1,gy-1)||leGD(gx,gy-1),cSz);
  const bl=leRc(leFC(gx,  gy)||leGH(gx,  gy)  ||leGD(gx,gy),cSz);
  const br=leRc(leFC(gx+1,gy)||leGH(gx+1,gy)  ||leGD(gx,gy),cSz);
  return `${tl}px ${tr}px ${br}px ${bl}px`;
}

function leGDRad(gx,gy,cSz){
  const maxR=Math.min(Math.floor(cSz*0.38/2),3);
  const r2=(b)=>b?0:maxR;
  const tl=r2(leFC(gx,  gy)  ||leGH(gx,  gy)||leGV(gx,gy));
  const tr=r2(leFC(gx+1,gy)  ||leGH(gx+1,gy)||leGV(gx,gy));
  const bl=r2(leFC(gx,  gy+1)||leGH(gx,  gy)||leGV(gx,gy+1));
  const br=r2(leFC(gx+1,gy+1)||leGH(gx+1,gy)||leGV(gx,gy+1));
  return `${tl}px ${tr}px ${br}px ${bl}px`;
}

function leRefreshEl(el,t,x,y,cSz,gSz){
  const v=leGetVal(t,x,y);
  el.classList.toggle('on',!!v);
  if(t==='c') el.style.borderRadius=v?leCellRad(x,y,cSz):`${Math.min(cSz/4,4)}px`;
  else if(t==='h') el.style.borderRadius=v?leGHRad(x,y,cSz):'0';
  else if(t==='v') el.style.borderRadius=v?leGVRad(x,y,cSz):'0';
  else if(t==='d') el.style.borderRadius=v?leGDRad(x,y,cSz):'0';
}

function leGetElAt(t,x,y){
  return $id('leEditorGrid').querySelector(`[data-t="${t}"][data-x="${x}"][data-y="${y}"]`);
}
function leRefreshNeighbours(t,x,y,cSz,gSz){
  const rows=leMatrix.length, cols=leMatrix[0]?.length||1;
  // Refresh all cells nearby
  for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
    const nx=x+dx, ny=y+dy;
    if(nx<0||nx>=cols||ny<0||ny>=rows) continue;
    const el=leGetElAt('c',nx,ny); if(!el) continue;
    leRefreshEl(el,'c',nx,ny,cSz,gSz);
  }
  // Refresh nearby gaps
  for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
    ['h','v','d'].forEach(gt=>{
      const nx=x+dx, ny=y+dy;
      const el=leGetElAt(gt,nx,ny); if(!el) return;
      leRefreshEl(el,gt,nx,ny,cSz,gSz);
    });
  }
}

$id('leResizeBtn').addEventListener('click',()=>{
  const nw=Math.max(1,Math.min(20,+$id('leGridW').value));
  const nh=Math.max(1,Math.min(20,+$id('leGridH').value));
  leInitArrays(nh,nw,true);
  renderLeEditor();
});
$id('leClearBtn').addEventListener('click',()=>{
  const rows=leMatrix.length, cols=leMatrix[0]?.length||1;
  leInitArrays(rows,cols,false);
  renderLeEditor();
});
$id('leClose').addEventListener('click',()=>$id('letterEditorModal').classList.remove('open'));
$id('leCancelBtn').addEventListener('click',()=>$id('letterEditorModal').classList.remove('open'));

$id('leSaveBtn').addEventListener('click',async()=>{
  const ch=$id('leChar').value.trim();
  const name=$id('leName').value.trim()||ch;
  if(!ch){alert('أدخل الحرف أو الرمز');return;}
  if(!leMatrix.flat().some(v=>v)&&!leGapH.flat().some(v=>v)&&!leGapV.flat().some(v=>v)){
    alert('ارسم شكل الحرف في الشبكة');return;
  }
  // Save with gaps
  const obj={ch,name,
    m:leMatrix.map(r=>[...r]),
    gH:leGapH.map(r=>[...r]),
    gV:leGapV.map(r=>[...r]),
    gD:leGapD.map(r=>[...r])
  };
  await dbPut(obj);
  CUSTOM_LETTERS[ch]={name,m:obj.m,gH:obj.gH,gV:obj.gV,gD:obj.gD,_builtin:false};
  buildLetters($id('libSearch').value);
  $id('letterEditorModal').classList.remove('open');
});

$id('leDeleteBtn').addEventListener('click',async()=>{
  if(!leEditCh) return;
  const isBuiltin=CUSTOM_LETTERS[leEditCh]?._builtin;
  const msg=isBuiltin
    ? `هذا حرف مدمج. هل تريد إعادته للشكل الافتراضي؟`
    : `حذف الحرف "${leEditCh}"؟`;
  if(!confirm(msg)) return;
  await deleteLetterFromDB(leEditCh);
  buildLetters($id('libSearch').value);
  $id('letterEditorModal').classList.remove('open');
});

/* ── Export / Import ── */
$id('btnAddLetter').addEventListener('click',()=>openEditor(null));

// Reset to defaults
$id('btnResetLib').addEventListener('click',async()=>{
  if(!confirm('إعادة جميع الحروف للشكل الافتراضي؟\nسيتم حذف كل تعديلاتك على الحروف.')) return;
  await resetToDefaults();
  alert('✓ تم استعادة الحروف الافتراضية');
});

$id('btnExportLib').addEventListener('click',()=>{
  const all={};
  Object.entries(CUSTOM_LETTERS).forEach(([ch,{name,m,gH,gV,gD}])=>{
    all[ch]={name,m,gH:gH||[],gV:gV||[],gD:gD||[]};
  });
  const blob=new Blob([JSON.stringify({letters:all,_exported:Date.now()},null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`kufi-letters-${Date.now()}.json`; a.click();
});

$id('btnImportLib').addEventListener('click',()=>$id('importLibFile').click());
$id('importLibFile').addEventListener('change',async e=>{
  const f=e.target.files[0]; if(!f) return;
  try{
    const text=await f.text();
    const json=JSON.parse(text);
    const src=json.letters||json;
    let count=0;
    for(const [ch,val] of Object.entries(src)){
      if(ch.startsWith('_')) continue;
      if(!val.name||!Array.isArray(val.m)) continue;
      const rows=val.m.length, cols=val.m[0]?.length||1;
      await dbPut({
        ch, name:val.name, m:val.m,
        gH: val.gH||Array.from({length:rows-1},()=>Array(cols).fill(0)),
        gV: val.gV||Array.from({length:rows},()=>Array(cols-1).fill(0)),
        gD: val.gD||Array.from({length:rows-1},()=>Array(cols-1).fill(0))
      });
      count++;
    }
    await loadMergedLetters();
    buildLetters();
    alert(`تم استيراد ${count} حرف بنجاح`);
  }catch(err){alert('خطأ في قراءة الملف: '+err.message);}
  e.target.value='';
});

/* ── addLetter — copies cells + all gaps to main canvas ── */
function addLetter(ch){
  const entry=CUSTOM_LETTERS[ch]; if(!entry) return;
  const {m, gH, gV, gD} = entry;
  const lRows=m.length, lCols=m[0]?.length||1;
  const sx=Math.max(0,+$id('placeX').value), sy=Math.max(0,+$id('placeY').value);
  saveState();

  // ── Place cells ──
  const cells=[];
  m.forEach((row,dy)=>row.forEach((v,dx)=>{
    const x=sx+dx, y=sy+dy;
    if(v&&x<cols&&y<rows){
      grid[y][x]=1; cellColors[`${x},${y}`]=drawColor;
      const el=cellEl(x,y);
      if(el){el.classList.add('filled');el.style.background=drawColor;}
      cells.push({x,y});
    }
  }));

  // ── gapOffsets: store relative (lx,ly) from block's top-left ──
  // so when block moves by (dx,dy), new absolute = (sx+dx+lx, sy+dy+ly)
  const gapOffsets=[];

  // ── Place gapH ──
  if(gH) gH.forEach((row,dy)=>row.forEach((v,dx)=>{
    const ax=sx+dx, ay=sy+dy;
    if(v&&ax<cols&&ay<rows-1){
      gapH[ay][ax]=1; gapHColors[`${ax},${ay}`]=drawColor;
      gapOffsets.push({t:'h', lx:dx, ly:dy});
    }
  }));

  // ── Place gapV ──
  if(gV) gV.forEach((row,dy)=>row.forEach((v,dx)=>{
    const ax=sx+dx, ay=sy+dy;
    if(v&&ax<cols-1&&ay<rows){
      gapV[ay][ax]=1; gapVColors[`${ax},${ay}`]=drawColor;
      gapOffsets.push({t:'v', lx:dx, ly:dy});
    }
  }));

  // ── Place gapD ──
  if(gD) gD.forEach((row,dy)=>row.forEach((v,dx)=>{
    const ax=sx+dx, ay=sy+dy;
    if(v&&ax<cols-1&&ay<rows-1){
      gapD[ay][ax]=1; gapDColors[`${ax},${ay}`]=drawColor;
      gapOffsets.push({t:'d', lx:dx, ly:dy});
    }
  }));

  // ── Refresh radius + render gaps ──
  cells.forEach(({x,y})=>{const el=cellEl(x,y);if(el)el.style.borderRadius=computeCellRadius(x,y);});
  cells.forEach(({x,y})=>refreshRadiusAround(x,y));
  renderGapElements();
  refreshAllRadius();

  const block={id:blockCounter++,ch,cells:[...cells],color:drawColor,gapOffsets,
    // Store the true origin (top-left of letter grid, not just filled cells)
    originX:sx, originY:sy
  };
  blocks.push(block); createBlockOverlay(block);
  if($id('autoAdvance').checked){const nx=sx+lCols+1;$id('placeX').value=nx<cols?nx:0;}
  updateStatus();
}

function createBlockOverlay(block){
  const pad=20, total=cellSz+gapSz;
  if(!block.cells.length) return;
  const div=document.createElement('div');
  div.className='block-overlay'; div.dataset.blockId=block.id;

  function reposition(){
    const xs=block.cells.map(c=>c.x), ys=block.cells.map(c=>c.y);
    const mnX=Math.min(...xs),mnY=Math.min(...ys),mxX=Math.max(...xs),mxY=Math.max(...ys);
    div.style.left=(pad+mnX*total)+'px'; div.style.top=(pad+mnY*total)+'px';
    div.style.width=((mxX-mnX+1)*total)+'px'; div.style.height=((mxY-mnY+1)*total)+'px';
  }
  reposition();

  const lbl=document.createElement('div'); lbl.className='block-overlay-label'; lbl.textContent=block.ch; div.appendChild(lbl);
  const hint=document.createElement('div'); hint.className='block-overlay-hint'; hint.textContent='اسحب للتحريك'; div.appendChild(hint);

  // ── Merge button (tap/click to stamp permanently) ──
  const mergeBtn=document.createElement('button');
  mergeBtn.className='block-merge-btn';
  mergeBtn.title='دمج في اللوحة';
  mergeBtn.innerHTML='✓';
  mergeBtn.addEventListener('pointerdown',e=>{e.stopPropagation();});
  mergeBtn.addEventListener('click',e=>{
    e.stopPropagation();
    stampBlock();
    blocks=blocks.filter(b=>b.id!==block.id);
    div.remove(); updateStatus();
  });
  div.appendChild(mergeBtn);

  let dragStart=null;

  /* Remove all cells + gaps of this block from canvas */
  function eraseBlock(){
    block.cells.forEach(({x,y})=>{
      if(x<0||x>=cols||y<0||y>=rows) return;
      grid[y][x]=0; delete cellColors[`${x},${y}`];
      const el=cellEl(x,y);
      if(el){el.classList.remove('filled');el.style.background='';el.style.borderRadius=`${cellRad}px`;}
    });
    if(block.gapOffsets) block.gapOffsets.forEach(({t,lx,ly})=>{
      const ax=block.originX+lx, ay=block.originY+ly;
      if(t==='h'&&ay>=0&&ay<rows-1&&ax>=0&&ax<cols){gapH[ay][ax]=0;delete gapHColors[`${ax},${ay}`];}
      else if(t==='v'&&ay>=0&&ay<rows&&ax>=0&&ax<cols-1){gapV[ay][ax]=0;delete gapVColors[`${ax},${ay}`];}
      else if(t==='d'&&ay>=0&&ay<rows-1&&ax>=0&&ax<cols-1){gapD[ay][ax]=0;delete gapDColors[`${ax},${ay}`];}
    });
    block.cells.forEach(({x,y})=>{if(x>=0&&x<cols&&y>=0&&y<rows)refreshRadiusAround(x,y);});
  }

  /* Write all cells + gaps of this block to canvas */
  function stampBlock(){
    block.cells.forEach(({x,y})=>{
      if(x<0||x>=cols||y<0||y>=rows) return;
      grid[y][x]=1; cellColors[`${x},${y}`]=block.color;
      const el=cellEl(x,y);
      if(el){el.classList.add('filled');el.style.background=block.color;}
    });
    if(block.gapOffsets) block.gapOffsets.forEach(({t,lx,ly})=>{
      const ax=block.originX+lx, ay=block.originY+ly;
      if(t==='h'&&ax>=0&&ax<cols&&ay>=0&&ay<rows-1){gapH[ay][ax]=1;gapHColors[`${ax},${ay}`]=block.color;}
      else if(t==='v'&&ax>=0&&ax<cols-1&&ay>=0&&ay<rows){gapV[ay][ax]=1;gapVColors[`${ax},${ay}`]=block.color;}
      else if(t==='d'&&ax>=0&&ax<cols-1&&ay>=0&&ay<rows-1){gapD[ay][ax]=1;gapDColors[`${ax},${ay}`]=block.color;}
    });
    block.cells.forEach(({x,y})=>{if(x>=0&&x<cols&&y>=0&&y<rows){const el=cellEl(x,y);if(el)el.style.borderRadius=computeCellRadius(x,y);}});
    block.cells.forEach(({x,y})=>{if(x>=0&&x<cols&&y>=0&&y<rows)refreshRadiusAround(x,y);});
    renderGapElements(); refreshAllRadius();
  }

  div.addEventListener('pointerdown',e=>{
    e.stopPropagation(); e.preventDefault();
    div.setPointerCapture(e.pointerId);
    saveState();
    dragStart={
      mx:e.clientX, my:e.clientY,
      origCells:block.cells.map(c=>({...c})),
      origOriginX:block.originX,
      origOriginY:block.originY,
      lastDdx:0, lastDdy:0
    };
    eraseBlock();
    renderGapElements(); refreshAllRadius();
  });

  div.addEventListener('pointermove',e=>{
    if(!dragStart) return;
    e.stopPropagation();
    const T=cellSz+gapSz;
    const ddx=Math.round((e.clientX-dragStart.mx)/(T*zoom));
    const ddy=Math.round((e.clientY-dragStart.my)/(T*zoom));
    if(ddx===dragStart.lastDdx && ddy===dragStart.lastDdy) return;
    const nc=dragStart.origCells.map(c=>({x:c.x+ddx,y:c.y+ddy}));
    if(!nc.every(c=>c.x>=0&&c.x<cols&&c.y>=0&&c.y<rows)) return;
    dragStart.lastDdx=ddx; dragStart.lastDdy=ddy;
    // Erase ghost at old position
    eraseBlock();
    // Update block position
    block.cells=nc;
    block.originX=dragStart.origOriginX+ddx;
    block.originY=dragStart.origOriginY+ddy;
    // Stamp at new position
    stampBlock();
    reposition();
  });

  div.addEventListener('pointerup',e=>{
    if(!dragStart) return;
    try{div.releasePointerCapture(e.pointerId);}catch(_){}
    stampBlock();
    dragStart=null;
    updateStatus(); reposition();
  });

  div.addEventListener('pointercancel',e=>{
    if(!dragStart) return;
    eraseBlock();
    block.cells=dragStart.origCells;
    block.originX=dragStart.origOriginX;
    block.originY=dragStart.origOriginY;
    stampBlock();
    dragStart=null; reposition();
  });

  // dblclick as fallback for desktop
  div.addEventListener('dblclick',e=>{
    e.stopPropagation();
    stampBlock();
    blocks=blocks.filter(b=>b.id!==block.id);
    div.remove(); updateStatus();
  });

  gc.appendChild(div);
}

/* ══════════ BOTTOM SHEET ══════════ */
const bsOverlay=$id('sheetOverlay');
const bsSheet=$id('bottomSheet');
const bsContent=$id('bsContent');
let currentSheet=null;

function openSheet(tabName){
  if(currentSheet===tabName && bsSheet.classList.contains('open')){
    closeSheet(); return;
  }
  currentSheet=tabName;
  bsContent.innerHTML='';
  const pane=$id('tab-'+tabName);
  if(pane) bsContent.appendChild(pane);
  document.querySelectorAll('.bs-tab').forEach(t=>t.classList.toggle('active',t.dataset.sheet===tabName));
  document.querySelectorAll('[data-sheet]').forEach(b=>b.classList.toggle('sheet-active',b.dataset.sheet===tabName && b.tagName==='BUTTON'));
  // Force overlay visible (desktop had display:none)
  bsOverlay.style.display='flex';
  bsOverlay.classList.add('open');
  // Next frame so CSS transition fires
  requestAnimationFrame(()=>{ requestAnimationFrame(()=>bsSheet.classList.add('open')); });
  sessionStorage.setItem('lastSheet', tabName);
}

function closeSheet(){
  bsSheet.classList.remove('open');
  bsOverlay.classList.remove('open');
  document.querySelectorAll('[data-sheet]').forEach(b=>b.classList.remove('sheet-active'));
  const cleanup=()=>{
    if(currentSheet){
      const pane=$id('tab-'+currentSheet);
      if(pane) $id('tabPanesStore').appendChild(pane);
    }
    currentSheet=null;
    // On desktop: re-apply display:none via CSS :not(.open) rule
    bsOverlay.style.display='';
  };
  // Wait for animation then clean up
  setTimeout(cleanup, 350);
}
$id('bsClose').addEventListener('click',closeSheet);
// Click on overlay background (not the sheet itself) → close
bsOverlay.addEventListener('click',e=>{
  if(e.target===bsOverlay) closeSheet();
});

// Bottom sheet tabs (switch tab within open sheet)
document.querySelectorAll('.bs-tab').forEach(t=>{
  t.addEventListener('click',()=>openSheet(t.dataset.sheet));
});
// Topbar sheet buttons
document.querySelectorAll('[data-sheet]').forEach(b=>{
  if(b.tagName==='BUTTON') b.addEventListener('click',()=>openSheet(b.dataset.sheet));
});

/* ══════════ SESSION STORAGE ══════════ */
const SESSION_KEY='kufi_session';
const SETTINGS_KEY='kufi_settings';

function saveSession(){
  try{
    const data={
      cols,rows,
      grid:grid.map(r=>[...r]),
      gapH:gapH.map(r=>[...r]),
      gapV:gapV.map(r=>[...r]),
      gapD:gapD.map(r=>[...r]),
      cellColors:{...cellColors},
      gapHColors:{...gapHColors},
      gapVColors:{...gapVColors},
      gapDColors:{...gapDColors},
      drawColor,bgProps:{...bgProps},
      bgImg: bgImg ? bgImg.substring(0,100)+'...' : null, // don't store full image in session
      bgVisible,
      ts:Date.now()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  }catch(e){/* quota exceeded */}
}

function loadSession(data){
  initGrid(data.cols||24, data.rows||24);
  grid=data.grid||grid;
  if(data.gapH)gapH=data.gapH;
  if(data.gapV)gapV=data.gapV;
  if(data.gapD)gapD=data.gapD;
  if(data.cellColors)cellColors=data.cellColors;
  if(data.gapHColors)gapHColors=data.gapHColors;
  if(data.gapVColors)gapVColors=data.gapVColors;
  if(data.gapDColors)gapDColors=data.gapDColors;
  if(data.drawColor){drawColor=data.drawColor;$id('fillColor').value=drawColor;$id('quickColor').value=drawColor;$id('colorPreview').style.background=drawColor; if(typeof buildSwatches==='function')buildSwatches();}
  if(data.bgProps)Object.assign(bgProps,data.bgProps);
  bgVisible=data.bgVisible!==undefined?data.bgVisible:true;
  renderGrid();
}

function saveSettings(){
  const s={cellSz,gapSz,cellRad,drawColor};
  localStorage.setItem(SETTINGS_KEY,JSON.stringify(s));
}
function loadSettings(){
  try{
    const s=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}');
    if(s.drawColor){drawColor=s.drawColor;$id('fillColor').value=drawColor;$id('quickColor').value=drawColor;$id('colorPreview').style.background=drawColor; if(typeof buildSwatches==='function')buildSwatches();}
    if(s.cellSz){cellSz=s.cellSz;$id('cellSizeR').value=cellSz;$id('cellSizeVal').textContent=cellSz;document.documentElement.style.setProperty('--cell-size',cellSz+'px');}
    if(s.gapSz){gapSz=s.gapSz;$id('gapSizeR').value=gapSz;$id('gapSizeVal').textContent=gapSz;document.documentElement.style.setProperty('--gap',gapSz+'px');}
    if(s.cellRad){cellRad=s.cellRad;$id('cellRadR').value=cellRad;$id('cellRadVal').textContent=cellRad;}
  }catch(e){}
}

// Auto-save session every 30s and on grid changes
let sessionTimer=null;
function scheduleSessionSave(){
  clearTimeout(sessionTimer);
  sessionTimer=setTimeout(saveSession, 2000);
}

/* ══════════ WELCOME SCREEN ══════════ */
function initWelcome(){
  // ── Handle PWA shortcuts query params ──
  const params = new URLSearchParams(location.search);
  if(params.get('new')==='1'){
    // Skip welcome, start fresh
    enterApp();
    return;
  }
  if(params.get('view')==='letters'){
    // Skip welcome, open letters sheet
    enterApp();
    setTimeout(()=>openSheet('letters'), 300);
    return;
  }
  if(params.get('view') === 'about'){
    // Skip welcome, open letters sheet
    enterApp();
    setTimeout(()=> openSheet('about'), 300);
    return;
  }
  const stored=localStorage.getItem(SESSION_KEY);
  let session=null;
  try{session=stored?JSON.parse(stored):null;}catch(e){}

  if(session && session.ts){
    const age=Math.round((Date.now()-session.ts)/60000);
    const ageStr=age<60?`${age} دقيقة`:`${Math.round(age/60)} ساعة`;
    $id('wlRestore').style.display='flex';
    $id('wlRestoreDesc').textContent=`منذ ${ageStr}`;
    $id('wlInfo').textContent=`${session.cols||24}×${session.rows||24} • آخر حفظ ${ageStr} مضت`;
  }

  $id('wlNew').addEventListener('click',()=>{
    $id('wlNew').style.outline='2px solid var(--accent)';
    $id('wlRestore').style.outline='';
  });
  $id('wlRestore')?.addEventListener('click',()=>{
    $id('wlRestore').style.outline='2px solid var(--accent)';
    $id('wlNew').style.outline='';
  });
  $id('wlLoad').addEventListener('click',()=>{
    const inp=document.createElement('input'); inp.type='file'; inp.accept='.json';
    inp.onchange=async e=>{
      const f=e.target.files[0]; if(!f) return;
      const rd=new FileReader();
      rd.onload=ev=>{
        try{
          const d=JSON.parse(ev.target.result);
          loadSession(d);
          enterApp();
        }catch(er){alert('خطأ في الملف');}
      };
      rd.readAsText(f);
    };
    inp.click();
  });

  $id('wlEnter').addEventListener('click',()=>{
    const restoreSelected=$id('wlRestore').style.outline.includes('accent');
    if(restoreSelected && session){
      loadSession(session);
    }
    enterApp();
  });
  // Default: if session exists, pre-select restore
  if(session) $id('wlRestore').click();
  else $id('wlNew').click();
}

function enterApp(){
  $id('welcomeScreen').classList.add('hidden');
  // Save settings whenever sliders change
  ['cellSizeR','gapSizeR','cellRadR','fillColor'].forEach(id=>{
    const el=$id(id); if(el) el.addEventListener('change',saveSettings);
  });
  scheduleSessionSave();
}

/* ══════════ ACTIONS ══════════ */
$id('btnUndo').addEventListener('click',undo);
$id('btnRedo').addEventListener('click',redo);
$id('btnClear').addEventListener('click',()=>showConfirm('مسح كل المحتوى؟',()=>{
  saveState();
  grid=grid.map(r=>r.map(()=>0));
  gapH=gapH.map(r=>r.map(()=>0));
  gapV=gapV.map(r=>r.map(()=>0));
  gapD=gapD.map(r=>r.map(()=>0));
  cellColors={}; gapHColors={}; gapVColors={}; gapDColors={};
  blocks=[]; document.querySelectorAll('.block-overlay').forEach(e=>e.remove());
  renderGrid();
}));

$id('btnReset').addEventListener('click',()=>showConfirm('إعادة تهيئة شاملة؟ سيتم مسح كل البيانات والإعدادات.',async()=>{
  try{ localStorage.clear(); }catch(e){}
  try{
    if('caches' in window){
      const keys=await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k)));
    }
  }catch(e){}
  try{
    if(navigator.serviceWorker){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
  }catch(e){}
  location.reload(true);
}));

/* ══════════ EXPORT ══════════ */
function exportCanvas(withBg){
  const canvas=document.createElement('canvas');
  const total=cellSz+gapSz, pad=10;
  canvas.width=cols*total+pad*2; canvas.height=rows*total+pad*2;
  const ctx=canvas.getContext('2d');
  // Background
  ctx.fillStyle=getComputedStyle(vp).backgroundColor||'#0A0C10';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  // BG image
  if(withBg&&bgImg&&bgVisible){
    const im=new Image(); im.src=bgImg;
    ctx.save();
    ctx.globalAlpha=bgProps.opacity;
    const bm={multiply:'multiply',screen:'screen',overlay:'overlay',lighten:'lighten',darken:'darken',normal:'source-over'};
    ctx.globalCompositeOperation=bm[bgProps.blend]||'source-over';
    const cx=pad+bgProps.x+bgProps.w/(2*zoom), cy=pad+bgProps.y+bgProps.h/(2*zoom);
    ctx.translate(cx,cy); ctx.rotate(bgProps.rotate*Math.PI/180);
    try{ctx.drawImage(im,-bgProps.w/(2*zoom),-bgProps.h/(2*zoom),bgProps.w/zoom,bgProps.h/zoom);}catch(er){}
    ctx.restore();
  }
  // Gap H
  for(let gy=0;gy<rows-1;gy++) for(let gx=0;gx<cols;gx++){
    if(!gapH[gy][gx]) continue;
    ctx.fillStyle=gapHColors[`${gx},${gy}`]||drawColor;
    ctx.fillRect(pad+gx*total, pad+(gy+1)*total-gapSz, cellSz, gapSz);
  }
  // Gap V
  for(let gy=0;gy<rows;gy++) for(let gx=0;gx<cols-1;gx++){
    if(!gapV[gy][gx]) continue;
    ctx.fillStyle=gapVColors[`${gx},${gy}`]||drawColor;
    ctx.fillRect(pad+(gx+1)*total-gapSz, pad+gy*total, gapSz, cellSz);
  }
  // Gap D
  for(let gy=0;gy<rows-1;gy++) for(let gx=0;gx<cols-1;gx++){
    if(!gapD[gy][gx]) continue;
    ctx.fillStyle=gapDColors[`${gx},${gy}`]||drawColor;
    ctx.fillRect(pad+(gx+1)*total-gapSz, pad+(gy+1)*total-gapSz, gapSz, gapSz);
  }
  // Cells with smart radius
  grid.forEach((row,y)=>row.forEach((v,x)=>{
    if(!v) return;
    ctx.fillStyle=cellColors[`${x},${y}`]||drawColor;
    const rx=pad+x*total, ry=pad+y*total;
    if(cellRad>0){
      const radStr=computeCellRadius(x,y).replace(/px/g,'').split(' ').map(Number);
      const[rtl,rtr,rbr,rbl]=[radStr[0],radStr[1],radStr[2],radStr[3]];
      ctx.beginPath();
      ctx.moveTo(rx+rtl,ry); ctx.lineTo(rx+cellSz-rtr,ry);
      ctx.arcTo(rx+cellSz,ry,rx+cellSz,ry+rtr,rtr);
      ctx.lineTo(rx+cellSz,ry+cellSz-rbr);
      ctx.arcTo(rx+cellSz,ry+cellSz,rx+cellSz-rbr,ry+cellSz,rbr);
      ctx.lineTo(rx+rbl,ry+cellSz);
      ctx.arcTo(rx,ry+cellSz,rx,ry+cellSz-rbl,rbl);
      ctx.lineTo(rx,ry+rtl);
      ctx.arcTo(rx,ry,rx+rtl,ry,rtl);
      ctx.closePath(); ctx.fill();
    } else ctx.fillRect(rx,ry,cellSz,cellSz);
  }));
  const a=document.createElement('a');
  a.download=`kufidraw_${Date.now()}.png`;
  a.href=canvas.toDataURL('image/png'); a.click();
}
$id('exportPNG').addEventListener('click',()=>exportCanvas(false));
$id('exportWithBg').addEventListener('click',()=>exportCanvas(true));
$id('btnExport').addEventListener('click',()=>exportCanvas(true));

/* ══════════ SAVE/LOAD ══════════ */
$id('btnSaveJSON').addEventListener('click',()=>{
  const data={cols,rows,grid,gapH,gapV,gapD,cellColors,gapHColors,gapVColors,gapDColors,drawColor,bgProps,bgImg,bgVisible,v:7};
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
  a.download=`kufidraw_${Date.now()}.json`; a.click();
});
$id('btnLoadJSON').addEventListener('click',()=>$id('loadFileInput').click());
$id('loadFileInput').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=ev=>{ loadKufiJSON(ev.target.result); };
  rd.readAsText(f); e.target.value='';
});

/* ══════════ MODAL ══════════ */
let _cb=null;
function showConfirm(msg,ok){_cb=ok;$id('modalMsg').textContent=msg;$id('modalOverlay').classList.add('open');}
$id('modalOk').addEventListener('click',()=>{$id('modalOverlay').classList.remove('open');if(_cb)_cb();_cb=null;});
$id('modalCancel').addEventListener('click',()=>{$id('modalOverlay').classList.remove('open');_cb=null;});

/* ══════════ KEYBOARD ══════════ */
window.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();undo();}
  if((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.shiftKey&&e.key==='Z'))){e.preventDefault();redo();}
  if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();exportCanvas(true);}
  if(!e.ctrlKey&&!e.metaKey){
    if(e.key==='b'||e.key==='B')setTool('draw');
    if(e.key==='e'||e.key==='E')setTool('erase');
    if(e.key==='f'||e.key==='F')setTool('fill');
    if(e.key==='h'||e.key==='H')setTool('pan');
  }
});

/* ══════════ INIT ══════════ */
(async()=>{
  await openDB();
  await loadMergedLetters();
  loadSettings();
  initGrid(24,24);
  buildLetters();
  buildSwatches();
  setTool('draw');
  initRulers();
  // Hook grid changes for session autosave
  const origRenderGrid=renderGrid;
  window.renderGrid=function(){origRenderGrid.apply(this,arguments);scheduleSessionSave?.();};
  initWelcome();
})();

/* ══════════ SHARE TARGET ══════════ */
/* -- صورة مرجعية -- */
if(location.search.includes('share-target')){
  window.addEventListener('load', async ()=>{
    try{
      // صورة
      const imgCache = await caches.open('kufimaker-share');
      const imgRes   = await imgCache.match('shared-image');
      if(imgRes){
        const blob = await imgRes.blob();
        const url  = URL.createObjectURL(blob);
        await imgCache.delete('shared-image');
        setTimeout(()=>{
          setBgImage(url);
          if($id('bgDraggable')) $id('bgDraggable').checked=true;
          openSheet('bg');
        }, 600);
        return;
      }
      // ملف JSON
      const jsonCache = await caches.open('kufimaker-share');
      const jsonRes   = await jsonCache.match('shared-json');
      if(jsonRes){
        const text = await jsonRes.text();
        await jsonCache.delete('shared-json');
        setTimeout(()=>{ loadKufiJSON(text); }, 600);
      }
    }catch(e){ console.warn('[ShareTarget]', e); }
  });
}

/* دالة موحدة لتحميل JSON بتحقق من الصحة */
function loadKufiJSON(text){
  try{
    const d = JSON.parse(text);
    // تحقق بسيط: يجب أن يحتوي على cols و rows و grid
    if(!d.cols || !d.rows || !Array.isArray(d.grid)){
      showConfirm('الملف غير صحيح أو ليس ملف kufiMaker', null);
      return;
    }
    initGrid(d.cols, d.rows);
    grid = d.grid;
    if(d.gapH)gapH=d.gapH; if(d.gapV)gapV=d.gapV; if(d.gapD)gapD=d.gapD;
    if(d.cellColors)cellColors=d.cellColors;
    if(d.gapHColors)gapHColors=d.gapHColors;
    if(d.gapVColors)gapVColors=d.gapVColors;
    if(d.gapDColors)gapDColors=d.gapDColors;
    if(d.drawColor){drawColor=d.drawColor;$id('fillColor').value=drawColor;$id('quickColor').value=drawColor;$id('colorPreview').style.background=drawColor;if(typeof buildSwatches==='function')buildSwatches();}
    if(d.bgProps)Object.assign(bgProps,d.bgProps);
    if(d.bgImg){bgImg=d.bgImg;applyBg();updateBgPreview(d.bgImg);const c=$id('bgControls');if(c)c.style.display='flex';}
    renderGrid();
  }catch(err){
    showConfirm('الملف غير صحيح أو تالف — تعذّر تحميله', null);
  }
}

/* ══════════ PWA INSTALL ══════════ */
let deferredPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();
  deferredPrompt=e;
  const btn=$id('btnInstall');
  if(btn) btn.style.display='';
});
$id('btnInstall')?.addEventListener('click',async()=>{
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  const{outcome}=await deferredPrompt.userChoice;
  if(outcome==='accepted') $id('btnInstall').style.display='none';
  deferredPrompt=null;
});
window.addEventListener('appinstalled',()=>{
  const btn=$id('btnInstall');
  if(btn) btn.style.display='none';
  deferredPrompt=null;
});

/* ══════════ SERVICE WORKER REGISTRATION ══════════ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/kufiMaker/sw.js', { scope: '/kufiMaker/' })
      .then(reg => console.log('[SW] Registered, scope:', reg.scope))
      .catch(err => console.warn('[SW] Registration failed:', err));
  });
}
