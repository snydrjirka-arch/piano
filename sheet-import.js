/* Experimental sheet music image importer for snydrjirka-arch/piano.
   No build required. External dependency: Tesseract.js CDN for chord OCR.
   Recognition of noteheads is heuristic and limited to clean, horizontal single-staff scans.
*/
(()=>{'use strict';
const mount=()=>{
 const toolbar=document.querySelector('#importMidi')?.parentElement;
 if(!toolbar)return;
 const btn=document.createElement('button');btn.className='btn';btn.textContent='📷 Import not (obrázek)';
 toolbar.insertBefore(btn,document.querySelector('#importMidi').nextSibling);
 const dialog=document.createElement('dialog');dialog.style.cssText='max-width:min(960px,96vw);width:96vw;border:1px solid #d9d6e5;border-radius:20px;padding:24px;color:#25242b';
 dialog.innerHTML=`<form method="dialog" style="float:right"><button class="btn" aria-label="Zavřít">✕</button></form><h2>📷 Noty z obrázku → MIDI (experimentální)</h2><p>Rozpoznání je experimentální. Osnovy hledáme i při mírném naklonění; před importem oprav výšku a délky not. Akordy zkontroluj ručně.</p><p><input id="omrFile" type="file" accept="image/png,image/jpeg,image/webp"><label style="margin-left:12px">Tempo <input id="omrTempo" type="number" value="90" min="30" max="240" style="width:72px"></label><label style="margin-left:12px">Takt <select id="omrMeter"><option value="4">4/4</option><option value="3">3/4</option><option value="2">2/4</option></select></label></p><div style="max-height:40vh;overflow:auto"><canvas id="omrCanvas" style="width:100%;height:auto;border:1px solid #ddd"></canvas></div><p id="omrStatus" aria-live="polite">Nahraj sken not.</p><p><button id="omrScan" class="btn" type="button" disabled>1. Rozpoznat noty</button><button id="omrChords" class="btn" type="button" disabled>2. Zkusit přečíst akordy</button></p><label>Akordy nad takty (odděl čárkami; např. C, Am, G, Dm, G, C):<textarea id="omrChordText" rows="2" style="width:100%;font:inherit;border-radius:8px;padding:8px"></textarea></label><p><label><input id="omrAddChords" type="checkbox" checked> Přidat do MIDI akordový doprovod (levá ruka)</label> <label><input id="omrOnlyMelody" type="checkbox"> Jen akordy, bez automaticky čtené melodie</label></p><p id="omrReview" style="font-size:13px;white-space:pre-wrap"></p><label>Úprava melodie (jeden tón na řádek: C4 1, D4 0.5, E4 2; délka v dobách):<textarea id="omrMelodyEdit" rows="7" spellcheck="false" style="display:block;width:100%;font:14px monospace;border:1px solid #ccd;border-radius:9px;padding:9px;margin:7px 0" placeholder="C4 1&#10;D4 0.5&#10;E4 2"></textarea></label><p style="font-size:12px;color:#666">Po rozpoznání se pole vyplní. Nejsou-li noty rozpoznány, můžeš melodii zadat ručně. Rytmus i taktové čáry automatika zatím neurčuje spolehlivě.</p><p><button id="omrLoad" class="btn primary" type="button" disabled>3. Vložit do trenažéru</button> <button id="omrSave" class="btn" type="button" disabled>Stáhnout MIDI</button></p>`;
 document.body.appendChild(dialog);btn.addEventListener('click',()=>dialog.showModal());
 const q=s=>dialog.querySelector(s), status=s=>q('#omrStatus').textContent=s;
 let bmp=null,detected=[],previewCanvas=q('#omrCanvas'),ctx=previewCanvas.getContext('2d',{willReadFrequently:true});
 const staffForY=(y,sets)=>sets.reduce((best,s)=>Math.abs(y-s[2])<Math.abs(y-(best?.[2]??1e9))?s:best,null);
  function scan(){
   if(!bmp)return;
   const scale=Math.min(1,1700/bmp.width),w=Math.round(bmp.width*scale),h=Math.round(bmp.height*scale);
   previewCanvas.width=w;previewCanvas.height=h;ctx.drawImage(bmp,0,0,w,h);
   const px=ctx.getImageData(0,0,w,h).data;
   const dark=(x,y)=>{if(x<0||x>=w||y<0||y>=h)return false;const i=(Math.round(y)*w+Math.round(x))*4;return px[i]*.299+px[i+1]*.587+px[i+2]*.114<165};
   // The score may be tilted. Rather than counting a full-width row, detect
   // the five-line pattern in several narrow vertical image slices.
   const slices=[],sliceWidth=Math.max(90,Math.round(w*.13));
   for(let x0=Math.round(w*.08);x0+sliceWidth<w*.94;x0+=Math.round(sliceWidth*.82)){
    const sums=new Float32Array(h);
    for(let y=2;y<h-2;y++){
     let n=0;for(let x=x0;x<x0+sliceWidth;x+=2)if(dark(x,y))n++;
     sums[y]=n/(sliceWidth/2);
    }
    const peaks=[];
    for(let y=3;y<h-3;y++)if(sums[y]>.27&&sums[y]>=sums[y-1]&&sums[y]>=sums[y+1]){
     if(peaks.length&&y-peaks[peaks.length-1].y<=3){if(sums[y]>peaks[peaks.length-1].v)peaks[peaks.length-1]={y,v:sums[y]}}
     else peaks.push({y,v:sums[y]});
    }
    const staff=[];
    for(let i=0;i<peaks.length;i++)for(let d=8;d<=27;d++){
     let matched=[peaks[i]],weight=peaks[i].v;
     for(let j=1;j<5;j++){
      const ideal=peaks[i].y+j*d;
      const other=peaks.filter(t=>Math.abs(t.y-ideal)<=Math.max(2,d*.22)).sort((u,v)=>Math.abs(u.y-ideal)-Math.abs(v.y-ideal))[0];
      if(!other)break;matched.push(other);weight+=other.v;
     }
     if(matched.length===5&&weight>1.8){const top=matched[0].y; if(!staff.some(t=>Math.abs(t.top-top)<d*2))staff.push({x:x0+sliceWidth/2,top,spacing:d,weight});}
    }
    slices.push(...staff);
   }
   // Combine staff sightings across neighbouring slices into horizontal systems.
   slices.sort((a,b)=>a.top-b.top);const clusters=[];
   for(const sight of slices){let match=clusters.filter(c=>Math.abs(c.top-sight.top)<Math.max(15,sight.spacing*1.8)).sort((a,b)=>Math.abs(a.top-sight.top)-Math.abs(b.top-sight.top))[0];
    if(!match){match={top:sight.top,spacing:sight.spacing,parts:[]};clusters.push(match)}
    match.parts.push(sight);match.top=match.parts.reduce((sum,p)=>sum+p.top,0)/match.parts.length;
   }
   let staffs=clusters.filter(c=>c.parts.length>=2).sort((a,b)=>a.top-b.top);
   // For slanted scores interpolate staff location using the observed slices.
   const at=(staff,x)=>{const pts=staff.parts.slice().sort((a,b)=>a.x-b.x);if(x<=pts[0].x)return pts[0];if(x>=pts[pts.length-1].x)return pts[pts.length-1];let i=1;while(pts[i].x<x)i++;const l=pts[i-1],r=pts[i],t=(x-l.x)/(r.x-l.x);return {top:l.top+(r.top-l.top)*t,spacing:l.spacing+(r.spacing-l.spacing)*t}};
   detected=[];
   const stepsMidi=[64,65,67,69,71,72,74];
   for(const staff of staffs){
    let candidates=[];const avg=staff.spacing;
    for(let x=Math.round(w*.13);x<w*.94;x+=2){
     const loc=at(staff,x),step=loc.spacing/2,bottom=loc.top+4*loc.spacing;
     for(let k=-3;k<=12;k++){
      const y=Math.round(bottom-k*step);if(y<6||y>=h-6)continue;
      const hw=Math.max(4,Math.round(step*.85)),hh=Math.max(2,Math.round(step*.62));
      let on=0,count=0;
      // Ignore a single center row, reducing staff-only false positives.
      for(let dy=-hh;dy<=hh;dy++)for(let dx=-hw;dx<=hw;dx++){
       if(Math.abs(dy)<=1)continue;count++;if(dark(x+dx,y+dy))on++;
      }
      const density=on/count;
      if(density>.42&&density<.92)candidates.push({x,y,k,density});
     }
    }
    candidates.sort((a,b)=>a.x-b.x);
    const groups=[];
    for(const c of candidates){let g=groups.find(g=>Math.abs(g.x-c.x)<Math.max(5,avg*.72)&&g.k===c.k);
     if(g){g.points.push(c);g.x=(g.x*(g.points.length-1)+c.x)/g.points.length;g.y=(g.y*(g.points.length-1)+c.y)/g.points.length}
     else groups.push({x:c.x,y:c.y,k:c.k,points:[c]});
    }
    const good=groups.filter(g=>g.points.length>=Math.max(2,Math.round(avg*.18)))
      .filter(g=>g.x>w*.16).sort((a,b)=>a.x-b.x||a.k-b.k);
    for(const g of good){const oct=Math.floor(g.k/7),index=((g.k%7)+7)%7,midi=stepsMidi[index]+oct*12;
     if(midi>=48&&midi<=95)detected.push({midi,x:g.x,y:g.y,staff:staff.top,duration:1});
    }
   }
   detected.sort((a,b)=>a.staff-b.staff||a.x-b.x);
   // If several candidate noteheads overlap, keep a single plausible one.
   detected=detected.filter((n,i,arr)=>i===0||Math.abs(n.staff-arr[i-1].staff)>12||Math.abs(n.x-arr[i-1].x)>Math.max(8,staffs.find(s=>Math.abs(s.top-n.staff)<20)?.spacing||12));
   q('#omrMelodyEdit').value=detected.map(n=>name(n.midi)+' 1').join('\n');
   status(`Nalezeno ${staffs.length} notových osnov a ${detected.length} kandidátů. ${detected.length?'Zkontroluj a oprav melodii níže.':'Automatické rozpoznání nevyšlo. MIDI z prázdné melodie nevytvářím; můžeš zadat tóny ručně.'}`);
   q('#omrReview').textContent='Automatická melodie (nekontrolovaný návrh): '+(detected.length?detected.slice(0,80).map(n=>name(n.midi)).join(' · '):'žádné noty');
   q('#omrLoad').disabled=q('#omrSave').disabled=!(detected.length||q('#omrChordText').value.trim());
   ctx.strokeStyle='#e11d48';ctx.lineWidth=2;for(const n of detected){ctx.beginPath();ctx.ellipse(n.x,n.y,6,4,0,0,Math.PI*2);ctx.stroke()}
  }
 const name=n=>['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][n%12]+(Math.floor(n/12)-1);
 function chordNotes(text){let m=text.trim().match(/^([A-GH])([#♯b♭]?)(maj7|m7|dim7|sus4|sus2|add9|m|7|dim|aug)?$/i);if(!m)return null;
 let root={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':10,'H':11}[m[1].toUpperCase()];root+=(m[2]==='#'||m[2]==='♯')?1:(m[2]==='b'||m[2]==='♭')?-1:0;
 const kind=(m[3]||'').toLowerCase(),intervals=({m:[0,3,7],m7:[0,3,7,10],maj7:[0,4,7,11],7:[0,4,7,10],dim:[0,3,6],dim7:[0,3,6,9],aug:[0,4,8],sus2:[0,2,7],sus4:[0,5,7],add9:[0,4,7,14]})[kind]||[0,4,7];return intervals.map(i=>48+root+i).filter(n=>n>=48&&n<=95)}
 function vlq(n){n=Math.max(0,Math.round(n));let bytes=[n&127];while(n>>=7)bytes.unshift((n&127)|128);return bytes}
 const be32=n=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255],chunk=(id,bytes)=>[...id.split('').map(x=>x.charCodeAt(0)),...be32(bytes.length),...bytes];
 function editedMelody(){const lines=q('#omrMelodyEdit').value.split(/\n/).map(x=>x.trim()).filter(Boolean),out=[];
 const names={C:0,D:2,E:4,F:5,G:7,A:9,B:11,H:11};
 lines.forEach((line,i)=>{const m=line.match(/^([A-Ha-h])([#♯b♭]?)(-?\d)\s+(0\.25|0\.5|0\.75|1|1\.5|2|3|4)$/);
 if(!m)throw Error(`Neplatná nota na řádku ${i+1}: ${line}. Příklad: C4 1 nebo D4 0.5`);
 let midi=(Number(m[3])+1)*12+names[m[1].toUpperCase()]+((m[2]==='#'||m[2]==='♯')?1:(m[2]==='b'||m[2]==='♭')?-1:0);
 if(midi<48||midi>95)throw Error(`Tón ${line} je mimo rozsah C3–B6.`);out.push({midi,duration:Number(m[4])});});return out;}
 function midi(){let ev=[],beats=+q('#omrMeter').value||4,tempo=+q('#omrTempo').value||90,only=q('#omrOnlyMelody').checked;
 if(!only){let cursor=0;for(const n of editedMelody()){const t=Math.round(cursor*480),len=Math.round(n.duration*480);ev.push({t,bytes:[0x90,n.midi,95]},{t:t+Math.max(1,len-15),bytes:[0x80,n.midi,0]});cursor+=n.duration}}
 if(q('#omrAddChords').checked){const names=q('#omrChordText').value.split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean);names.forEach((c,i)=>{let notes=chordNotes(c);if(!notes)return;let t=i*beats*480;for(const n of notes){ev.push({t,bytes:[0x91,n,65]},{t:t+beats*480-20,bytes:[0x81,n,0]})}})}
 if(!ev.length)throw Error('Žádné rozpoznané noty ani platné akordy.');ev.sort((a,b)=>a.t-b.t||((a.bytes[0]&0xf0)-(b.bytes[0]&0xf0)));let body=[0,255,81,3,...be32(Math.round(60000000/tempo)).slice(1)];let pos=0;for(const e of ev){body.push(...vlq(e.t-pos),...e.bytes);pos=e.t}body.push(0,255,47,0);
 return new Uint8Array([...chunk('MThd',[0,0,0,1,0,1,1,224]),...chunk('MTrk',body)])}
 q('#omrFile').addEventListener('change',async e=>{let f=e.target.files[0];if(!f)return;try{bmp=await createImageBitmap(f);previewCanvas.width=bmp.width;previewCanvas.height=bmp.height;ctx.drawImage(bmp,0,0);detected=[];q('#omrMelodyEdit').value='';q('#omrScan').disabled=q('#omrChords').disabled=false;status('Obrázek načten. Klikni Rozpoznat noty.')}catch(err){status('Nepodařilo se načíst obrázek: '+err.message)}});
 const updateReady=()=>{const valid=q('#omrMelodyEdit').value.trim()||q('#omrChordText').value.trim();q('#omrLoad').disabled=q('#omrSave').disabled=!valid};
 q('#omrMelodyEdit').addEventListener('input',updateReady);q('#omrChordText').addEventListener('input',updateReady);
 q('#omrScan').addEventListener('click',()=>{try{scan()}catch(e){status('Chyba čtení osnov: '+e.message)}});
 q('#omrChords').addEventListener('click',async()=>{if(!bmp)return;status('Načítám OCR a čtu akordové značky…');try{if(!window.Tesseract){await new Promise((resolve,reject)=>{let s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';s.onload=resolve;s.onerror=reject;document.head.append(s)})}let res=await window.Tesseract.recognize(bmp,'eng',{logger:()=>{}});const words=(res.data.words||[]).filter(w=>w.confidence>40).sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0);const chords=words.map(w=>w.text.replace(/[^A-GHa-gh#♯b♭0-9musjdgie]/g,'')).filter(x=>chordNotes(x));q('#omrChordText').value=chords.join(', ');status(`OCR navrhlo ${chords.length} akordových značek. Zkontroluj jejich pořadí, taktování a oprav chybně čtené značky.`);q('#omrLoad').disabled=q('#omrSave').disabled=false;}catch(e){status('OCR se nenačetlo: '+e.message+'. Akordy můžeš zadat ručně.')}});
 q('#omrSave').addEventListener('click',()=>{try{let blob=new Blob([midi()],{type:'audio/midi'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='noty-z-obrazku.mid';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),15000)}catch(e){status(e.message)}});
 q('#omrLoad').addEventListener('click',()=>{try{let data=midi(),file=new File([data],'noty-z-obrazku.mid',{type:'audio/midi'}),dt=new DataTransfer();dt.items.add(file);let input=document.querySelector('#midiFile');if(!input)throw Error('Chybí MIDI import trenažéru.');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));dialog.close()}catch(e){status('Import selhal: '+e.message)}});
 }; if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
