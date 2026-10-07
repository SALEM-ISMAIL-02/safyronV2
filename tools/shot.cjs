// Screenshot harness, via CDP.
// Scrolls the page to a given position within an act and captures a PNG,
// reporting the telemetry readout for that scroll position.
//
//   usage: node tools/shot.cjs <url> <outPng> <scrollFraction> <actName>
//
// Requires Edge/Chrome running with --remote-debugging-port=9222 and
// `node tools/serve.cjs` already serving the site.
const http = require('http');

function getJSON(url, method) {
    return new Promise((res, rej) => {
        const req = http.request(url, { method: method || 'GET' }, r => {
            let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { res(d); } });
        });
        req.on('error', rej);
        req.end();
    });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const [url, out, frac, act] = process.argv.slice(2);
    let hidePanel = false;
    for (let i = 0; i < 40; i++) {
        try { const t = await getJSON('http://127.0.0.1:9222/json'); if (t.length) break; } catch (e) { }
        await sleep(500);
    }
    // close stale page targets first — every live page holds a WebGL context and
    // the browser runs out of contexts after ~5 runs, failing init with no-webgl
    try {
        const list = await getJSON('http://127.0.0.1:9222/json');
        for (const t of list) {
            if (t.type === 'page') await getJSON('http://127.0.0.1:9222/json/close/' + encodeURIComponent(t.id), 'GET');
        }
    } catch (e) { }
    // open a DEDICATED target so runs never share a page
    let page;
    try {
        page = await getJSON('http://127.0.0.1:9222/json/new?about:blank', 'PUT');
    } catch (e) { page = null; }
    if (!page || !page.webSocketDebuggerUrl) {
        const targets = await getJSON('http://127.0.0.1:9222/json');
        page = targets.find(t => t.type === 'page');
    }
    if (!page) { console.error('no page target'); process.exit(1); }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params) => new Promise(r => {
        const i = ++id; pending.set(i, r);
        ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
    await new Promise(r => ws.onopen = r);
    await send('Page.enable');
    await send('Runtime.enable');
    // HIDE_PANEL=1 hides the pinned DOM caption so the capture shows the 3D frame
    // (done after load — cards are re-rendered by script.js, so a DOMContentLoaded
    // hook gets undone before the capture)
    if (process.env.HIDE_PANEL) {
        hidePanel = true;
    }
    // optional viewport override: SIZE=850x900 node tools/shot.cjs ...
    const size = process.env.SIZE && /^(\d+)x(\d+)$/.exec(process.env.SIZE);
    if (size) {
        await send('Emulation.setDeviceMetricsOverride', {
            width: +size[1], height: +size[2], deviceScaleFactor: 1, mobile: false
        });
    }
    // reset to about:blank first so each run starts from a clean document
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(2000);
    await send('Page.navigate', { url });
    await sleep(12000);
    // WebGL context creation occasionally fails on the first load (SwiftShader +
    // freshly closed targets) — the page then falls back to body.no-webgl with no
    // 3D at all. Reload until the scene actually initializes.
    for (let tries = 0; tries < 3; tries++) {
        const b = await send('Runtime.evaluate', {
            expression: `(document.body ? document.body.className : '')`, returnByValue: true
        });
        const cls = (b.result && b.result.result && b.result.result.value) || '';
        if (!/no-webgl/.test(cls)) break;
        console.log('RETRY webgl init (body="' + cls + '")');
        await send('Page.reload', {});
        await sleep(18000);
    }
    // SwiftShader runs this scene at ~1.5 fps and tick() caps dt at 0.05s,
    // so the damped scroll timeline needs a long real-time settle.
    await send('Runtime.evaluate', {
        expression: `(function(){
            // CSS scroll-behavior:smooth would animate and get cut off at ~1.5 fps
            document.documentElement.style.scrollBehavior='auto';
            var el=document.querySelector('[data-act="${act}"]');
            if(!el) return 'noact';
            var r=el.getBoundingClientRect();
            var top=r.top+window.scrollY;
            window.scrollTo(0, Math.round(top + r.height*${frac})); return 'ok';})()`,
        returnByValue: true
    });
    await sleep(35000);
    // re-apply after settling so the final captured position is deterministic
    await send('Runtime.evaluate', {
        expression: `(function(){
            document.documentElement.style.scrollBehavior='auto';
            var el=document.querySelector('[data-act="${act}"]');
            var r=el.getBoundingClientRect();
            window.scrollTo(0, Math.round(r.top+window.scrollY + r.height*${frac})); return 'ok';})()`,
        returnByValue: true
    });
    await sleep(8000);
    if (hidePanel) {
        await send('Runtime.evaluate', {
            expression: `document.querySelectorAll('.act-sticky,.caption').forEach(function(e){e.style.display='none';}); 'hidden'`,
            returnByValue: true
        });
        await sleep(4000);
    }
    const probe = await send('Runtime.evaluate', {
        expression: `(function(){
            var g=function(id){var e=document.getElementById(id);return e?e.textContent:null;};
            var act=document.querySelector('#seqList li.is-active');
            var doc=document.documentElement;
            var max=doc.scrollHeight-window.innerHeight;
            return JSON.stringify({body:document.body.className,
              y:Math.round(window.scrollY), max:Math.round(max),
              prog:+(window.scrollY/Math.max(1,max)).toFixed(3),
              stepIdx: act?act.getAttribute('data-seq'):null,
              done:document.querySelectorAll('#seqList li.is-done').length,
              pressure:g('telPressure'),foam:g('telFoam'),coolA:g('telCoolA'),
              coolB:g('telCoolB'),total:g('telTotal'),pump:g('telPump'),valve:g('telValve'),
              vw:window.innerWidth,vh:window.innerHeight,
              cam:(window.__dbg&&__dbg.camera)?__dbg.camera.position.toArray().map(function(n){return Math.round(n*10)/10;}):null,
              sp:(window.__dbg&&__dbg.state)?+__dbg.state.p.toFixed(4):null,
              u:(function(){try{
                  var max=document.documentElement.scrollHeight-window.innerHeight;
                  var el=document.querySelector('[data-act=\"${act}\"]');
                  var r=el.getBoundingClientRect(); var top=r.top+window.scrollY;
                  var st=top/max, en=(top+r.height)/max;
                  var uu=(window.__dbg&&__dbg.state)?(__dbg.state.p-st)/Math.max(1e-6,en-st):null;
                  return uu===null?null:+uu.toFixed(3);
                }catch(e){return 'err:'+e.message;}})(),
              proj:(function(){try{
                  var d=window.__dbg; if(!d) return 'nodbg';
                  var THREEx=d.THREE, cam=d.camera, out=[];
                  var names={};
                  d.scene.traverse(function(o){ if(o.name) names[o.name]=(names[o.name]||0)+1; });
                  out.push('names='+Object.keys(names).slice(0,60).join('|'));
                  ['processValves','TANKS'].forEach(function(k){
                    (d[k]||[]).forEach(function(it){
                      var g=it.group||it;
                      try{
                        var wp=g.getWorldPosition(new THREEx.Vector3());
                        var nd=wp.clone().project(cam);
                        out.push(k+':'+(it.id||it.tag||'?')+'@'+Math.round((nd.x+1)*window.innerWidth/2)+','+Math.round((1-nd.y)*window.innerHeight/2));
                      }catch(e){}
                    });
                  });
                  return out;
                }catch(e){return 'err:'+e.message;}})()});})()`,
        returnByValue: true
    });
    console.log('STATE ' + (probe.result && probe.result.result && probe.result.result.value));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    require('fs').writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    console.log('WROTE ' + out);
    ws.close();
    process.exit(0);
})();