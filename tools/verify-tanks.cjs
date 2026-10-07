// Tank-in-dike geometry + IR sensor placement assertions, via CDP.
//
// Asserts, in world space, that each tank's shell / wind girder / stair platform /
// cooling ring are concentric with its containment dike, and that each tank has
// exactly two IR sensors standing opposite one another outside the dike, aimed inward.
// Exits non-zero on failure. Optionally captures a screenshot of the given act.
//
//   usage: node tools/verify-tanks.cjs <url> [outPng] [act] [frac]
//   env:   HIDE_PANEL=1  hide the DOM caption card so it doesn't occlude the capture
//
// Requires Edge/Chrome running with --remote-debugging-port=9222 and
// `node tools/serve.cjs` already serving the site.
const http = require('http');
const fs = require('fs');

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

/* runs inside the page: locate the tank shell / wind girder / stair platform /
   cooling ring under each tk.group and compare their WORLD positions with the
   dike centre (tk.x, tk.z). dike half-width = 12 m, shell radius = 6 m. */
const CHECK = `(function(){
  var d = window.__dbg;
  if (!d) return JSON.stringify({ ok:false, why:'__dbg missing (init failed?)' });
  var THREE = d.THREE, R = 6, half = 12;
  var rows = d.TANKS.map(function(tk){
    var g = tk.group, shell = null, girder = null, plat = null;
    g.traverse(function(o){
      if (!shell && o.isMesh && o.geometry && o.geometry.type === 'CylinderGeometry') {
        var p = o.geometry.parameters;
        if (Math.abs(p.radiusTop - R) < 1e-6 && p.height > 10) shell = o;
      }
      if (!girder && o.isInstancedMesh && o.geometry && o.geometry.parameters &&
          o.geometry.parameters.width === 0.09) girder = o;
      if (!plat && o.isMesh && o.geometry && o.geometry.type === 'RingGeometry') plat = o;
    });
    var sw = shell ? shell.getWorldPosition(new THREE.Vector3()) : null;
    var girderR = null;
    if (girder) {
      var m = new THREE.Matrix4(); girder.getMatrixAt(0, m);
      var ip = new THREE.Vector3().setFromMatrixPosition(m).applyMatrix4(girder.matrixWorld);
      girderR = Math.hypot(ip.x - tk.x, ip.z - tk.z);
    }
    var pw = plat ? plat.getWorldPosition(new THREE.Vector3()) : null;
    var rw = tk.coolRing ? tk.coolRing.getWorldPosition(new THREE.Vector3()) : null;
    var shellErr = sw ? Math.hypot(sw.x - tk.x, sw.z - tk.z) : null;
    var platErr  = pw ? Math.hypot(pw.x - tk.x, pw.z - tk.z) : null;
    var ringErr  = rw ? Math.hypot(rw.x - tk.x, rw.z - tk.z) : null;
    return {
      id: tk.id, dike: [tk.x, tk.z],
      shellWorld: sw ? [+sw.x.toFixed(2), +sw.y.toFixed(2), +sw.z.toFixed(2)] : null,
      shellErr: shellErr === null ? null : +shellErr.toFixed(3),
      girderRadius: girderR === null ? null : +girderR.toFixed(3),
      platformErr: platErr === null ? null : +platErr.toFixed(3),
      coolRingErr: ringErr === null ? null : +ringErr.toFixed(3),
      insideDike: shellErr !== null && (Math.abs(sw.x - tk.x) + R <= half) && (Math.abs(sw.z - tk.z) + R <= half)
    };
  });
  /* --- IR sensors: 2 per tank, opposite each other, aimed at the tank --- */
  var ir = d.irCameras || [], perTank = {};
  ir.forEach(function(c){ (perTank[c.tank.id] = perTank[c.tank.id] || []).push(c); });
  var irRows = d.TANKS.map(function(tk){
    var list = perTank[tk.id] || [];
    var poles = list.map(function(c){
      var pw = c.group.getWorldPosition(new THREE.Vector3());
      var dx = pw.x - tk.x, dz = pw.z - tk.z;
      var fwd = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(c.group.getWorldQuaternion(new THREE.Quaternion())).normalize();
      var toTank = new THREE.Vector3(tk.x - pw.x, 0, tk.z - pw.z).normalize();
      var coneUp = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(c.cone.getWorldQuaternion(new THREE.Quaternion())).normalize();
      return {
        dist: +Math.hypot(dx, dz).toFixed(2),
        aimDot: +fwd.dot(toTank).toFixed(4),       // 1 = head faces the tank
        coneDot: +(-coneUp.dot(toTank)).toFixed(4),// 1 = cone reaches the tank
        outsideDike: Math.abs(dx) > 12 || Math.abs(dz) > 12
      };
    });
    var oppositeDot = null;
    if (poles.length === 2) {
      var a = list[0].group.getWorldPosition(new THREE.Vector3());
      var b = list[1].group.getWorldPosition(new THREE.Vector3());
      oppositeDot = +new THREE.Vector3(a.x - tk.x, 0, a.z - tk.z).normalize()
        .dot(new THREE.Vector3(b.x - tk.x, 0, b.z - tk.z).normalize()).toFixed(3);
    }
    return { id: tk.id, count: poles.length, oppositeDot: oppositeDot, poles: poles };
  });
  return JSON.stringify({ ok:true, rows:rows, ir:irRows });
})()`;

