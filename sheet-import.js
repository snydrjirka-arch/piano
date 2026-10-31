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
 dialog.innerHTML=`<form method="dialog" style="float:right"><button class="btn" aria-label="Zavřít">✕</button></form><h2>📷 Noty z obrázku → MIDI (experimentální)</h2><p>Nejlépe funguje rovný sken s jednou houslovou osnovou. Výsledek před importem zkontroluj. Akordové značky lze opravit ručně.</p><p><input id="omrFile" type="file" accept="image/png,image/jpeg,image/webp"><label style="margin-left:12px">Tempo <input id="omrTempo" type="number" value="90" min="30" max="240" style="width:72px"></label><label style="margin-left:12px">Takt <select id="omrMeter"><option value="4">4/4</option><option value="3">3/4</option><option value="2">2/4</option></select></label></p><div style="max-height:40vh;overflow:auto"><canvas id="omrCanvas" style="width:100%;height:auto;border:1px solid #ddd"></canvas></div><p id="omrStatus" aria-live="polite">Nahraj sken not.</p><p><button id="omrScan" class="btn" type="button" disabled>1. Rozpoznat noty</button><button id="omrChords" class="btn" type="button" disabled>2. Zkusit přečíst akordy</button></p><label>Akordy nad takty (odděl čárkami; např. C, Am, G, Dm, G, C):<textarea id="omrChordText" rows="2" style="width:100%;font:inherit;border-radius:8px;padding:8px"></textarea></label><p><label><input id="omrAddChords" type="checkbox" checked> Přidat do MIDI akordový doprovod (levá ruka)</label> <label><input id="omrOnlyMelody" type="checkbox"> Jen akordy, bez automaticky čtené melodie</label></p><p id="omrReview" style="font-size:13px;white-space:pre-wrap"></p><p><button id="omrLoad" class="btn primary" type="button" disabled>3. Vložit do trenažéru</button> <button id="omrSave" class="btn" type="button" disabled>Stáhnout MIDI</button></p>`;
 document.body.appendChild(dialog);btn.addEventListener('click',()=>dialog.showModal());
 const q=s=>dialog.querySelector(s), status=s=>q('#omrStatus').textContent=s;
 let bmp=null,detected=[],previewCanvas=q('#omrCanvas'),ctx=previewCanvas.getContext('2d',{willReadFrequently:true});
 const staffForY=(y,sets)=>sets.reduce((best,s)=>Math.abs(y-s[2])<Math.abs(y-(best?.[2]??1e9))?s:best,null);
 function scan(){if(!bmp)return;let w=bmp.width,h=bmp.height,scale=Math.min(1,1400/w);w=Math.round(w*scale);h=Math.round(h*scale);previewCanvas.width=w;previewCanvas.height=h;ctx.drawImage(bmp,0,0,w,h);
 const p=ctx.getImageData(0,0,w,h).data,dark=(x,y)=>{let i=(y*w+x)*4;return (p[i]*.299+p[i+1]*.587+p[i+2]*.114)<125};
 const rows=[];for(let y=0;y<h;y++){let c=0;for(let x=Math.round(w*.05);x<Math.round(w*.95);x+=2)if(dark(x,y))c++;if(c>w*.25)rows.push(y)}
 const bands=[];for(const y of rows){if(bands.length&&y-bands[bands.length-1].at<=2){const b=bands[bands.length-1];b.sum+=y;b.n++;b.at=y}else bands.push({sum:y,n:1,at:y})}
 let lines=bands.map(b=>b.sum/b.n),sets=[];
 for(let i=0;i+4<lines.length;i++){let cand=lines.slice(i,i+5),d=(cand[4]-cand[0])/4;if(d>5&&d<33&&cand.every((y,k)=>Math.abs(y-(cand[0]+d*k))<d*.22)) {sets.push(cand);i+=4}}
 detected=[];
 for(const s of sets){let step=(s[4]-s[0])/8;let found=[];
 // A notehead is a compact, broad connected dark shape at a staff step.
 for(let x=18;x<w-18;x+=2){for(let k=-4;k<=12;k++){let y=s[4]-k*step;if(y<5||y>h-5)continue;let yy=Math.round(y),boxW=Math.max(4,Math.round(step*1.7)),boxH=Math.max(3,Math.round(step*.95));let black=0,total=0;
 for(let dy=-boxH;dy<=boxH;dy++)for(let dx=-boxW;dx<=boxW;dx+=2){if(yy+dy<0||yy+dy>=h||x+dx<0||x+dx>=w)continue;total++;if(dark(x+dx,yy+dy))black++}
 const density=black/Math.max(1,total);if(density>.48&&density<.95)found.push({x,y:yy,k,density});
 }}
 // Collapse detections nearby into candidate noteheads and remove isolated staff-line artifacts.
 found.sort((a,b)=>a.x-b.x||a.k-b.k);let groups=[];
 for(const n of found){let g=groups.find(g=>Math.abs(g.x-n.x)<step*2&&Math.abs(g.k-n.k)<1);if(g){g.x=(g.x*g.n+n.x)/(g.n+1);g.n++}else groups.push({...n,n:1})}
 groups=groups.filter(g=>g.n>=2).sort((a,b)=>a.x-b.x);
 // Avoid false detection of clef and time signature near the start of each staff.
 if(groups.length){let minX=Math.min(...groups.map(g=>g.x));groups=groups.filter(g=>g.x>minX+step*4)}
 // Treble clef: bottom line E4=64; seven diatonic steps E F G A B C D ...
 const semis=[0,1,3,5,7,8,10],diatonic=[64,65,67,69,71,72,74];
 for(const g of groups){const k=g.k;let index=((k%7)+7)%7,oct=Math.floor(k/7),midi=diatonic[index]+12*oct;
 if(midi>=48&&midi<=95)detected.push({midi,x:g.x,y:g.y,line:s[0]})}
 }
 detected.sort((a,b)=>a.line-b.line||a.x-b.x);
 // Uniform quarter-note timing is only a fallback; printed rhythm requires specialist OMR.
 detected=detected.filter((n,i,a)=>i===0||Math.abs(n.x-a[i-1].x)>5||n.line!==a[i-1].line);
 status(`Nalezeno ${sets.length} osnov a ${detected.length} kandidátů na noty. Pozor: délky not jsou zatím odhadnuté jako čtvrťové; zkontroluj výsledek.`);
 q('#omrReview').textContent='Detekovaná melodie: '+detected.slice(0,80).map(n=>name(n.midi)).join(' · ')+(detected.length>80?' …':'');
 q('#omrLoad').disabled=q('#omrSave').disabled=false;
 ctx.strokeStyle='#d22266';ctx.lineWidth=2;for(let n of detected){ctx.beginPath();ctx.ellipse(n.x,n.y,6,4,0,0,Math.PI*2);ctx.stroke()}
 }
 const name=n=>['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][n%12]+(Math.floor(n/12)-1);
 function chordNotes(text){let m=text.trim().match(/^([A-GH])([#♯b♭]?)(maj7|m7|dim7|sus4|sus2|add9|m|7|dim|aug)?$/i);if(!m)return null;
 let root={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':10,'H':11}[m[1].toUpperCase()];root+=(m[2]==='#'||m[2]==='♯')?1:(m[2]==='b'||m[2]==='♭')?-1:0;
 const kind=(m[3]||'').toLowerCase(),intervals=({m:[0,3,7],m7:[0,3,7,10],maj7:[0,4,7,11],7:[0,4,7,10],dim:[0,3,6],dim7:[0,3,6,9],aug:[0,4,8],sus2:[0,2,7],sus4:[0,5,7],add9:[0,4,7,14]})[kind]||[0,4,7];return intervals.map(i=>48+root+i).filter(n=>n>=48&&n<=95)}
 function vlq(n){n=Math.max(0,Math.round(n));let bytes=[n&127];while(n>>=7)bytes.unshift((n&127)|128);return bytes}
 const be32=n=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255],chunk=(id,bytes)=>[...id.split('').map(x=>x.charCodeAt(0)),...be32(bytes.length),...bytes];
 function midi(){let ev=[],beats=+q('#omrMeter').value||4,tempo=+q('#omrTempo').value||90,only=q('#omrOnlyMelody').checked;
 if(!only)detected.forEach((n,i)=>{let t=i*480;ev.push({t,bytes:[0x90,n.midi,95]},{t:t+440,bytes:[0x80,n.midi,0]})});
 if(q('#omrAddChords').checked){const names=q('#omrChordText').value.split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean);names.forEach((c,i)=>{let notes=chordNotes(c);if(!notes)return;let t=i*beats*480;for(const n of notes){ev.push({t,bytes:[0x91,n,65]},{t:t+beats*480-20,bytes:[0x81,n,0]})}})}
 if(!ev.length)throw Error('Žádné rozpoznané noty ani platné akordy.');ev.sort((a,b)=>a.t-b.t||((a.bytes[0]&0xf0)-(b.bytes[0]&0xf0)));let body=[0,255,81,3,...be32(Math.round(60000000/tempo)).slice(1)];let pos=0;for(const e of ev){body.push(...vlq(e.t-pos),...e.bytes);pos=e.t}body.push(0,255,47,0);
 return new Uint8Array([...chunk('MThd',[0,0,0,1,0,1,1,224]),...chunk('MTrk',body)])}
 q('#omrFile').addEventListener('change',async e=>{let f=e.target.files[0];if(!f)return;try{bmp=await createImageBitmap(f);previewCanvas.width=bmp.width;previewCanvas.height=bmp.height;ctx.drawImage(bmp,0,0);detected=[];q('#omrScan').disabled=q('#omrChords').disabled=false;status('Obrázek načten. Klikni Rozpoznat noty.')}catch(err){status('Nepodařilo se načíst obrázek: '+err.message)}});
 q('#omrScan').addEventListener('click',()=>{try{scan()}catch(e){status('Chyba čtení osnov: '+e.message)}});
 q('#omrChords').addEventListener('click',async()=>{if(!bmp)return;status('Načítám OCR a čtu akordové značky…');try{if(!window.Tesseract){await new Promise((resolve,reject)=>{let s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';s.onload=resolve;s.onerror=reject;document.head.append(s)})}let res=await window.Tesseract.recognize(bmp,'eng',{logger:()=>{}});const words=(res.data.words||[]).filter(w=>w.confidence>40).sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0);const chords=words.map(w=>w.text.replace(/[^A-GHa-gh#♯b♭0-9musjdgie]/g,'')).filter(x=>chordNotes(x));q('#omrChordText').value=chords.join(', ');status(`OCR navrhlo ${chords.length} akordových značek. Zkontroluj jejich pořadí, taktování a oprav chybně čtené značky.`);q('#omrLoad').disabled=q('#omrSave').disabled=false;}catch(e){status('OCR se nenačetlo: '+e.message+'. Akordy můžeš zadat ručně.')}});
 q('#omrSave').addEventListener('click',()=>{try{let blob=new Blob([midi()],{type:'audio/midi'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='noty-z-obrazku.mid';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),15000)}catch(e){status(e.message)}});
 q('#omrLoad').addEventListener('click',()=>{try{let data=midi(),file=new File([data],'noty-z-obrazku.mid',{type:'audio/midi'}),dt=new DataTransfer();dt.items.add(file);let input=document.querySelector('#midiFile');if(!input)throw Error('Chybí MIDI import trenažéru.');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));dialog.close()}catch(e){status('Import selhal: '+e.message)}});
 }; if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
