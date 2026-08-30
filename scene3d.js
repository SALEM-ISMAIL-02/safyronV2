/* =========================================================================
   Safyron Engineering — 3D scrollytelling world
   Scroll drives one master timeline: fly-in over the refinery, ride the
   pipeline, command center, tank-fire incident, deluge suppression, calm
   resolution. Fully procedural geometry — no external 3D assets.
   ========================================================================= */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* =====================================================================
   FILM-GRADE POST SHADER — vignette + chromatic aberration + grain +
   cinematic color-grading on the final framebuffer.
   ===================================================================== */
const FilmShader = {
    uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uIntensity: { value: 1.0 },
        uVignette: { value: 0.35 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uIntensity;
        uniform float uVignette;
        varying vec2 vUv;
        float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
            vec2 uv = vUv;
            vec2 centered = uv - 0.5;
            float dist = length(centered);
            // chromatic aberration — stronger toward the corners
            float ca = dist * 0.004 * uIntensity;
            vec3 col;
            col.r = texture2D(tDiffuse, uv + vec2(ca, 0.0)).r;
            col.g = texture2D(tDiffuse, uv).g;
            col.b = texture2D(tDiffuse, uv - vec2(ca, 0.0)).b;
            // cinematic vignette (feathered, off-centre for lens feel)
            float vig = 1.0 - dist * dist * (1.0 + uVignette * 2.0);
            vig = smoothstep(-0.3, 1.0, vig);
            col *= mix(0.5, 1.0, vig);
            // animated film grain
            float grain = rand(uv + fract(uTime * 0.017)) * 0.09 * uIntensity;
            col += grain - 0.045 * uIntensity;
            // color grade: warm highlights / cool shadows
            float luma = dot(col, vec3(0.299, 0.587, 0.114));
            vec3 warm = col + vec3(0.03, 0.01, -0.015) * luma;
            vec3 cool = col + vec3(-0.015, 0.0, 0.025) * (1.0 - luma);
            col = mix(warm, cool, 0.5);
            gl_FragColor = vec4(col, 1.0);
        }
    `
};

const ACT_TITLES = ['Overview', 'Service Network', 'Command', 'Incident', 'Suppression', 'Resolution'];
const FIRE_POS = new THREE.Vector3(-22, 5.45, -30); // flat tank roof — fire burns on the roof
const COLORS = {
    bg: 0x050b16,
    warm: 0x1a0d06,
    cool: 0x04101f,
    navy: 0x1a3263,
    orange: 0xfab95b,
    ice: 0xe9f0ff,
    fireLight: 0xff7a2a
};

const isMobile = window.matchMedia('(max-width: 820px)').matches;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/* texture resolution — 1K maps on desktop for crisp PBR surfaces */
const TEX = isMobile ? 512 : 1024;
const QUALITY = {
    fire: isMobile ? 500 : 1300, smoke: isMobile ? 100 : 150,
    steam: isMobile ? 90 : 150, jet: isMobile ? 400 : 900,
    pilot: isMobile ? 160 : 320, stars: isMobile ? 500 : 900
};

let renderer, scene, camera, composer;
let clock, rig = null, chapterRanges = null;
let bloomPass, filmPass;
let flowTex, heroPipeMat, coreTubeMat, branchCoreMat;
let beaconMat, runwayMat, matGround, hazardMat, aoTex, pipeTexBase, pipeNrmBase;
const valves = [], detectors = [], jets = [], cmdWheels = [];
let splashDisc, splashRing, runwayLights;
let smokeSys, steamSys, pilotSys, poolLight;
const fires = [];
let fireLight, flareLight, hemiLight;
let starsMat, grid, heatHaze, flareSpriteMat, fireGlowMat;
let sirenLight, skyMat;
const sirenLamps = [];

const state = {
    p: 0, targetP: 0, time: 0,
    pointer: new THREE.Vector2(), pointerSmooth: new THREE.Vector2(),
    fire: 0, water: 0, steam: 0, alarm: 0, flow: 0.2,
    siren: 0, actIndex: -1, netStep: -1, ready: false, roll: 0
};

/* ---------- small helpers ---------- */
const ss = (x, a, b) => THREE.MathUtils.smoothstep(x, a, b);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function metalMaterial(color, roughness, metalness, opts = {}) {
    return new THREE.MeshStandardMaterial(Object.assign({
        color, roughness, metalness, envMapIntensity: 0.45
    }, opts));
}
let matStructure, matPipe, matTank, matDark, matAccent, matIce, matGlowValve;

function makeFlowTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 32;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#020409';
    ctx.fillRect(0, 0, 512, 32);
    for (let i = 0; i < 3; i++) {
        const x = 46 + i * 172;
        const g = ctx.createLinearGradient(x - 64, 0, x + 64, 0);
        g.addColorStop(0, 'rgba(124,207,255,0)');
        g.addColorStop(0.5, 'rgba(228,247,255,1)');
        g.addColorStop(1, 'rgba(124,207,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 64, 0, 128, 32);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(2, 1);
    return tex;
}

/* ==========================================================================
   Procedural PBR texture factory — color / normal / roughness sets are
   generated in-browser and mapped onto the native UVs of every primitive
   (cylinders wrap panels around, tubes run weld seams along their length).
   ========================================================================== */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function canvasOf(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    return c;
}

/* rotate a square canvas 90° — reorients weld seams for cylinder UVs
   (CylinderGeometry runs length along V; TubeGeometry runs length along U) */
function rotateCanvas(src) {
    const c = document.createElement('canvas');
    c.width = src.height; c.height = src.width;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    return c;
}

/* Sobel height-field -> tangent-space normal map (OpenGL Y-up, three.js convention) */
function heightToNormal(canvas, strength) {
    const w = canvas.width, h = canvas.height;
    const src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const out = new Uint8Array(w * h * 4);
    const at = (x, y) => {
        const i = (((y + h) % h) * w + ((x + w) % w)) * 4;
        return (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
    };
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
            const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
            const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
            const i = (y * w + x) * 4;
            out[i] = (dx * inv * 0.5 + 0.5) * 255;
            out[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
            out[i + 2] = (inv * 0.5 + 0.5) * 255;
            out[i + 3] = 255;
        }
    }
    const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
}

function texColor(canvas, rx, ry) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
}
function texData(tex, rx, ry) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(rx, ry);
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return tex;
}
/* ---------- brushed navy panels with seams + rivets (structures) ---------- */
function drawPanelLayer(ctx, w, h, rng, height) {
    if (!height) {
        ctx.fillStyle = '#131f3a';
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 7000; i++) {
            const v = 18 + rng() * 30;
            ctx.fillStyle = 'rgba(' + v + ',' + (v + 10) + ',' + (v + 24) + ',' + (0.08 + rng() * 0.18).toFixed(2) + ')';
            ctx.fillRect(rng() * w, rng() * h, 1.6, 1.6);
        }
        ctx.globalAlpha = 0.12;
        for (let i = 0; i < 60; i++) {
            ctx.strokeStyle = rng() > 0.5 ? '#33507e' : '#0a1426';
            const x = rng() * w;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (rng() - 0.5) * 26, h); ctx.stroke();
        }
        ctx.globalAlpha = 1;
    } else {
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 7000; i++) {
            const v = 104 + rng() * 44;
            ctx.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.25)';
            ctx.fillRect(rng() * w, rng() * h, 1.6, 1.6);
        }
    }
    const cells = 4;
    for (let i = 0; i <= cells; i++) {
        const p = Math.round(i * w / cells) + 0.5;
        ctx.strokeStyle = height ? '#2e2e2e' : 'rgba(3,7,14,0.95)';
        ctx.lineWidth = height ? 4 : 3;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(w, p); ctx.stroke();
        ctx.strokeStyle = height ? '#9c9c9c' : 'rgba(130,165,220,0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p + 3, 0); ctx.lineTo(p + 3, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p + 3); ctx.lineTo(w, p + 3); ctx.stroke();
    }
    for (let gy = 0; gy <= cells; gy++) {
        for (let gx = 0; gx <= cells; gx++) {
            const x = gx * w / cells, y = gy * h / cells;
            if (height) {
                ctx.fillStyle = '#cccccc';
                ctx.beginPath(); ctx.arc(x + 10, y + 10, 3.2, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#3a3a3a';
                ctx.beginPath(); ctx.arc(x + 10, y + 10, 1.4, 0, Math.PI * 2); ctx.fill();
            } else {
                const g = ctx.createRadialGradient(x + 9, y + 9, 0.5, x + 10, y + 10, 3.4);
                g.addColorStop(0, 'rgba(190,210,240,0.85)');
                g.addColorStop(1, 'rgba(10,18,34,0.9)');
                ctx.fillStyle = g;
                ctx.beginPath(); ctx.arc(x + 10, y + 10, 3.4, 0, Math.PI * 2); ctx.fill();
            }
        }
    }
}
/* ---------- tank steel: vertical brush, weld rings, bottom grime, rust ---------- */
function tankCanvases() {
    const rng = mulberry32(77);
    const color = canvasOf(TEX, TEX, (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#a9bcd9'); g.addColorStop(0.55, '#8fa6c8'); g.addColorStop(1, '#5c7194');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 160; i++) {
            ctx.strokeStyle = rng() > 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(61,81,112,0.16)';
            const x = rng() * w;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (rng() - 0.5) * 6, h); ctx.stroke();
        }
        const grime = ctx.createLinearGradient(0, h * 0.55, 0, h);
        grime.addColorStop(0, 'rgba(28,24,20,0)');
        grime.addColorStop(1, 'rgba(28,24,20,0.55)');
        ctx.fillStyle = grime; ctx.fillRect(0, h * 0.55, w, h * 0.45);
        for (let i = 0; i < 90; i++) {
            const x = rng() * w, y = h * 0.6 + rng() * h * 0.4;
            ctx.fillStyle = 'rgba(150,84,40,' + (0.05 + rng() * 0.16).toFixed(2) + ')';
            ctx.beginPath(); ctx.arc(x, y, 1 + rng() * 3.5, 0, Math.PI * 2); ctx.fill();
        }
        [0.25, 0.55, 0.85].forEach(v => {
            const y = v * h;
            ctx.strokeStyle = 'rgba(30,42,64,0.85)'; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
            ctx.strokeStyle = 'rgba(220,232,250,0.35)'; ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.moveTo(0, y + 3); ctx.lineTo(w, y + 3); ctx.stroke();
        });
    });
    const height = canvasOf(TEX, TEX, (ctx, w, h) => {
        ctx.fillStyle = '#7a7a7a'; ctx.fillRect(0, 0, w, h);
        const rng2 = mulberry32(77);
        ctx.globalAlpha = 0.25;
        for (let i = 0; i < 160; i++) {
            ctx.strokeStyle = rng2() > 0.5 ? '#9a9a9a' : '#5a5a5a';
            const x = rng2() * w;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (rng2() - 0.5) * 6, h); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        [0.25, 0.55, 0.85].forEach(v => {
            ctx.strokeStyle = '#2f2f2f'; ctx.lineWidth = 5;
            ctx.beginPath(); ctx.moveTo(0, v * h); ctx.lineTo(w, v * h); ctx.stroke();
        });
    });
    return { color, height };
}

/* ---------- pipe skin: weld rings along the tube's U (length) axis ---------- */
function pipeCanvases() {
    const color = canvasOf(256, 256, (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#3a4f74'); g.addColorStop(0.5, '#1d2f50'); g.addColorStop(1, '#31456a');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 0.18;
        for (let i = 0; i < 90; i++) {
            ctx.strokeStyle = i % 2 ? '#4c6690' : '#101c30';
            const y = Math.random() * h;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y + (Math.random() - 0.5) * 8); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        for (let x = 0; x <= w; x += 64) {
            ctx.strokeStyle = 'rgba(8,14,26,0.9)'; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
            ctx.strokeStyle = 'rgba(170,200,240,0.4)'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(x + 3, 0); ctx.lineTo(x + 3, h); ctx.stroke();
        }
    });
    const height = canvasOf(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h);
        for (let x = 0; x <= w; x += 64) {
            ctx.strokeStyle = '#2e2e2e'; ctx.lineWidth = 5;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
    });
    return { color, height };
}
/* ---------- ground asphalt with cracks + blotches ---------- */
function asphaltCanvases() {
    const color = canvasOf(TEX, TEX, (ctx, w, h) => {
        ctx.fillStyle = '#070c15'; ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 14000; i++) {
            const v = 8 + Math.random() * 26;
            ctx.fillStyle = 'rgba(' + v + ',' + (v + 4) + ',' + (v + 12) + ',' + (0.2 + Math.random() * 0.3).toFixed(2) + ')';
            ctx.fillRect(Math.random() * w, Math.random() * h, 1.4, 1.4);
        }
        for (let i = 0; i < 6; i++) {
            const x = Math.random() * w, y = Math.random() * h, r = 40 + Math.random() * 90;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, 'rgba(16,26,44,0.35)'); g.addColorStop(1, 'rgba(16,26,44,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.strokeStyle = 'rgba(3,6,10,0.55)'; ctx.lineWidth = 1.2;
        for (let i = 0; i < 12; i++) {
            let x = Math.random() * w, y = Math.random() * h;
            ctx.beginPath(); ctx.moveTo(x, y);
            for (let s = 0; s < 6; s++) { x += (Math.random() - 0.5) * 60; y += (Math.random() - 0.5) * 60; ctx.lineTo(x, y); }
            ctx.stroke();
        }
    });
    const height = canvasOf(TEX, TEX, (ctx, w, h) => {
        ctx.fillStyle = '#7c7c7c'; ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 14000; i++) {
            const v = 100 + Math.random() * 70;
            ctx.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.35)';
            ctx.fillRect(Math.random() * w, Math.random() * h, 1.4, 1.4);
        }
        ctx.strokeStyle = '#2c2c2c'; ctx.lineWidth = 1.6;
        for (let i = 0; i < 12; i++) {
            let x = Math.random() * w, y = Math.random() * h;
            ctx.beginPath(); ctx.moveTo(x, y);
            for (let s = 0; s < 6; s++) { x += (Math.random() - 0.5) * 60; y += (Math.random() - 0.5) * 60; ctx.lineTo(x, y); }
            ctx.stroke();
        }
    });
    return { color, height };
}

/* ---------- safety hazard stripes (industrial yellow/black) ---------- */
function hazardTexture() {
    const canvas = canvasOf(128, 128, (ctx, w, h) => {
        ctx.fillStyle = '#15161a'; ctx.fillRect(0, 0, w, h);
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate(Math.PI / 4);
        ctx.translate(-w, -h);
        ctx.fillStyle = '#e8a33d';
        for (let x = -w; x < w * 2; x += 44) ctx.fillRect(x, 0, 22, h * 3);
        ctx.restore();
        for (let i = 0; i < 900; i++) {
            ctx.fillStyle = 'rgba(10,10,12,' + (Math.random() * 0.3).toFixed(2) + ')';
            ctx.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
        }
    });
    return texColor(canvas, 3, 1);
}

/* ---------- soft radial AO decal for grounding structures ---------- */
function aoTexture() {
    const canvas = canvasOf(256, 256, (ctx, w, h) => {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStop(0, 'rgba(0,0,0,0.9)');
        g.addColorStop(0.55, 'rgba(0,0,0,0.42)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
    return new THREE.CanvasTexture(canvas);
}

/* ---------- shaders (volumetric-style, HDR cores for bloom) ---------- */
const FIRE_VERT = `
attribute float aSeed;
attribute float aSize;
uniform float uTime;
uniform float uIntensity;
varying float vLife;
varying float vEmber;
varying float vSeed;
void main() {
    float speed = 0.5 + aSeed * 0.55;
    float life = fract(uTime * speed + aSeed * 7.31);
    vLife = life;
    vEmber = step(0.88, aSeed);
    vSeed = aSeed;
    vec3 p = position;
    float spread = (1.0 - life * 0.85);
    // multi-octave turbulence — large licks + fine flicker
    float sway = sin(uTime * 3.1 + aSeed * 43.0) * 0.5
               + sin(uTime * 7.7 + aSeed * 91.0) * 0.3
               + sin(uTime * 13.3 + aSeed * 57.0) * 0.2;
    p.x += sway * 0.30 * spread * (aSeed - 0.5) * 2.0;
    p.z += cos(uTime * 2.7 + aSeed * 31.0) * 0.26 * spread * (aSeed - 0.5) * 2.0;
    // flame leans with the wind
    p.x += life * life * 0.9;
    p.y = position.y * mix(0.18, 1.0, life) + life * (1.35 + vEmber * 3.4);
    float s = aSize * (1.0 - life * 0.8) * (1.0 + vEmber * 0.7) * uIntensity;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = s * (240.0 / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv;
}`;
const FIRE_FRAG = `
uniform float uIntensity;
varying float vLife;
varying float vEmber;
varying float vSeed;
void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    // gaussian falloff — volumetric soft edge, no hard disc
    float alpha = exp(-d * d * 3.2) - exp(-9.0);
    alpha = max(alpha, 0.0) * (1.0 - smoothstep(0.86, 1.0, d));
    alpha *= smoothstep(1.0, 0.5, vLife) * uIntensity;
    // per-particle temperature variance
    float temp = vSeed * 0.25;
    vec3 core = vec3(1.0, 0.93, 0.60);
    vec3 mid  = vec3(1.0, 0.56 + temp, 0.16);
    vec3 tip  = vec3(0.62, 0.10, 0.04);
    vec3 col = mix(core, mid, smoothstep(0.0, 0.32, vLife));
    col = mix(col, tip, smoothstep(0.42, 0.95, vLife));
    col = mix(col, vec3(1.0, 0.82, 0.45), vEmber * 0.6);
    // HDR core — feeds bloom without whiteout
    float heat = 1.3 - vLife * 0.5 + vEmber * 0.45;
    gl_FragColor = vec4(col * heat, alpha);
}`;
const SMOKE_VERT = `
attribute float aSeed;
attribute float aSize;
uniform float uTime;
varying float vLife;
varying float vSeed;
void main() {
    float life = fract(uTime * 0.14 + aSeed * 9.7);
    vLife = life;
    vSeed = aSeed;
    vec3 p = position;
    p.x += (sin(uTime * 0.5 + aSeed * 21.0) * 0.9 + life * 1.4) * life;
    p.z += cos(uTime * 0.4 + aSeed * 17.0) * 0.9 * life;
    p.y += life * 7.5;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * (0.4 + life * 1.9) * (240.0 / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv;
}`;
const SMOKE_FRAG = `
uniform float uIntensity;
varying float vLife;
varying float vSeed;
void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    float alpha = exp(-d * d * 2.6) * 0.2 * uIntensity;
    alpha *= smoothstep(0.0, 0.12, vLife) * (1.0 - smoothstep(0.75, 1.0, vLife));
    // wind-lit smoke: ember glow from below, moonlight rim on top
    float glow = (1.0 - vLife) * 0.35;
    vec3 col = mix(vec3(0.10, 0.10, 0.13), vec3(0.30, 0.26, 0.26), vSeed);
    col += vec3(0.45, 0.22, 0.06) * glow;
    gl_FragColor = vec4(col, alpha);
}`;
const STEAM_VERT = `
attribute float aSeed;
attribute float aSize;
uniform float uTime;
varying float vLife;
varying float vSeed;
void main() {
    float life = fract(uTime * 0.3 + aSeed * 6.1);
    vLife = life;
    vSeed = aSeed;
    vec3 p = position;
    p.x += sin(uTime * 0.9 + aSeed * 29.0) * 0.6 * life;
    p.z += cos(uTime * 0.7 + aSeed * 24.0) * 0.6 * life;
    p.y += life * 3.6;
    // wind carries the plume sideways so wisps never stack into a white wall
    p.x += life * life * 2.4;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * (0.5 + life * 1.6) * (240.0 / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv;
}`;
const STEAM_FRAG = `
uniform float uIntensity;
varying float vLife;
varying float vSeed;
void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    float alpha = exp(-d * d * 3.0) * 0.15 * uIntensity;
    alpha *= smoothstep(0.0, 0.1, vLife) * (1.0 - smoothstep(0.7, 1.0, vLife));
    vec3 col = mix(vec3(0.80, 0.89, 1.0), vec3(1.0), vSeed * 0.5);
    gl_FragColor = vec4(col, alpha);
}`;
const JET_VERT = `
attribute float aSeed;
uniform vec3 uOrigin;
uniform vec3 uVel;
uniform float uGrav;
uniform float uDur;
uniform float uTime;
uniform float uIntensity;
uniform float uSize;
varying float vFade;
varying float vSeed;
void main() {
    vSeed = aSeed;
    float T = fract(uTime / uDur + aSeed) * uDur;
    // tighter spray cone — coherent jet with slight droplet scatter
    vec3 vel = uVel + vec3(sin(aSeed * 78.2), cos(aSeed * 45.1), sin(aSeed * 33.7)) * 0.45;
    vec3 p = uOrigin + vel * T + vec3(0.0, 0.5 * uGrav * T * T, 0.0);
    vFade = smoothstep(0.0, 0.05, T / uDur) * (1.0 - smoothstep(0.82, 1.0, T / uDur));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * uIntensity * (0.6 + 0.4 * aSeed) * (150.0 / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv;
}`;
const JET_FRAG = `
uniform float uIntensity;
varying float vFade;
varying float vSeed;
void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    // soft water droplet with bright specular centre
    float body = exp(-d * d * 4.5);
    float spec = exp(-d * d * 18.0) * 0.9;
    float alpha = (body * 0.55 + spec) * 0.45 * uIntensity * vFade;
    vec3 col = mix(vec3(0.70, 0.86, 1.0), vec3(1.0), vSeed * 0.5);
    gl_FragColor = vec4(col + spec * 0.3, alpha);
}`;

function buildParticles({ count, area, baseY, heightSpread, sizeMin, sizeMax, vert, frag, blending }) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const size = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        const r = Math.sqrt(Math.random()) * area;
        const a = Math.random() * Math.PI * 2;
        pos[i * 3] = Math.cos(a) * r;
        pos[i * 3 + 1] = Math.random() * heightSpread;
        pos[i * 3 + 2] = Math.sin(a) * r;
        seed[i] = Math.random();
        size[i] = sizeMin + Math.random() * (sizeMax - sizeMin);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms: {
            uTime: { value: 0 },
            uIntensity: { value: 0 }
        },
        transparent: true,
        depthWrite: false,
        blending
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    return points;
}
/* ---------- renderer / scene ---------- */
function webglAvailable() {
    try {
        const c = document.createElement('canvas');
        return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
}

function initRenderer() {
    renderer = new THREE.WebGLRenderer({
        canvas: document.getElementById('scene3d'),
        antialias: !isMobile,
        powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.75 : 2.25));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // the facility is static — bake the shadow map once instead of per frame
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.bg);
    scene.fog = new THREE.FogExp2(COLORS.bg, 0.006);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 420);
    camera.position.set(46, 27, 64);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    if (!isMobile) {
        // default composer target is HalfFloat — true HDR chain so bloom
        // reads real energy from fire/emissives instead of clamped LDR
        composer = new EffectComposer(renderer);
        composer.setPixelRatio(renderer.getPixelRatio());
        composer.setSize(window.innerWidth, window.innerHeight);

        // 1 — geometry + lighting → HDR target
        composer.addPass(new RenderPass(scene, camera));

        // 2 — cinematic bloom (wide, low threshold for fire glow)
        bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            0.55,   // strength
            0.8,    // radius
            0.4     // threshold — only true HDR sources glow
        );
        composer.addPass(bloomPass);

        // 3 — SMAA anti-aliasing
        composer.addPass(new SMAAPass(
            window.innerWidth * renderer.getPixelRatio(),
            window.innerHeight * renderer.getPixelRatio()
        ));

        // 4 — tone mapping / color-space conversion
        composer.addPass(new OutputPass());

        // 5 — film-grade final pass: vignette, grain, chromatic aberration
        filmPass = new ShaderPass(FilmShader);
        filmPass.uniforms.uTime.value = 0;
        filmPass.uniforms.uIntensity.value = 1.0;
        composer.addPass(filmPass);
    }
    clock = new THREE.Clock();
}

/* volumetric fog noise — smooth value noise on canvas */
function makeFogNoise(w, h, rng) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const cell = 16;
    const grid = [];
    for (let gy = 0; gy <= Math.ceil(h / cell); gy++) {
        grid[gy] = [];
        for (let gx = 0; gx <= Math.ceil(w / cell); gx++) {
            grid[gy][gx] = rng();
        }
    }
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
            const tx = (x % cell) / cell, ty = (y % cell) / cell;
            const a = grid[gy][gx], b = grid[gy][gx + 1] || a;
            const c2 = grid[gy + 1] ? grid[gy + 1][gx] : a, d = grid[gy + 1] ? grid[gy + 1][gx + 1] : a;
            const ix = a * (1 - tx) + b * tx;
            const iy = c2 * (1 - tx) + d * tx;
            const v = ix * (1 - ty) + iy * ty;
            const i = (y * w + x) * 4;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255;
            img.data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    ctx.filter = 'blur(4px)';
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(c, 0, 0);
    ctx.filter = 'blur(2px)';
    ctx.drawImage(c, 0, 0);
    ctx.filter = '';
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 3);
    t.anisotropy = 4;
        return t;
}

/* lens flare sprite — radial gradient with glow */
function makeFlareSprite() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0.0, 'rgba(255,214,120,1)');
    grad.addColorStop(0.15, 'rgba(255,165,60,0.6)');
    grad.addColorStop(0.4, 'rgba(255,120,20,0.2)');
    grad.addColorStop(1.0, 'rgba(255,120,20,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    return tex;
}

/* city building windows — dark facade with randomly lit offices */
function windowsTexture(rng) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#060b16';
    ctx.fillRect(0, 0, 64, 128);
    for (let y = 6; y < 122; y += 8) {
        for (let x = 4; x < 58; x += 8) {
            if (rng() < 0.28) {
                ctx.fillStyle = rng() < 0.72 ? 'rgba(255,190,110,0.9)' : 'rgba(160,210,255,0.8)';
                ctx.fillRect(x, y, 4, 5);
            }
        }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

function initEnvironment() {
    hemiLight = new THREE.HemisphereLight(0x3a5aa8, 0x05070d, 0.55);
    scene.add(hemiLight);
    const dir = new THREE.DirectionalLight(0x9fc4ff, 1.2);
    dir.position.set(30, 42, 20);
    dir.castShadow = true;
    dir.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
    dir.shadow.camera.left = -85; dir.shadow.camera.right = 85;
    dir.shadow.camera.top = 85; dir.shadow.camera.bottom = -85;
    dir.shadow.camera.near = 5; dir.shadow.camera.far = 170;
    dir.shadow.bias = -0.0004;
    dir.shadow.normalBias = 0.03;
    scene.add(dir);
    const rim = new THREE.DirectionalLight(0x2a4a8f, 0.5);
    rim.position.set(-40, 18, -30);
    scene.add(rim);

    fireLight = new THREE.PointLight(COLORS.fireLight, 0, 60, 2);
    fireLight.position.copy(FIRE_POS).add(V3(0, 2.1, 0));
    scene.add(fireLight);
    // soft glow shared by the bund pool fires
    poolLight = new THREE.PointLight(COLORS.fireLight, 0, 20, 2);
    poolLight.position.set(-21.8, 1.8, -29.3);
    scene.add(poolLight);
    flareLight = new THREE.PointLight(COLORS.orange, 26, 40, 2);
    flareLight.position.set(-38, 20, 8);
    scene.add(flareLight);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(150, 64), matGround);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // gradient sky dome — horizon glow into deep navy (replaces flat background)
    const sky = new THREE.Mesh(
        new THREE.SphereGeometry(300, 24, 14),
        new THREE.ShaderMaterial({
            side: THREE.BackSide, depthWrite: false, fog: false,
            uniforms: {
                topColor: { value: new THREE.Color(0x020409) },
                horizonColor: { value: new THREE.Color(0x0b1c34) }
            },
            vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: 'uniform vec3 topColor; uniform vec3 horizonColor; varying vec3 vDir; void main(){ gl_FragColor = vec4(mix(horizonColor, topColor, smoothstep(-0.05, 0.5, vDir.y)), 1.0); }'
        })
    );
    scene.add(sky);
    skyMat = sky.material;

    grid = new THREE.GridHelper(300, 60, 0x24457e, 0x10203c);
    grid.material.transparent = true;
    grid.material.opacity = 0.3;
    grid.position.y = 0.02;
    scene.add(grid);

    const starGeo = new THREE.BufferGeometry();
    const sp = new Float32Array(QUALITY.stars * 3);
    for (let i = 0; i < QUALITY.stars; i++) {
        const r = 140 + Math.random() * 80;
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(1 - Math.random() * 0.85);
        sp[i * 3] = r * Math.sin(ph) * Math.cos(th);
        sp[i * 3 + 1] = Math.abs(r * Math.cos(ph)) * 0.6 + 12;
        sp[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    starsMat = new THREE.PointsMaterial({
        color: 0x9fc4ff, size: 0.7, transparent: true, opacity: 0.65,
        depthWrite: false, sizeAttenuation: true
    });
    scene.add(new THREE.Points(starGeo, starsMat));

    // distant plant silhouettes
    const silMat = new THREE.MeshBasicMaterial({ color: 0x0a1428 });
    [
        [-72, 9, -42, 15, 18, 13], [-66, 7, 12, 11, 14, 17],
        [42, 6, -74, 21, 12, 15], [56, 8, -22, 13, 16, 19],
        [32, 5, 58, 19, 10, 11], [-20, 8, -84, 17, 16, 15]
    ].forEach(([x, y, z, w, h, d]) => {
        const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), silMat);
        box.position.set(x, y, z);
        scene.add(box);
    });

    // background city skyline — towers with lit windows through the night fog
    const bldTex = windowsTexture(mulberry32(2024));
    bldTex.repeat.set(2, 4);
    const bldMat = new THREE.MeshStandardMaterial({
        map: bldTex, emissive: 0xffffff, emissiveMap: bldTex, emissiveIntensity: 0.6,
        roughness: 0.9, metalness: 0.1, envMapIntensity: 0.2
    });
    // [x, z, width, height, depth] — ringed around the plant, beyond the fence
    const blds = [
        [-62, -68, 12, 30, 12], [-80, -36, 10, 22, 10], [-52, -84, 14, 18, 14],
        [-18, -92, 12, 36, 12], [14, -88, 16, 24, 16], [44, -78, 12, 20, 12],
        [70, -54, 10, 27, 10], [86, -16, 14, 17, 14], [78, 26, 12, 23, 12],
        [52, 62, 16, 15, 16], [16, 82, 12, 25, 12], [-18, 86, 14, 17, 14],
        [-48, 74, 10, 21, 10], [-74, 46, 12, 15, 12]
    ];
    blds.forEach(([x, z, w, h, d]) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bldMat);
        b.position.set(x, h / 2, z);
        scene.add(b);
    });


    // heat haze — ground shimmer near the bund fires
    heatHaze = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, fog: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: {
            uTime: { value: 0 }, uIntensity: { value: 0 },
            uNoise: { value: makeFogNoise(128, 128, mulberry32(421)) }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: `
            uniform sampler2D uNoise; uniform float uTime; uniform float uIntensity;
            varying vec2 vUv;
            void main() {
                vec3 n = texture2D(uNoise, vUv * 3.0 + vec2(uTime * 0.03, uTime * 0.05)).rgb;
                float alpha = (n.r + n.g + n.b) * 0.22 * uIntensity;
                gl_FragColor = vec4(1.0, 0.88, 0.72, alpha);
            }
        `
    });
    // ground heat shimmer under the bund fires — small, low, subtle
    // (a huge sheet here read as a "rectangle on top of the fire")
    const hazePlane = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 5.5, 1, 1), heatHaze);
    hazePlane.rotation.x = -Math.PI / 2;
    hazePlane.position.set(-22, 0.18, -29.6);
    scene.add(hazePlane);

        // lens flare sprite on the flare stack tip
    flareSpriteMat = new THREE.SpriteMaterial({
        map: makeFlareSprite(),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const flareSprite = new THREE.Sprite(flareSpriteMat);
    flareSprite.scale.set(8, 8, 1);
    flareSprite.position.set(-38, 20.1, 8);
    flareSprite.renderOrder = 100;
    scene.add(flareSprite);
}
/* ---------- refinery builders ---------- */
function addMesh(geo, mat, x, y, z, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    (parent || scene).add(m);
    return m;
}

/* fake contact-shadow decal — grounds structures without SSAO cost */
function addAO(x, z, w, d, opacity) {
    const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, opacity: opacity || 0.55, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.022, z);
    m.renderOrder = 1;
    scene.add(m);
    return m;
}

function buildPipeRack() {
    const railGeo = new THREE.BoxGeometry(0.35, 0.5, 66);
    [[-2.8, 5.6], [2.8, 5.6], [-2.8, 8.2], [2.8, 8.2]].forEach(([x, y]) =>
        addMesh(railGeo, matStructure, x, y, 14)
    );
    const pipeGeo = new THREE.CylinderGeometry(0.26, 0.26, 64, 14);
    pipeGeo.rotateX(Math.PI / 2);
    const xs = [-2.0, -0.9, 0.2, 1.3, 2.1];
    const ys = [6.4, 7.1, 7.1, 6.4, 7.8];
    const inst = new THREE.InstancedMesh(pipeGeo, matPipe, xs.length);
    const m4 = new THREE.Matrix4();
    xs.forEach((x, i) => { m4.setPosition(x, ys[i], 14); inst.setMatrixAt(i, m4); });
    inst.castShadow = true;
    inst.receiveShadow = true;
    scene.add(inst);

    const colGeo = new THREE.BoxGeometry(0.28, 8.4, 0.28);
    const colInst = new THREE.InstancedMesh(colGeo, matStructure, 22);
    let k = 0;
    for (let z = 44; z >= -16; z -= 6) {
        for (const x of [-2.8, 2.8]) { m4.setPosition(x, 4.2, z); colInst.setMatrixAt(k++, m4); }
    }
    colInst.castShadow = true;
    colInst.receiveShadow = true;
    scene.add(colInst);

    // guiding runway lights along the deck
    runwayMat = new THREE.MeshBasicMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.8 });
    runwayLights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 8), runwayMat, 12);
    let j = 0;
    for (let z = 42; z >= -13; z -= 5) { m4.setPosition(0, 8.55, z); runwayLights.setMatrixAt(j++, m4); }
    scene.add(runwayLights);

    // beacon lights on selected columns (flash red during the incident act)
    beaconMat = new THREE.MeshBasicMaterial({ color: 0x223049 });
    const beaconGeo = new THREE.SphereGeometry(0.17, 12, 10);
    [[-2.8, 8.75, 32], [2.8, 8.75, 8], [-2.8, 8.75, -16],
     [-32.5, 1.45, -24.5], [-11.5, 1.45, -35.5], [16, 18.6, -6]].forEach(([x, y, z]) =>
        addMesh(beaconGeo, beaconMat, x, y, z)
    );
}

function buildHeroPipe() {
    const curve = new THREE.CatmullRomCurve3([
        V3(1.2, 7.4, 44), V3(0.4, 7.4, 30), V3(1.6, 7.4, 18),
        V3(-0.6, 7.4, 6), V3(0.8, 7.4, -6), V3(0.2, 7.4, -14)
    ]);
    flowTex = makeFlowTexture();
    heroPipeMat = new THREE.MeshStandardMaterial({
        map: pipeTexBase, normalMap: pipeNrmBase,
        color: 0xdfe6f2, roughness: 0.38, metalness: 0.9,
        emissive: 0xffffff, emissiveMap: flowTex, emissiveIntensity: 0.35,
        envMapIntensity: 0.85
    });
    const heroMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 140, 0.5, 24, false), heroPipeMat);
    heroMesh.castShadow = true;
    scene.add(heroMesh);

    coreTubeMat = new THREE.MeshBasicMaterial({
        color: 0x9fdcff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.2, 12, false), coreTubeMat));

    // branch running from the rack toward the tank bund (feeds the deluge monitors)
    const branch = new THREE.CatmullRomCurve3([
        V3(0.2, 7.4, -14), V3(-5, 7.1, -19), V3(-11, 6.6, -23.5)
    ]);
    const bMap = pipeTexBase.clone(); bMap.needsUpdate = true; bMap.repeat.set(4, 1);
    const bNrm = pipeNrmBase.clone(); bNrm.needsUpdate = true; bNrm.repeat.set(4, 1);
    const branchMat = heroPipeMat.clone();
    branchMat.map = bMap;
    branchMat.normalMap = bNrm;
    const branchMesh = new THREE.Mesh(new THREE.TubeGeometry(branch, 48, 0.35, 16, false), branchMat);
    branchMesh.castShadow = true;
    scene.add(branchMesh);
    branchCoreMat = new THREE.MeshBasicMaterial({
        color: 0x9fdcff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(branch, 40, 0.14, 10, false), branchCoreMat));

    // gate valves on the main line — casting body, bonnet, handwheel on the pipe axis
    const valveUs = [0.3, 0.58, 0.84];
    const bodyGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.8, 20);
    bodyGeo.rotateZ(Math.PI / 2);
    valveUs.forEach(u => {
        const p = curve.getPoint(u);
        const tan = curve.getTangent(u).normalize();
        const g = new THREE.Group();
        g.position.copy(p);
        // body aligned with the actual pipe run
        const align = new THREE.Group();
        align.quaternion.setFromUnitVectors(V3(1, 0, 0), tan);
        g.add(align);
        align.add(new THREE.Mesh(bodyGeo, matPipe));
        // bonnet + capped rising stem (world-upright)
        const neckFlange = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.08, 18), matStructure);
        neckFlange.position.y = 0.48;
        g.add(neckFlange);
        const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 0.4, 16), matStructure);
        hood.position.y = 0.72;
        g.add(hood);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 8), matIce);
        stem.position.y = 1.06;
        g.add(stem);
        // spoked handwheel on top of the stem — horizontal, facing the sky
        const wheel = new THREE.Group();
        wheel.position.y = 1.32;
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.05, 10, 26), matAccent);
        rim.rotation.x = Math.PI / 2;
        wheel.add(rim);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 12), matAccent);
        wheel.add(hub);
        for (let s = 0; s < 3; s++) {
            const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.045, 0.05), matAccent);
            spoke.rotation.y = s * Math.PI / 3;
            wheel.add(spoke);
        }
        g.add(wheel);
        scene.add(g);
        valves.push({ group: g, wheel });
    });
}

function buildTanks() {
    const shellGeo = new THREE.CylinderGeometry(3.1, 3.1, 5, 40);
    const roofGeo = new THREE.CylinderGeometry(3.22, 3.08, 0.16, 40); // flat roof, slight lip overhang
    const rimGeo = new THREE.TorusGeometry(3.2, 0.07, 10, 48);
    rimGeo.rotateX(Math.PI / 2);
    const hatchGeo = new THREE.CylinderGeometry(0.2, 0.24, 0.26, 12);
    [-28, -22, -16].forEach(x => {
        addMesh(shellGeo, matTank, x, 2.5, -30);
        addMesh(roofGeo, matTank, x, 5.04, -30);
        addMesh(rimGeo, matStructure, x, 5.12, -30);
        addMesh(hatchGeo, matStructure, x + 0.9, 5.24, -29.3); // roof hatch
    });
    // bund walls
    addMesh(new THREE.BoxGeometry(22, 1.1, 0.5), matStructure, -22, 0.55, -35.5);
    addMesh(new THREE.BoxGeometry(22, 1.1, 0.5), matStructure, -22, 0.55, -24.5);
    addMesh(new THREE.BoxGeometry(0.5, 1.1, 12), matStructure, -32.5, 0.55, -30);
    addMesh(new THREE.BoxGeometry(0.5, 1.1, 12), matStructure, -11.5, 0.55, -30);
    [-28, -22, -16].forEach(x => addAO(x, -30, 9.4, 9.4, 0.6));
}
function buildColumn() {
    const x = 16, z = -6;
    addMesh(new THREE.CylinderGeometry(1.7, 1.7, 17, 28), matTank, x, 8.5, z);
    addMesh(new THREE.ConeGeometry(1.7, 1.6, 28), matStructure, x, 17.8, z);
    const ringGeo = new THREE.TorusGeometry(1.78, 0.07, 8, 32);
    ringGeo.rotateX(Math.PI / 2);
    [3, 7, 12, 15.5].forEach(y => addMesh(ringGeo, matStructure, x, y, z));
    const platGeo = new THREE.CylinderGeometry(2.3, 2.3, 0.18, 24);
    [5.2, 10.4].forEach(y => addMesh(platGeo, matStructure, x, y, z));
    const rimH = new THREE.TorusGeometry(2.34, 0.09, 8, 40);
    rimH.rotateX(Math.PI / 2);
    [5.2, 10.4].forEach(y => addMesh(rimH, hazardMat, x, y + 0.12, z));
    addAO(x, z, 6.6, 6.6, 0.6);
}

function buildFlareStack() {
    const x = -38, z = 8;
    addMesh(new THREE.CylinderGeometry(0.32, 0.44, 19, 12), matStructure, x, 9.5, z);
    const tip = new THREE.TorusGeometry(0.5, 0.06, 8, 20);
    tip.rotateX(Math.PI / 2);
    addMesh(tip, matStructure, x, 19.05, z);
    addMesh(new THREE.CylinderGeometry(0.12, 0.12, 5.5, 8), matPipe, x + 1.6, 2.75, z + 1.6);
    addAO(x, z, 3.6, 3.6, 0.55);
}

function buildCommandCenter() {
    const x = 10, z = -18;
    addMesh(new THREE.CylinderGeometry(0.5, 0.5, 5, 18), matPipe, x, 2.5, z);
    const armGeoX = new THREE.CylinderGeometry(0.3, 0.3, 4, 12);
    armGeoX.rotateZ(Math.PI / 2);
    addMesh(armGeoX, matPipe, x, 4.2, z);
    const armGeoZ = new THREE.CylinderGeometry(0.3, 0.3, 4, 12);
    armGeoZ.rotateX(Math.PI / 2);
    addMesh(armGeoZ, matPipe, x, 4.2, z);
    // single handwheel on top of the mast — horizontal, facing the sky
    const makeWheel = () => {
        const w = new THREE.Group();
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 10, 22), matAccent);
        rim.rotation.x = Math.PI / 2; // wheel lies flat — faces the sky
        w.add(rim);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 10), matAccent);
        w.add(hub);
        for (let s = 0; s < 3; s++) {
            const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.045, 0.045), matAccent);
            spoke.rotation.y = s * Math.PI / 3;
            w.add(spoke);
        }
        return w;
    };
    // plain end caps on all four arm tips
    [[x + 2, z], [x - 2, z], [x, z + 2], [x, z - 2]].forEach(([cx, cz]) => {
        addMesh(new THREE.SphereGeometry(0.14, 10, 8), matStructure, cx, 4.2, cz);
    });
    const wheelStem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.55, 10), matStructure);
    wheelStem.position.set(x, 5.25, z);
    scene.add(wheelStem);
    const cmdWheel = makeWheel();
    cmdWheel.position.set(x, 5.58, z);
    scene.add(cmdWheel);
    cmdWheels.push(cmdWheel);
    // control cab with orange accent stripe and hazard skirt
    addMesh(new THREE.BoxGeometry(2.6, 1.8, 1.7), matDark, 13.6, 1.0, -15.2);
    addMesh(new THREE.BoxGeometry(2.62, 0.1, 1.72), matAccent, 13.6, 1.7, -15.2);
    addMesh(new THREE.BoxGeometry(2.7, 0.2, 1.8), hazardMat, 13.6, 0.1, -15.2);
    addMesh(new THREE.CylinderGeometry(0.85, 0.95, 0.5, 18), hazardMat, x, 0.25, z);
    addAO(x, z, 4.6, 4.6, 0.5);
    addAO(13.6, -15.2, 4.8, 3.8, 0.5);

    // detector nodes on poles (pulsing cyan)
    [[6.5, -14.5], [13.5, -21.5], [6.8, -21], [14, -14.8]].forEach(([dx, dz]) => {
        addMesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 8), matStructure, dx, 1.5, dz);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x0c1a30, emissive: 0x7ccfff, emissiveIntensity: 1, envMapIntensity: 0.3
        });
        addMesh(new THREE.SphereGeometry(0.3, 16, 12), mat, dx, 3.15, dz);
        detectors.push({ mat, phase: Math.random() * Math.PI * 2 });
    });
}

function buildMonitors() {
    const positions = [
        V3(-11.2, 6.6, -22.8), V3(-12.2, 5.9, -24.3), V3(-10.3, 7.2, -21.2)
    ];
    positions.forEach(pos => {
        const g = new THREE.Group();
        g.position.copy(pos);
        g.lookAt(FIRE_POS);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 0.5, 12), matStructure);
        g.add(base);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.37, 0.16, 14), hazardMat);
        band.position.y = 0.06;
        g.add(band);
        const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.3), matStructure);
        yoke.position.y = 0.28;
        g.add(yoke);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 1.5, 12), matPipe);
        barrel.rotateX(Math.PI / 2);
        barrel.position.set(0, 0.32, 0.65);
        g.add(barrel);
        const tip = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.045, 8, 18), matAccent);
        tip.position.set(0, 0.32, 1.42);
        g.add(tip);
        scene.add(g);
        jets.push({ group: g, tipLocal: V3(0, 0.32, 1.5) });
    });
}

function buildFireAndWater() {
    // several small fires instead of one giant blob:
    // dome fire on the burning tank + pool fires in the bund
    const fireDefs = [
        { pos: FIRE_POS.clone(),      base: 0.66, area: 0.55, hs: 1.3,  sMax: 10, f: 0.3 },
        { pos: V3(-25.2, 0.35, -27.6), base: 0.6,  area: 0.6,  hs: 0.5,  sMax: 8, f: 0.24 },
        { pos: V3(-18.6, 0.35, -27.2), base: 0.5,  area: 0.55, hs: 0.45, sMax: 7, f: 0.2 },
        { pos: V3(-22.6, 0.35, -33.1), base: 0.55, area: 0.6,  hs: 0.5,  sMax: 8, f: 0.24 }
    ];
    fireDefs.forEach(d => {
        const sys = buildParticles({
            count: Math.round(QUALITY.fire * d.f), area: d.area, heightSpread: d.hs,
            sizeMin: 2.5, sizeMax: d.sMax, vert: FIRE_VERT, frag: FIRE_FRAG,
            blending: THREE.AdditiveBlending
        });
        sys.position.copy(d.pos);
        sys.scale.setScalar(d.base);
        scene.add(sys);
        fires.push({ sys, base: d.base });
    });

    smokeSys = buildParticles({
        count: QUALITY.smoke, area: 2.6, heightSpread: 1.2,
        sizeMin: 4, sizeMax: 9, vert: SMOKE_VERT, frag: SMOKE_FRAG,
        blending: THREE.NormalBlending
    });
    smokeSys.position.copy(FIRE_POS).add(V3(0, 1.2, 0));
    smokeSys.scale.setScalar(1.05);
    scene.add(smokeSys);

    steamSys = buildParticles({
        count: QUALITY.steam, area: 3.2, heightSpread: 1.5,
        sizeMin: 2.2, sizeMax: 4.6, vert: STEAM_VERT, frag: STEAM_FRAG,
        blending: THREE.NormalBlending
    });
    steamSys.position.copy(FIRE_POS).add(V3(0, 0.4, 0));
    steamSys.scale.setScalar(1.1);
    scene.add(steamSys);

    pilotSys = buildParticles({
        count: QUALITY.pilot, area: 0.28, heightSpread: 0.7,
        sizeMin: 4, sizeMax: 9, vert: FIRE_VERT, frag: FIRE_FRAG,
        blending: THREE.AdditiveBlending
    });
    pilotSys.position.set(-38, 19.25, 8);
    pilotSys.scale.setScalar(0.55);
    scene.add(pilotSys);

    // splash / foam blanket hugging the burning tank dome
    const discGeo = new THREE.CircleGeometry(1.6, 36);
    discGeo.rotateX(-Math.PI / 2);
    splashDisc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({
        color: 0x9fd8ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
    }));
    splashDisc.position.copy(FIRE_POS).add(V3(0, -0.2, 0));
    scene.add(splashDisc);
    const ringGeo = new THREE.TorusGeometry(1.6, 0.05, 8, 48);
    ringGeo.rotateX(Math.PI / 2);
    splashRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xbfe8ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
    }));
    splashRing.position.copy(FIRE_POS).add(V3(0, -0.2, 0));
    scene.add(splashRing);

    // distant fire beacon — reads in the far establishing shots (scene 1),
    // fades out as the camera approaches so it never washes the close acts
    fireGlowMat = new THREE.SpriteMaterial({
        map: makeFlareSprite(), color: 0xff5a1e,
        transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const fireGlow = new THREE.Sprite(fireGlowMat);
    fireGlow.scale.set(6, 6, 1);
    fireGlow.position.copy(FIRE_POS).add(V3(0, 0.9, 0));
    fireGlow.renderOrder = 90;
    scene.add(fireGlow);
}
/* ---------- camera rig / timeline ---------- */
const SHOT_DEFS = [
    { act: 'hero', u: 0.0, pos: [46, 27, 64], look: [-6, 7.8, -6], fov: 58 },
    { act: 'hero', u: 0.55, pos: [27, 15, 44], look: [1, 7.2, 8], fov: 54 },
    { act: 'hero', u: 1.0, pos: [9.5, 10, 30.5], look: [0.6, 7.4, 22], fov: 50 },

    { act: 'network', u: 0.0, pos: [7.5, 9.8, 29], look: [0.4, 7.4, 24], fov: 48 },
    { act: 'network', u: 0.3, pos: [5.8, 9.2, 11], look: [0.4, 7.4, 10], fov: 46 },
    { act: 'network', u: 0.62, pos: [4.2, 9.4, -3], look: [0.6, 7.4, -5], fov: 47 },
    { act: 'network', u: 1.0, pos: [-0.5, 9, -12], look: [4, 6.5, -18], fov: 49 },

    { act: 'command', u: 0.0, pos: [3.5, 7.5, -9], look: [10, 4.6, -18], fov: 50 },
    { act: 'command', u: 0.45, pos: [13.5, 6.8, -10.5], look: [10, 4.8, -18], fov: 48 },
    { act: 'command', u: 1.0, pos: [10, 9.5, -26], look: [10, 4.8, -18], fov: 50 },

    { act: 'incident', u: 0.0, pos: [6, 10.5, -27], look: [6, 5.5, -22], fov: 52 },
    { act: 'incident', u: 0.45, pos: [-11, 9.5, -22.5], look: [-22, 6.0, -30], fov: 50 },
    { act: 'incident', u: 1.0, pos: [-26.5, 8.2, -17.5], look: [-22, 6.1, -30], fov: 52 },

    { act: 'suppression', u: 0.0, pos: [-30.5, 5.4, -19], look: [-22, 6.0, -30], fov: 54 },
    { act: 'suppression', u: 0.5, pos: [-33, 3.6, -15.5], look: [-22, 5.6, -30], fov: 58 },
    { act: 'suppression', u: 1.0, pos: [-18, 9.5, -3], look: [-22, 5.9, -30], fov: 52 },

    { act: 'resolution', u: 0.0, pos: [-15, 11.5, 0.5], look: [-18, 6.5, -24], fov: 52 },
    { act: 'resolution', u: 0.55, pos: [1, 20, 17], look: [-4, 6, -16], fov: 50 },
    { act: 'resolution', u: 1.0, pos: [9, 24, 28], look: [-2, 5.5, -13], fov: 48 }
];

function measureChapters() {
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const ranges = {};
    document.querySelectorAll('[data-act]').forEach(el => {
        const rect = el.getBoundingClientRect();
        const top = rect.top + window.scrollY;
        ranges[el.dataset.act] = {
            start: Math.min(0.999, top / maxScroll),
            end: Math.min(1, (top + rect.height) / maxScroll)
        };
    });
    if (ranges.resolution) ranges.resolution.end = 1;
    chapterRanges = ranges;
}

let camCurve, lookCurve;
function buildCameraRig() {
    const us = [], camPts = [], lookPts = [], fovs = [];
    SHOT_DEFS.forEach(s => {
        const r = chapterRanges && chapterRanges[s.act];
        if (!r) return;
        us.push(r.start + s.u * (r.end - r.start));
        camPts.push(V3(...s.pos));
        lookPts.push(V3(...s.look));
        fovs.push(s.fov);
    });
    // adjacent acts share the same boundary progress value — enforce a minimum
    // scroll gap between keyframes so the camera always has travel time (no cuts)
    for (let i = 1; i < us.length; i++) {
        if (us[i] < us[i - 1] + 0.006) us[i] = us[i - 1] + 0.006;
    }
    camCurve = new THREE.CatmullRomCurve3(camPts, false, 'catmullrom', 0.35);
    lookCurve = new THREE.CatmullRomCurve3(lookPts, false, 'catmullrom', 0.35);
    rig = { us, fovs };
}

const _camP = new THREE.Vector3(), _lookP = new THREE.Vector3();
/* temporally smoothed camera state — guarantees cut-free motion */
const smoothPos = new THREE.Vector3(46, 27, 64);
const smoothLook = new THREE.Vector3(2, 7, 4);
let smoothFov = 58, smoothInit = false;
let targetRoll = 0;
const _q = new THREE.Quaternion();
const UP = V3(0, 1, 0);

function sampleRig(p) {
    const { us, fovs } = rig;
    const n = us.length;
    let t, i;
    if (p <= us[0]) { i = 0; t = 0; }
    else if (p >= us[n - 1]) { i = n - 2; t = 1; }
    else {
        i = 0;
        while (i < n - 2 && p > us[i + 1]) i++;
        const local = (p - us[i]) / (us[i + 1] - us[i]);
        t = (i + local) / (n - 1);
        const fov = fovs[i] + (fovs[i + 1] - fovs[i]) * local;
        camCurve.getPoint(t, _camP);
        lookCurve.getPoint(t, _lookP);
        // bank into turns: signed yaw rate of the path, gently clamped.
        // (a raw tangent.cross() spikes to radians at act boundaries — and
        // we only ever want a few degrees of lean)
        const tA = camCurve.getTangent(Math.max(0, t - 0.005));
        const tB = camCurve.getTangent(Math.min(1, t + 0.005));
        const a = Math.atan2(tA.z, tA.x);
        const b = Math.atan2(tB.z, tB.x);
        const dYaw = Math.atan2(Math.sin(b - a), Math.cos(b - a)); // wrap to [-PI, PI]
        targetRoll = clamp(dYaw * 3, -0.16, 0.16);
        return fov;
    }
    camCurve.getPoint(t, _camP);
    lookCurve.getPoint(t, _lookP);
    return fovs[i];
}

function computeStates(p) {
    const r = chapterRanges || {};
    const net = r.network || { start: 0.12, end: 0.42 };
    const inc = r.incident || { start: 0.55, end: 0.74 };
    const sup = r.suppression || { start: 0.74, end: 0.9 };
    const res = r.resolution || { start: 0.9, end: 1 };
    const netW = net.end - net.start, incW = inc.end - inc.start;
    const supW = sup.end - sup.start, resW = res.end - res.start;

    state.flow = Math.max(0.22, ss(p, net.start, net.start + netW * 0.3));
    state.alarm = ss(p, inc.start + incW * 0.1, inc.start + incW * 0.55);
    // the plant is already burning from the very first scene —
    // suppression is what puts it out, nothing else
    const fireDie = ss(p, sup.start + supW * 0.42, sup.start + supW * 0.88);
    state.fire = 1 - fireDie;
    state.water = ss(p, sup.start + supW * 0.08, sup.start + supW * 0.5)
        * (1 - ss(p, res.start + resW * 0.35, res.start + resW * 0.75));
    state.steam = state.water * (0.35 + 0.65 * (1 - state.fire));
    // emergency siren: ON from the first scene — normal light returns in Resolution
    state.siren = 1 - ss(p, res.start + resW * 0.12, res.start + resW * 0.55);
    // all-clear: beacons pulse green once the emergency is fully resolved
    state.allclear = ss(p, res.start + resW * 0.5, res.start + resW * 0.8);
}
/* ---------- materials ---------- */
function initMaterials() {
    // brushed navy panels with seams + rivets
    const panelColorC = canvasOf(TEX, TEX, (c, w, h) => drawPanelLayer(c, w, h, mulberry32(11), false));
    const panelHeightC = canvasOf(TEX, TEX, (c, w, h) => drawPanelLayer(c, w, h, mulberry32(11), true));
    const panelRoughC = canvasOf(TEX, TEX, (ctx, w, h) => {
        ctx.fillStyle = '#8f8f8f'; ctx.fillRect(0, 0, w, h);
        for (let i = 0; i <= 4; i++) {
            const p = Math.round(i * w / 4);
            ctx.strokeStyle = '#b8b8b8'; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, h); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(w, p); ctx.stroke();
        }
    });
    matStructure = new THREE.MeshStandardMaterial({
        map: texColor(panelColorC, 2, 2),
        normalMap: texData(heightToNormal(panelHeightC, 2.2), 2, 2),
        roughnessMap: texData(new THREE.CanvasTexture(panelRoughC), 2, 2),
        metalness: 0.55, roughness: 1.0, envMapIntensity: 0.7
    });
    // tank steel with welds, grime and rust
    const tank = tankCanvases();
    const tankRoughC = canvasOf(TEX, TEX, (ctx, w, h) => {
        ctx.fillStyle = '#787878'; ctx.fillRect(0, 0, w, h);
        const g = ctx.createLinearGradient(0, h * 0.55, 0, h);
        g.addColorStop(0, 'rgba(165,165,165,0)');
        g.addColorStop(1, 'rgba(175,175,175,0.9)');
        ctx.fillStyle = g; ctx.fillRect(0, h * 0.55, w, h * 0.45);
    });
    matTank = new THREE.MeshStandardMaterial({
        map: texColor(tank.color, 1, 1),
        normalMap: texData(heightToNormal(tank.height, 2.0), 1, 1),
        roughnessMap: texData(new THREE.CanvasTexture(tankRoughC), 1, 1),
        metalness: 0.8, roughness: 1.0, envMapIntensity: 0.75
    });
    // pipe skin (u = along length, v = around circumference) — welds every 64px
    const pipe = pipeCanvases();
    pipeTexBase = texColor(pipe.color, 14, 1);
    pipeNrmBase = texData(heightToNormal(pipe.height, 2.4), 14, 1);
    // same skin re-unwrapped for cylinders (deck pipes, valves, monitors):
    // their length runs along V, so the weld sheet is rotated 90°
    matPipe = new THREE.MeshStandardMaterial({
        map: texColor(rotateCanvas(pipe.color), 2, 1),
        normalMap: texData(heightToNormal(rotateCanvas(pipe.height), 2.4), 2, 1),
        metalness: 0.9, roughness: 0.38, envMapIntensity: 0.85
    });
    // ground asphalt
    const asph = asphaltCanvases();
    matGround = new THREE.MeshStandardMaterial({
        map: texColor(asph.color, 30, 30),
        normalMap: texData(heightToNormal(asph.height, 1.6), 30, 30),
        roughness: 0.95, metalness: 0.05, envMapIntensity: 0.25
    });
    // safety stripes + shared AO decal texture
    hazardMat = new THREE.MeshStandardMaterial({
        map: hazardTexture(), roughness: 0.55, metalness: 0.35, envMapIntensity: 0.5
    });
    aoTex = aoTexture();
    matDark = metalMaterial(0x0a1428, 0.6, 0.4);
    matAccent = new THREE.MeshBasicMaterial({ color: COLORS.orange });
    matIce = new THREE.MeshBasicMaterial({ color: 0x9fdcff });
    matGlowValve = new THREE.MeshBasicMaterial({ color: COLORS.orange, transparent: true, opacity: 0.25 });
}

/* ---------- water jets ---------- */
function buildJets() {
    scene.updateMatrixWorld(true);
    const dur = 1.0;
    jets.forEach(j => {
        const origin = j.group.localToWorld(j.tipLocal.clone());
        const vel = FIRE_POS.clone().sub(origin).divideScalar(dur).add(V3(0, 4.9 * dur, 0));
        const points = buildParticles({
            count: QUALITY.jet, area: 0.01, heightSpread: 0.01,
            sizeMin: 4.5, sizeMax: 7, vert: JET_VERT, frag: JET_FRAG,
            blending: THREE.AdditiveBlending
        });
        const u = points.material.uniforms;
        u.uOrigin = { value: origin };
        u.uVel = { value: vel };
        u.uGrav = { value: -9.8 };
        u.uDur = { value: dur };
        u.uSize = { value: 1.6 };
        scene.add(points);
        j.points = points;
    });
}

/* ---------- per-frame updates ---------- */
const _lookDir = new THREE.Vector3(), _right = new THREE.Vector3();
const _bg = new THREE.Color(), _base = new THREE.Color(COLORS.bg);
const _warm = new THREE.Color(COLORS.warm), _cool = new THREE.Color(COLORS.cool);
/* ---------- emergency siren rig — low red/white alarm wash at valve level ---------- */
function buildSirenSystem() {
    // emergency wash — LOW, at valve level: a red raking light hugging the
    // pipe run toward the bund (the old overhead "ceiling" spot is gone)
    sirenLight = new THREE.SpotLight(0xff2416, 0, 80, 0.8, 0.7, 0);
    sirenLight.position.set(1.0, 1.4, 10);
    sirenLight.target.position.set(0.2, 1.0, -16);
    scene.add(sirenLight);
    scene.add(sirenLight.target);

    // siren lamps across the plant — alternating red / white, stop at resolution
    const lampPoleMat = metalMaterial(0x1a2438, 0.5, 0.6);
    [
        [6.0, 3.1, 14.0], [-4.0, 3.4, -8.0], [14.0, 2.9, -11.0],
        [-10.0, 3.2, -25.0], [20.0, 3.0, -3.0], [-30.0, 3.1, 5.0]
    ].forEach(([lx, lh, lz], i) => {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, lh, 8), lampPoleMat);
        pole.position.set(lx, lh / 2, lz);
        scene.add(pole);
        const headMat = new THREE.MeshBasicMaterial({ color: 0x1a0c0a });
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), headMat);
        head.position.set(lx, lh + 0.16, lz);
        scene.add(head);
        sirenLamps.push({ mat: headMat, white: i % 2 === 1 });
    });
}

const _beaconCalm = new THREE.Color(0x223049), _beaconRed = new THREE.Color(0xff3b30);
const _hemiBase = new THREE.Color(0x3a5aa8), _hemiWarm = new THREE.Color(0x8a4520), _hemiCool = new THREE.Color(0x4a86c8);
const _hemiRed = new THREE.Color(0x8a1a14), _bgRed = new THREE.Color(0x2b0806);
const _skyTopBase = new THREE.Color(0x020409), _skyHorBase = new THREE.Color(0x0b1c34);
const _skyTopRed = new THREE.Color(0x140608), _skyHorRed = new THREE.Color(0x46100c);
const _sirenRedLight = new THREE.Color(0xff2416), _sirenWhiteLight = new THREE.Color(0xfff3e4);
const _beaconWhite = new THREE.Color(0xfff0e2);
const _beaconGreen = new THREE.Color(0x35ff70);
const _cmdCyan = new THREE.Color(0x7ccfff), _cmdRed = new THREE.Color(0xff3030);
const _cmdTmp = new THREE.Color();

function updateScene(t) {
    flowTex.offset.x = -(t * 0.45) % 1;
    heroPipeMat.emissiveIntensity = 0.25 + state.flow * (0.75 + 0.2 * Math.sin(t * 3.0));
    coreTubeMat.opacity = state.flow * 0.55;
    branchCoreMat.opacity = state.flow * 0.55;

    const net = (chapterRanges && chapterRanges.network) || { start: 0.12, end: 0.42 };
    valves.forEach((v, i) => {
        const openAt = net.start + ((i + 1) / (valves.length + 1)) * (net.end - net.start);
        const o = ss(state.p, openAt - 0.02, openAt + 0.045);
        v.wheel.rotation.y = o * 2.6;
    });

    // command act color protocol — the command post lights up red, then green
    const cmd = (chapterRanges && chapterRanges.command) || { start: 0.42, end: 0.55 };
    const cmdW = cmd.end - cmd.start;
    const cmdT = clamp((state.p - cmd.start) / Math.max(1e-5, cmdW), 0, 1);
    const cmdOn = ss(state.p, cmd.start, cmd.start + cmdW * 0.15)
        * (1 - ss(state.p, cmd.end + cmdW * 0.1, cmd.end + cmdW * 0.6));
    const cmdPhase = ss(state.p, cmd.start + cmdW * 0.45, cmd.start + cmdW * 0.62);
    _cmdTmp.copy(_cmdRed).lerp(_beaconGreen, cmdPhase);

    // siren strobe — alternating red / white like a real plant alarm
    const sirenCyc = (t * 0.9) % 1;
    const sirenRed = sirenCyc < 0.5;
    const strobeShape = reducedMotion ? 0.75 : (sirenRed
        ? ss(sirenCyc, 0, 0.07) * (1 - ss(sirenCyc, 0.43, 0.5))
        : ss(sirenCyc, 0.5, 0.57) * (1 - ss(sirenCyc, 0.93, 1)));
    state.strobe = state.siren * strobeShape;

    const flash = clamp(Math.max(state.strobe, state.alarm * (0.55 + 0.45 * Math.sin(t * 9.0))), 0, 1);
    if (sirenRed) beaconMat.color.copy(_beaconCalm).lerp(_beaconRed, flash);
    else beaconMat.color.copy(_beaconCalm).lerp(_beaconWhite, flash);
    // all-clear — calm green pulse once the emergency is resolved
    if (state.allclear > 0.001) {
        const gp = state.allclear * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 3.2)));
        beaconMat.color.lerp(_beaconGreen, gp);
    }

    detectors.forEach(d => {
        d.mat.emissiveIntensity = 0.55 + 0.5 * Math.sin(t * 2.4 + d.phase);
        d.mat.emissive.copy(_cmdCyan).lerp(_cmdTmp, cmdOn * 0.9);
    });

    runwayMat.opacity = 0.55 + 0.3 * Math.sin(t * 2.2);

    // scene 3 — command protocol: the single handwheel spins up
    cmdWheels.forEach((w, i) => { w.rotation.y = t * (0.4 + cmdT * 1.9) + i * 0.8; });
    fires.forEach((f, i) => {
        // each fire flickers on its own rhythm — never a synchronized blob
        const fp = 1 + Math.sin(t * (26 + i * 7.3) + i * 2.1) * 0.06
                     + Math.sin(t * (41 + i * 5.1)) * 0.04;
        f.sys.material.uniforms.uTime.value = t + i * 3.7;
        f.sys.material.uniforms.uIntensity.value = state.fire;
        f.sys.scale.setScalar(f.base * (0.55 + 0.45 * state.fire) * fp);
        f.sys.visible = state.fire > 0.005;
    });
    fireLight.intensity = state.fire * (10 + Math.sin(t * 29) * 2.6 + Math.sin(t * 47) * 1.6)
        * clamp(camera.position.distanceTo(FIRE_POS) / 18, 0.55, 1);
    fireLight.visible = state.fire > 0.005;
    poolLight.intensity = state.fire * (3.5 + Math.sin(t * 33.7) * 1.0);
    poolLight.visible = state.fire > 0.005;
    // distant glow beacon — only from afar, gone before the close-up acts
    if (fireGlowMat) {
        const d = camera.position.distanceTo(FIRE_POS);
        fireGlowMat.opacity = state.fire * 0.25 * clamp((d - 20) / 34, 0, 1);
    }

    smokeSys.material.uniforms.uTime.value = t;
    smokeSys.material.uniforms.uIntensity.value = state.fire * 0.9;
    smokeSys.visible = state.fire > 0.01;

    steamSys.material.uniforms.uTime.value = t;
    steamSys.material.uniforms.uIntensity.value = state.steam;
    steamSys.visible = state.steam > 0.01;

    pilotSys.material.uniforms.uTime.value = t;
    pilotSys.material.uniforms.uIntensity.value = 0.55 + 0.1 * Math.sin(t * 11) + 0.06 * Math.sin(t * 23);
    flareLight.intensity = 16 + Math.sin(t * 13) * 5 + Math.sin(t * 5.1) * 3;

    jets.forEach(j => {
        j.points.material.uniforms.uTime.value = t;
        j.points.material.uniforms.uIntensity.value = state.water;
        j.points.visible = state.water > 0.005;
    });
    splashDisc.material.opacity = state.water * (0.1 + 0.04 * Math.sin(t * 6.3));
    splashRing.material.opacity = state.water * (0.25 + 0.08 * Math.sin(t * 5.1));
    const splashScale = 0.7 + 0.5 * state.water + 0.04 * Math.sin(t * 5.7);
    splashDisc.scale.setScalar(splashScale);
    splashRing.scale.setScalar(splashScale);

    const res = (chapterRanges && chapterRanges.resolution) || { start: 0.9, end: 1 };
    const resW = res.end - res.start;
    const cool = ss(state.p, res.start + resW * 0.15, res.start + resW * 0.7);
    _bg.copy(_base).lerp(_warm, state.fire * 0.85).lerp(_cool, cool)
        .lerp(_bgRed, state.siren * (0.22 + 0.25 * state.strobe));
    scene.background.copy(_bg);
    scene.fog.color.copy(_bg);
    scene.fog.density = 0.006 + state.fire * 0.001;
    hemiLight.color.copy(_hemiBase).lerp(_hemiWarm, state.fire * 0.6).lerp(_hemiCool, cool * 0.5)
        .lerp(_hemiRed, state.siren * (0.15 + 0.25 * state.strobe));
    hemiLight.intensity = 0.55 + state.fire * 0.25;
    // sky dome follows the alarm, then relaxes to normal night in Resolution
    if (skyMat) {
        const sirenSky = state.siren * (0.3 + 0.5 * state.strobe);
        skyMat.uniforms.topColor.value.copy(_skyTopBase).lerp(_skyTopRed, sirenSky);
        skyMat.uniforms.horizonColor.value.copy(_skyHorBase).lerp(_skyHorRed, sirenSky);
    }
    // low valve-level siren wash (red / white alternating)
    const sirenCol = sirenRed ? _sirenRedLight : _sirenWhiteLight;
    if (sirenLight) {
        sirenLight.color.copy(sirenCol);
        sirenLight.intensity = state.strobe * 1.2;
    }
    // siren lamps: alternating red / white blink — fade out completely in Resolution
    sirenLamps.forEach(lamp => {
        const mine = lamp.white === !sirenRed;
        const glow = 0.15 * state.siren + (mine ? state.strobe * 1.15 : 0);
        lamp.mat.color.copy(lamp.white ? _sirenWhiteLight : _sirenRedLight)
            .multiplyScalar(0.1 + glow);
    });
        starsMat.opacity = 0.5 + 0.18 * Math.sin(t * 0.6);

    // heat haze intensifies with fire (kept subtle — part of the scene, not a glare)
    if (heatHaze) {
        heatHaze.uniforms.uTime.value = t;
        heatHaze.uniforms.uIntensity.value = state.fire * 0.35 + state.alarm * 0.2;
    }

    // flare sprite pulses warm like real gas combustion
    if (flareSpriteMat) {
        const flarePulse = 1.0 + Math.sin(t * 8.3) * 0.1 + Math.sin(t * 13.7) * 0.07;
        flareSpriteMat.opacity = clamp(0.45 + state.fire * 0.25 + state.alarm * 0.3, 0, 1) * flarePulse;
        const warm = 0.5 + Math.sin(t * 5.1) * 0.06; // subtle orange-gold breathing
        flareSpriteMat.color.setHSL(0.075, 0.95, warm);
    }
}

/* ---------- camera rig ---------- */
function updateCamera(t, dt) {
    state.pointerSmooth.x = THREE.MathUtils.damp(state.pointerSmooth.x, state.pointer.x, 5, dt);
    state.pointerSmooth.y = THREE.MathUtils.damp(state.pointerSmooth.y, state.pointer.y, 5, dt);
    const fov = sampleRig(state.p);
    _lookDir.subVectors(_lookP, _camP).normalize();
    _right.crossVectors(_lookDir, UP).normalize();
    _camP.addScaledVector(_right, state.pointerSmooth.x * 1.3);
    _camP.y += -state.pointerSmooth.y * 0.7 + Math.sin(t * 0.45) * 0.18;
    // critical-damped spring smoothing — faster, no velocity kink between acts
    const k = reducedMotion ? 1 : 1 - Math.exp(-8 * dt);
    if (!smoothInit) {
        smoothPos.copy(_camP); smoothLook.copy(_lookP); smoothFov = fov;
        smoothInit = true;
    }
    smoothPos.lerp(_camP, k);
    smoothLook.lerp(_lookP, k);
    smoothFov += (fov - smoothFov) * k;
    // damp roll toward target (banks into turns, settles during straights)
    state.roll = THREE.MathUtils.damp(state.roll, targetRoll, 10, dt);

    camera.position.copy(smoothPos);
    // lookAt keeps a stable world-up — never tumbles when the view direction
    // passes near +Z (where shortest-arc quaternions are ill-defined)
    camera.lookAt(smoothLook);
    // cinematic bank = controlled twist around the view axis
    if (Math.abs(state.roll) > 0.0005 && !reducedMotion) {
        const fwd = V3().subVectors(smoothLook, smoothPos).normalize();
        camera.quaternion.premultiply(_q.setFromAxisAngle(fwd, state.roll));
    }
    // handheld shake during incident (alarm-driven)
    if (state.alarm > 0.01 && !reducedMotion) {
        const s = state.alarm * 0.022;
        camera.position.x += (Math.sin(t * 31.71) * 0.5 + Math.cos(t * 13.17) * 0.5) * s;
        camera.position.y += (Math.sin(t * 23.41) * 0.5 + Math.cos(t * 17.83) * 0.5) * s;
        camera.position.z += (Math.sin(t * 41.91) * 0.5 + Math.cos(t * 29.29) * 0.5) * s;
    }
    if (Math.abs(camera.fov - smoothFov) > 0.02) {
        camera.fov = smoothFov;
        camera.updateProjectionMatrix();
    }
}

/* ---------- HUD / progress ---------- */
const ACT_ORDER = ['hero', 'network', 'command', 'incident', 'suppression', 'resolution'];
function updateHud() {
    if (!chapterRanges) return;
    let idx = 0;
    for (let i = 0; i < ACT_ORDER.length; i++) {
        const r = chapterRanges[ACT_ORDER[i]];
        if (r && state.p >= r.start - 0.002) idx = i;
    }
    if (idx !== state.actIndex) {
        state.actIndex = idx;
        window.dispatchEvent(new CustomEvent('safyron:act', { detail: { index: idx } }));
    }
    const net = chapterRanges.network;
    if (net) {
        const nt = THREE.MathUtils.clamp((state.p - net.start) / Math.max(1e-5, net.end - net.start), 0, 1);
        const step = Math.min(5, Math.floor(nt * 6));
        if (step !== state.netStep) {
            state.netStep = step;
            window.dispatchEvent(new CustomEvent('safyron:network', { detail: { index: step, t: nt } }));
        }
    }
}

function getScrollProgress() {
    const doc = document.documentElement;
    return THREE.MathUtils.clamp(
        window.scrollY / Math.max(1, doc.scrollHeight - window.innerHeight), 0, 1
    );
}

/* ---------- main loop ---------- */
function tick() {
    requestAnimationFrame(tick);
    if (document.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    state.targetP = getScrollProgress();
    state.p = reducedMotion ? state.targetP : THREE.MathUtils.damp(state.p, state.targetP, 3.4, dt);
    if (!reducedMotion) state.time += dt;
        computeStates(state.p);
    updateScene(state.time);
    updateCamera(state.time, dt);
    updateHud();
    // drive film-grade post uniforms
    if (filmPass) {
        filmPass.uniforms.uTime.value = state.time;
        filmPass.uniforms.uIntensity.value = 1.0 + state.alarm * 0.15;
        filmPass.uniforms.uVignette.value = 0.35 + state.fire * 0.2;
    }
    // bloom stays restrained — glow, never whiteout; fire boost eases off up close
    if (bloomPass) {
        const dFire = camera.position.distanceTo(FIRE_POS);
        bloomPass.strength = 0.36 + state.fire * 0.13 * clamp(dFire / 26, 0.55, 1);
    }
    // flat exposure — total predictability, no blowouts
    renderer.toneMappingExposure = 1.0;
    if (composer) composer.render(); else renderer.render(scene, camera);
    if (!state.ready) {
        state.ready = true;
        window.dispatchEvent(new CustomEvent('safyron:ready'));
    }
}

/* ---------- boot ---------- */
let resizeTimer = null;
function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        if (composer) composer.setSize(window.innerWidth, window.innerHeight);
        measureChapters();
        buildCameraRig();
    }, 120);
}
function onPointerMove(e) {
    state.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    state.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
}
function fail(err) {
    console.warn('[safyron3d] falling back to 2D:', err && err.message ? err.message : err);
    window.dispatchEvent(new CustomEvent('safyron:error'));
}

function init() {
    if (!webglAvailable()) { fail(new Error('WebGL unavailable')); return; }
    try {
        initRenderer();
        initMaterials();
        initEnvironment();
        buildPipeRack();
        buildHeroPipe();
        buildTanks();
        buildColumn();
        buildFlareStack();
        buildCommandCenter();
        buildSirenSystem();
        buildMonitors();
        buildFireAndWater();
        buildJets();
        measureChapters();
        buildCameraRig();
        sampleRig(0);
        camera.position.copy(_camP);
        camera.lookAt(_lookP);
        window.addEventListener('resize', onResize);
        window.addEventListener('load', () => {
            measureChapters();
            buildCameraRig();
        });
        window.addEventListener('pointermove', onPointerMove, { passive: true });
        renderer.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            fail(new Error('WebGL context lost'));
        });
        tick();
    } catch (err) {
        fail(err);
    }
}

init();