(async () => {
    const [url, out, act, fracArg] = process.argv.slice(2);
    const frac = parseFloat(fracArg || '0.5');
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
    let page = null;
    try { page = await getJSON('http://127.0.0.1:9222/json/new?about:blank', 'PUT'); } catch (e) { }
    if (!page || !page.webSocketDebuggerUrl) {
        const targets = await getJSON('http://127.0.0.1:9222/json');
        page = targets.find(t => t.type === 'page');
    }
    if (!page) { console.error('no page target'); process.exit(1); }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0; const pending = new Map(); const errors = [];
    ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params.exceptionDetails;
            errors.push('EXC ' + (d.exception && d.exception.description || d.text));
        }
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
            errors.push('CONSOLE ' + m.params.args.map(a => a.value || a.description).join(' '));
        }
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params) => new Promise(r => {
        const i = ++id; pending.set(i, r);
        ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
    await new Promise(r => ws.onopen = r);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(1200);
    await send('Page.navigate', { url });
    // WebGL context creation occasionally fails on the first load (SwiftShader +
    // freshly closed targets) — the page then falls back to body.no-webgl with no
    // 3D at all, so window.__dbg never appears. Reload until the scene inits.
    for (let tries = 0; tries < 6; tries++) {
        await sleep(3000);
        const ev = await send('Runtime.evaluate', {
            expression: `JSON.stringify([!!window.__dbg,
                (document.body ? document.body.className : '')])`, returnByValue: true
        });
        let parsed = [false, ''];
        try { parsed = JSON.parse((ev.result && ev.result.result && ev.result.result.value) || '[]'); } catch (e) { }
        if (parsed[0]) break;                       // scene up
        if (/no-webgl/.test(parsed[1])) {
            console.log('RETRY webgl init (body="' + parsed[1] + '")');
            await send('Page.reload', {});
            await sleep(18000);
        }                                            // else: still initialising, keep polling
    }

    // poll until the scene graph is built
    for (let i = 0; i < 120; i++) {
        await sleep(500);
        const r = await send('Runtime.evaluate', { expression: '!!window.__dbg', returnByValue: true });
        if (r.result && r.result.result && r.result.result.value) break;
    }
    const chk = await send('Runtime.evaluate', { expression: CHECK, returnByValue: true });
    const value = chk.result && chk.result.result && chk.result.result.value;
    console.log('CHECK ' + value);

    let pass = false;
    try {
        const j = JSON.parse(value);
        console.log('IR   ' + JSON.stringify(j.ir));
        pass = j.ok && j.rows.every(r =>
            r.shellErr !== null && r.shellErr < 0.01 &&
            r.platformErr !== null && r.platformErr < 0.01 &&
            r.coolRingErr !== null && r.coolRingErr < 0.01 &&
            r.girderRadius !== null && Math.abs(r.girderRadius - 6.1) < 0.05 &&
            r.insideDike) &&
            Array.isArray(j.ir) && j.ir.length === 2 &&
            j.ir.every(t =>
                t.count === 2 && t.oppositeDot !== null && t.oppositeDot < -0.99 &&
                t.poles.every(p =>
                    Math.abs(p.dist - 26) < 0.05 && p.aimDot > 0.99 &&
                    p.coneDot > 0.99 && p.outsideDike));
    } catch (e) { }
    console.log(pass ? 'PASS: tanks concentric + 2 opposite aimed IR sensors per tank' : 'FAIL');

    if (act) {
        if (process.env.HIDE_PANEL) {
            /* one-off verification: remove the DOM caption card so the left
               half of the canvas is not occluded in the capture */
            await send('Runtime.evaluate', {
                expression: `(function(){var s=document.createElement('style');
                    s.textContent='.act-sticky,.caption{display:none !important}';
                    document.head.appendChild(s);return 'hidden';})()`,
                returnByValue: true
            });
        }
        await send('Runtime.evaluate', {
            expression: `(function(){document.documentElement.style.scrollBehavior='auto';
                var el=document.querySelector('[data-act="${act}"]'); if(!el) return 'noact';
                var r=el.getBoundingClientRect();
                window.scrollTo(0, Math.round(r.top+window.scrollY + r.height*${frac})); return 'ok';})()`,
            returnByValue: true
        });
        await sleep(15000);
        const camInfo = await send('Runtime.evaluate', {
            expression: `(function(){var d=window.__dbg;if(!d)return 'nodbg';
                var c=d.camera, doc=document.documentElement;
                var max=Math.max(1,doc.scrollHeight-window.innerHeight);
                return JSON.stringify({p:+d.state.p.toFixed(4),
                pos:c.position.toArray().map(function(v){return +v.toFixed(1)}),
                scrollY:Math.round(window.scrollY), maxScroll:Math.round(max)});})()`,
            returnByValue: true
        });
        console.log('CAM ' + (camInfo.result && camInfo.result.result && camInfo.result.result.value));
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        if (shot.result && shot.result.data) {
            fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
            console.log('WROTE ' + out);
        }
    }
    console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'ERRORS none');
    ws.close();
    process.exit(pass ? 0 : 1);
})();
