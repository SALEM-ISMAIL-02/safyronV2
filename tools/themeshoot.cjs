// Theme screenshot: captures the hero in dark + light for visual comparison.
// usage: node tools/themeshoot.cjs <url> <outPrefix>
const http = require('http');
const fs = require('fs');
function getJSON(url, method) {
    return new Promise((res, rej) => {
        const req = http.request(url, { method: method || 'GET' }, r => {
            let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { res(d); } });
        });
        req.on('error', rej); req.end();
    });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const [url, outPrefix] = process.argv.slice(2);
    const targets = await getJSON('http://127.0.0.1:9222/json');
    let page = null;
    try { page = await getJSON('http://127.0.0.1:9222/json/new?about:blank', 'PUT'); } catch (e) { }
    if (!page || !page.webSocketDebuggerUrl) page = targets.find(t => t.type === 'page');
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
    await send('Page.enable'); await send('Runtime.enable');
    const errors = [];
    for (const theme of ['dark', 'light']) {
        await send('Page.navigate', { url: 'about:blank' });
        await sleep(1000);
        await send('Page.navigate', { url });
        await sleep(9000);
        // force the theme deterministically, then reload so the <head> script + first frame agree
        await send('Runtime.evaluate', { expression: `(function(){try{localStorage.setItem('safyron-theme','${theme}');}catch(e){}document.documentElement.setAttribute('data-theme','${theme}');window.dispatchEvent(new CustomEvent('safyron:theme',{detail:{theme:'${theme}'}}));return document.documentElement.getAttribute('data-theme');})()`, returnByValue: true });
        await sleep(6000);
        const probe = await send('Runtime.evaluate', {
            expression: `(function(){var d=window.__dbg;var cs=getComputedStyle(document.body);return JSON.stringify({theme:document.documentElement.getAttribute('data-theme'),sceneTheme:d?d.sceneTheme:null,dbg:!!d,bodyBg:cs.backgroundColor,bodyColor:cs.color});})()`,
            returnByValue: true
        });
        console.log(theme.toUpperCase() + ' ' + (probe.result && probe.result.result && probe.result.result.value));
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        if (shot.result && shot.result.data) {
            const f = outPrefix + '_' + theme + '.png';
            fs.writeFileSync(f, Buffer.from(shot.result.data, 'base64'));
            console.log('WROTE ' + f);
        }
    }
    console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'ERRORS none');
    ws.close(); process.exit(0);
})();
