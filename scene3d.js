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

/* ==========================================================================
   TANK FARM LAYOUT — dike (bund) fire outside TK-001, fixed roof intact.

   Scenario: a pool fire in the TK-001 dike. The roof foam chamber is
   INSTALLED but held CLOSED (correct NFPA 11 isolation logic) because
   there is no full-surface fire. Protection comes from:
     - dike low-level foam outlets  (NFPA 11 5.7   4.1 L/min/m2)
     - shell cooling water rings    (NFPA 15 / API 2001, 2030)
   TK-001 shell above the pool fire takes 8.1 L/min/m2 (directly exposed),
   TK-002 takes 4.1 L/min/m2 (adjacent exposure).
   ========================================================================== */
const TANKS = [
    { id: 'TK-001', x: -36, z: -34, burning: true },
    { id: 'TK-002', x: -6, z: -34, burning: false }
];

const TANK = {
    R: 6,            // shell radius -> 12 m diameter
    H: 11,           // shell height
    ROOF: 12.1,      // cone apex height
    /* Individual dike footprint (24 x 24 m). 16 m left only a 2 m annulus
       around a 12 m shell, so from any low camera the tank straddled the
       containment wall instead of sitting inside it. 24 m gives a 6 m clear
       ring of bund floor between shell and wall. */
    DIKE: 24
};

/* Pool fire sits in the dike ANNULUS, between the TK-001 shell (r=6) and the
   dike wall (half = 12). Offset 9.5 m from the tank axis puts it mid-annulus:
   3.5 m clear of the shell, 2.5 m clear of the containment wall. */
const FIRE_POS = new THREE.Vector3(-26.5, 0.3, -34);
const COLORS = {
    bg: 0x050b16,
    warm: 0x1a0d06,
    cool: 0x04101f,
    navy: 0x1a3263,
    orange: 0xfab95b,
    ice: 0xe9f0ff,
    fireLight: 0xff7a2a
};

/* --------------------------------------------------------------------------
   THEME

   The page themes itself with <html data-theme>, but the WebGL canvas owns its
   own colour pipeline — three.js colours can't come from CSS. So each theme
   declares a full palette here and applyTheme() swaps the live ones in.

   Light mode is a DAYLIGHT reading of the same scene: a hazy blue-white sky,
   brighter/less saturated fill light, and the starfield switched off. The
   palette only sets the BASE state — the existing per-frame animation
   (fire warmth, siren red, resolution cooling) still lerps on top of whatever
   the active base is, so the narrative beats work identically in both themes.
   -------------------------------------------------------------------------- */
const SCENE_THEMES = {
    dark: {
        bg: 0x050b16,          // scene background / fog base
        warm: 0x1a0d06,        // background tint as the dike fire grows
        cool: 0x04101f,        // background tint in the resolution act
        bgRed: 0x2b0806,       // siren wash on the background
        hemiSky: 0x3a5aa8,     // hemisphere light sky term
        hemiGround: 0x05070d,  // hemisphere light ground term
        hemiWarm: 0x8a4520,    // hemisphere tint under fire load
        hemiCool: 0x4a86c8,    // hemisphere tint during cooling
        hemiRed: 0x8a1a14,     // hemisphere tint under siren
        hemiBase: 0.55,        // baseline hemisphere intensity
        dir: 0x9fc4ff,         // key light colour
        dirIntensity: 1.2,
        rim: 0x2a4a8f,         // fill/rim light colour
        rimIntensity: 0.5,
        skyTop: 0x020409,      // sky dome zenith
        skyHorizon: 0x0b1c34,  // sky dome horizon
        exposure: 1.12,
        fogDensity: 0.006,
        stars: true,
        envIntensity: 0.55
    },
    light: {
        bg: 0xb9cfe4,          // hazy daylight sky, not white — keeps depth
        warm: 0xbfae9a,
        cool: 0xc9dcec,
        bgRed: 0xc9a79e,
        hemiSky: 0xdfeaff,
        hemiGround: 0xa9b4c4,
        hemiWarm: 0xd9a978,
        hemiCool: 0xa8c8e8,
        hemiRed: 0xc08a80,
        hemiBase: 1.35,        // daylight needs far more ambient bounce
        dir: 0xfff4e2,         // warm daylight key
        dirIntensity: 2.1,
        rim: 0xa8c4e8,         // cool sky bounce from behind
        rimIntensity: 0.95,
        skyTop: 0x7ea8d4,
        skyHorizon: 0xdce8f4,
        exposure: 1.0,         // pull back — the scene is already brighter
        fogDensity: 0.0055,
        stars: false,
        envIntensity: 0.9
    }
};

let sceneTheme = 'dark';
/* read whatever the <head> script already committed, so the first frame is right */
if (document.documentElement.getAttribute('data-theme') === 'light') sceneTheme = 'light';

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
const valves = [], detectors = [], cmdWheels = [];
let splashDisc, splashRing, runwayLights;
let smokeSys, steamSys, pilotSys, poolLight;
const fires = [];
let fireLight, flareLight, hemiLight;
let starsMat, grid, heatHaze, flareSpriteMat, fireGlowMat;
let starPoints = null;
let sirenLight, skyMat;
const sirenLamps = [];

/* ---------- new fire-protection system registries ---------- */
const irCameras = [];        // { group, cone, lensMat, target }
const panelLamps = [];       // FACP mimic + status lamps
const signalTraces = [];     // camera -> FACP signal pulses
const coolingRings = [];     // { tank, nozzles[], points }
const bundFoam = [];         // foam blanket filling the dike
const processValves = [];    // { id, wheel, indicator, actuator }
const pumpUnits = [];        // { type, rotor, lamp }
const pumpFlowPulses = [];
let pumpDischargeFlow = null;
const gauges = [];           // { pivot, face }
const dispensers = [];       // { tank, jet } — foam monitor arcing over the dike wall
let pumpHouseGroup = null;

/* ==========================================================================
   LIVE PROCESS READOUT — every number below is computed from the NFPA 11 /
   NFPA 15 / API 2001 formulas, never hardcoded strings. The HUD renders
   these directly so the on-screen values and the 3D geometry agree.
   ========================================================================== */
const DESIGN = (() => {
    const R = TANK.R, H = TANK.H, D = TANK.DIKE;
    const tankFootprint = Math.PI * R * R;            // 113.1 m2
    const dikeArea = D * D;                            // 256 m2
    const protectedDike = dikeArea - tankFootprint;    // 142.9 m2
    const RATE_DIKE = 4.1;      // NFPA 11 5.7  fixed outlets, hydrocarbon
    const RATE_EXPOSED = 8.1;   // NFPA 15 / API 2001 directly exposed shell
    const RATE_ADJACENT = 4.1;   // NFPA 15 / API 2030 adjacent tank
    const CONC = 0.03;          // 3% AFFF
    const MIN_PRESS = 2.76;     // NFPA 11 foam chamber minimum (bar)
    const OPT_PRESS = [4.5, 6.9];
    const P_STATIC = 10.0;      // ring main static, jockey pump
    const P_TRIP = 7.0;         // 70% low-pressure switch -> fire pumps start

    // exposed shell fractions (tank facing / away from the pool fire).
    // lateral shell area of a vertical cylinder = PI * D * H  (NOT 2*PI*D*H)
    const shellFull = Math.PI * (2 * R) * H;             // 414.7 m2 for D=12, H=11
    const expA = shellFull * 0.60;                     // TK-001 faces the fire
    const expB = shellFull * 0.40;                     // TK-002 adjacent

    const qFoam = protectedDike * RATE_DIKE;           // L/min dike foam
    const qCoolA = expA * RATE_EXPOSED;                // L/min TK-001 cooling
    const qCoolB = expB * RATE_ADJACENT;               // L/min TK-002 cooling
    const qTotal = qFoam + qCoolA + qCoolB;            // L/min total demand
    const duration = 55;                               // min, FP < 37.8 C gasoline
    const solution = qFoam * duration;                 // L of foam solution
    const concentrate = solution * CONC;               // L of AFFF

    return {
        R, H, D, tankFootprint, dikeArea, protectedDike,
        RATE_DIKE, RATE_EXPOSED, RATE_ADJACENT, CONC, MIN_PRESS, OPT_PRESS,
        P_STATIC, P_TRIP, shellFull, expA, expB,
        qFoam, qCoolA, qCoolB, qTotal, duration, solution, concentrate,
        m3h: qTotal * 60 / 1000                        // m3/h total demand
    };
})();

const state = {
    p: 0, targetP: 0, time: 0,
    pointer: new THREE.Vector2(), pointerSmooth: new THREE.Vector2(),
    fire: 0, water: 0, steam: 0, alarm: 0, flow: 0.2,
    siren: 0, actIndex: -1, netStep: -1, ready: false, roll: 0,

    detect: 0,        // IR cameras on TK-001
    signal: 0,        // signal travelling camera -> FACP
    valveOpen: 0,     // V-101 fire-water deluge valve commanded open
    dikeFoam: 0,      // dike low-level foam flowing
    bundFill: 0,      // bund filling with foam blanket
    coolA: 0,         // TK-001 shell cooling ring  8.1 L/min/m2
    coolB: 0,         // TK-002 shell cooling ring  4.1 L/min/m2
    pressure: DESIGN.P_STATIC,
    pumpStart: 0,     // fire pumps auto-started on low-pressure trip
    jockeyStart: 0,   // jockey pump starts when the camera reaches its unit
    allclear: 0
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
/* fire-protection colour coding — foam tank, fire-water piping and the
   foam system valves are red (ISO 14750 / NFPA practice) so the fixed
   fire-fighting equipment reads instantly against the navy plant steel */
let matFireRed, matFireWater;

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
    // a real pool fire is masked at its base by its own smoke/steam, and the
    // young particles are the ones that sit lowest and spread widest (see
    // FIRE_VERT: spread = 1 - life*0.85, p.y ~ position.y*0.18 at life 0).
    // Giving them full alpha painted the whole dike floor with additive haze,
    // which is what washed out as a white sheet. Fade them in instead so the
    // flame keeps a hot body higher up but stops glowing through the foam.
    alpha *= smoothstep(0.0, 0.22, vLife)
           * smoothstep(1.0, 0.5, vLife) * uIntensity;
    // per-particle temperature variance
    float temp = vSeed * 0.25;
    vec3 core = vec3(1.0, 0.93, 0.60);
    vec3 mid  = vec3(1.0, 0.56 + temp, 0.16);
    vec3 tip  = vec3(0.62, 0.10, 0.04);
    vec3 col = mix(core, mid, smoothstep(0.0, 0.32, vLife));
    col = mix(col, tip, smoothstep(0.42, 0.95, vLife));
    col = mix(col, vec3(1.0, 0.82, 0.45), vEmber * 0.6);
    // HDR core — keeps the flame over the bloom threshold so it still glows,
    // but only just: at 1.3 the additive stack of ~400 sprites snowballed the
    // dike into a whiteout instead of reading as fire.
    float heat = 1.05 - vLife * 0.35 + vEmber * 0.40;
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
    // cooling-tower steam is lit mist, not a light source — its stacked colour
    // has to stay under the bloom threshold or the plume turns into a white wall
    float alpha = exp(-d * d * 3.0) * 0.18 * uIntensity;
    alpha *= smoothstep(0.0, 0.1, vLife) * (1.0 - smoothstep(0.7, 1.0, vLife));
    vec3 col = mix(vec3(0.60, 0.66, 0.74), vec3(0.70, 0.74, 0.81), vSeed * 0.5);
    gl_FragColor = vec4(col, alpha);
}`;
/* ---------- ring emitter: cylindrical curtain (roof cooling ring / dike foam) ---------- */
const RING_VERT = `
attribute float aSeed;
attribute float aSize;
uniform float uTime;
uniform float uIntensity;
uniform float uSpeed;
uniform float uRise;
uniform float uRadius;
uniform float uGrav;
varying float vFade;
varying float vSeed;
void main() {
    vSeed = aSeed;
    float T = fract(uTime * 0.42 + aSeed) * (1.0 / 0.42);
    float ang = aSeed * 6.28318;
    vec3 radial = vec3(cos(ang), 0.0, sin(ang));
    // curtain starts at the ring radius, travels out and falls down the shell
    vec3 p = radial * (uRadius + uSpeed * T)
           + vec3(0.0, uRise * T + 0.5 * uGrav * T * T, 0.0);
    vFade = smoothstep(0.0, 0.08, T * 0.42) * (1.0 - smoothstep(0.7, 1.0, T * 0.42));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * uIntensity * (0.7 + 0.5 * aSeed) * (150.0 / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv;
}`;
const RING_FRAG = `
uniform float uIntensity;
uniform vec3 uColor;
varying float vFade;
varying float vSeed;
void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    // a shell-cooling curtain is thin water mist seen edge-on, not a white wall
    float body = exp(-d * d * 4.0);
    float alpha = body * 0.22 * uIntensity * vFade;
    // the curtain's tint is scaled down so even fully stacked it stays below
    // the bloom threshold — water mist should read as wet, never as glowing
    gl_FragColor = vec4(uColor * (0.45 + vSeed * 0.18), alpha);
}`;

/* ---------- foam blanket emitter: fills the dike from the low-level outlets ---------- */
const FOAM_VERT = `
attribute float aSeed;
attribute float aSize;
uniform float uTime;
uniform float uIntensity;
uniform float uSpread;
varying float vLife;
varying float vSeed;
void main() {
    float life = fract(uTime * 0.22 + aSeed * 5.3);
    vLife = life; vSeed = aSeed;
    // seeded across the dike annulus: between the shell and the wall
    float ang = aSeed * 6.28318;
    float rad = 1.6 + fract(aSeed * 91.7) * uSpread;
    vec3 p = vec3(cos(ang) * rad, 0.05, sin(ang) * rad);
    // rises slightly then settles as the blanket builds
    p.y += life * 0.55;
    p.x += sin(uTime * 1.4 + aSeed * 31.0) * 0.12 * life;
    p.z += cos(uTime * 1.2 + aSeed * 19.0) * 0.12 * life;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * (0.5 + life * 1.4) * uIntensity * (150.0 / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv;
}`;
const FOAM_FRAG = `
uniform float uIntensity;
varying float vLife;
varying float vSeed;
void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    // kept deliberately translucent: the dike foam, the blanket mesh and the
    // bund disc all stack in the same few square metres, and anything stronger
    // saturates the bloom pass into a white blob
    // real aqueous foam is a dull, slightly chalky off-white — NOT a white
    // emitter. Kept well below the bloom threshold so the dike reads as a
    // blanket of foam instead of a light source.
    float alpha = exp(-d * d * 3.2) * 0.34 * uIntensity;
    alpha *= smoothstep(0.0, 0.15, vLife) * (1.0 - smoothstep(0.55, 1.0, vLife));
    vec3 col = mix(vec3(0.50, 0.55, 0.64), vec3(0.60, 0.64, 0.72), vSeed * 0.6);
    gl_FragColor = vec4(col, alpha);
}`;

/* ---------- foam dispenser: short, gentle discharge into the nearby dike ----------
   Local +Z points into the dike (the jet group is yawed 180 deg), +Y is up.
   Keep the throw low and short so the foam pours beside the monitor. */
const FOAM_JET_VERT = `
attribute float aSeed;
attribute float aSize;
uniform float uTime;
uniform float uIntensity;
varying float vLife;
varying float vSeed;
void main() {
    float life = fract(uTime * 0.45 + aSeed * 7.31);
    vLife = life; vSeed = aSeed;
    // Short low-flow pour: a small fan falls within a few metres of the nozzle.
    float T = life * 1.35;
    float vz = 2.0 + fract(aSeed * 17.3) * 0.45;
    float vy = 0.65 + fract(aSeed * 29.7) * 0.2;
    float vx = (fract(aSeed * 53.9) - 0.5) * 0.32;
    vec3 p = vec3(vx * T, vy * T - 2.1 * T * T, vz * T);
    p.x += sin(uTime * 2.2 + aSeed * 43.0) * 0.025;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * (0.5 + life * 1.4) * uIntensity * (150.0 / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv;
}`;
const FOAM_JET_FRAG = `
uniform float uIntensity;
varying float vLife;
varying float vSeed;
void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    // same chalky, sub-bloom foam body as the blanket: a thrown jet is
    // aerated foam, slightly brighter than the floor layer but still dim
    float alpha = exp(-d * d * 3.0) * 0.36 * uIntensity;
    alpha *= smoothstep(0.0, 0.07, vLife) * (1.0 - smoothstep(0.8, 1.0, vLife));
    vec3 col = mix(vec3(0.55, 0.59, 0.67), vec3(0.70, 0.73, 0.80), vSeed * 0.6);
    gl_FragColor = vec4(col, alpha);
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
    renderer.toneMappingExposure = SCENE_THEMES[sceneTheme].exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // the facility is static — bake the shadow map once instead of per frame
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(SCENE_THEMES[sceneTheme].bg);
    scene.fog = new THREE.FogExp2(SCENE_THEMES[sceneTheme].bg, SCENE_THEMES[sceneTheme].fogDensity);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 420);
    camera.position.set(46, 27, 64);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    // NOTE: three r160 has no Scene.environmentIntensity — the per-material
    // IBL scale is applied by applyEnvIntensity() once the world is built.
    pmrem.dispose();

    if (!isMobile) {
        // default composer target is HalfFloat — true HDR chain so bloom
        // reads real energy from fire/emissives instead of clamped LDR
        composer = new EffectComposer(renderer);
        composer.setPixelRatio(renderer.getPixelRatio());
        composer.setSize(window.innerWidth, window.innerHeight);

        // 1 — geometry + lighting → HDR target
        composer.addPass(new RenderPass(scene, camera));

        // 2 — cinematic bloom, tuned to be SELECTIVE.
        // The threshold has to sit above diffuse-surface luminance, not below it:
        // the foam blanket (0xf1f5ff) and the foam particles are lit surfaces that
        // settle at roughly 0.9-1.0 in linear HDR, so a 0.4 threshold classified
        // the whole dike as an emitter and smeared it into a white cloud. Only the
        // genuinely over-range sources bloom now: fire (col * heat reaches ~1.75)
        // and the additive lamps / flare sprites.
        bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            0.34,   // strength
            0.5,    // radius — tight enough that glow hugs its source
            0.88    // threshold — true HDR emitters only, foam stays matte
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
    const p = SCENE_THEMES[sceneTheme];
    hemiLight = new THREE.HemisphereLight(p.hemiSky, p.hemiGround, p.hemiBase);
    scene.add(hemiLight);
    dirLight = new THREE.DirectionalLight(p.dir, p.dirIntensity);
    dirLight.position.set(30, 42, 20);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
    dirLight.shadow.camera.left = -85; dirLight.shadow.camera.right = 85;
    dirLight.shadow.camera.top = 85; dirLight.shadow.camera.bottom = -85;
    dirLight.shadow.camera.near = 5; dirLight.shadow.camera.far = 170;
    dirLight.shadow.bias = -0.0004;
    dirLight.shadow.normalBias = 0.03;
    scene.add(dirLight);
    rimLight = new THREE.DirectionalLight(p.rim, p.rimIntensity);
    rimLight.position.set(-40, 18, -30);
    scene.add(rimLight);

    // the dike fire light. Its reach is kept to the bund on purpose: at
    // distance 60 / intensity ~14 it flood-lit the entire dike floor and drove
    // the foam blanket ~3x over range, which is what clipped to white.
    fireLight = new THREE.PointLight(COLORS.fireLight, 0, 42, 2);
    fireLight.position.copy(FIRE_POS).add(V3(0, 1.6, 0));
    scene.add(fireLight);
    // soft glow shared by the dike pool fires
    poolLight = new THREE.PointLight(COLORS.fireLight, 0, 26, 2);
    poolLight.position.copy(FIRE_POS).add(V3(0, 1.1, 0));
    scene.add(poolLight);
    flareLight = new THREE.PointLight(COLORS.orange, 0, 40, 2);
    flareLight.position.set(-38, 20, 8);
    flareLight.visible = false;
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
                topColor: { value: new THREE.Color(SCENE_THEMES[sceneTheme].skyTop) },
                horizonColor: { value: new THREE.Color(SCENE_THEMES[sceneTheme].skyHorizon) }
            },
            vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: 'uniform vec3 topColor; uniform vec3 horizonColor; varying vec3 vDir; void main(){ gl_FragColor = vec4(mix(horizonColor, topColor, smoothstep(-0.05, 0.5, vDir.y)), 1.0); }'
        })
    );
    scene.add(sky);
    skyMat = sky.material;

    grid = new THREE.GridHelper(300, 60,
        sceneTheme === 'light' ? 0x7d99bd : 0x24457e,
        sceneTheme === 'light' ? 0x5f7ea6 : 0x10203c);
    grid.material.transparent = true;
    grid.material.opacity = sceneTheme === 'light' ? 0.22 : 0.3;
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
    const stars = new THREE.Points(starGeo, starsMat);
    // a starfield is meaningless against a daylight sky
    stars.visible = SCENE_THEMES[sceneTheme].stars;
    starPoints = stars;
    scene.add(stars);

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
    // ground heat shimmer over the dike pool fire — low and wide across the bund
    const hazePlane = new THREE.Mesh(new THREE.PlaneGeometry(13, 13, 1, 1), heatHaze);
    hazePlane.rotation.x = -Math.PI / 2;
    hazePlane.position.set(TANKS[0].x, 0.2, TANKS[0].z);
    scene.add(hazePlane);

        // lens flare sprite on the flare stack tip
    flareSpriteMat = new THREE.SpriteMaterial({
        map: makeFlareSprite(),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        opacity: 0
    });
    const flareSprite = new THREE.Sprite(flareSpriteMat);
    flareSprite.scale.set(8, 8, 1);
    flareSprite.position.set(-38, 20.1, 8);
    flareSprite.renderOrder = 100;
    flareSprite.visible = false;
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
     [-48, 1.45, -34], [6, 1.45, -34], [16, 18.6, -6]].forEach(([x, y, z]) =>
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

    /* --- tie both open ends into the plant with proper fabricated tie-ins:
       swept elbows, flanged grade headers on sleepers, and a battery-limit
       valve station — no stabbed-into-dirt verticals, no floating stubs --- */
    const flangeZ = (x, y, z, r) => {
        const f = new THREE.CylinderGeometry(r, r, 0.14, 18);
        f.rotateX(Math.PI / 2);
        addMesh(f, matStructure, x, y, z);
    };
    const flangeY = (x, y, z, r) => {
        addMesh(new THREE.CylinderGeometry(r, r, 0.14, 18), matStructure, x, y, z);
    };
    // SOUTH end (battery limit): main arrives heading north at y7.4 — a
    // short straight riser dropping directly into a concrete anchor
    // block, capped with a flanged blind end. Compact and clean.
    const elbowM = (pts, material) => {
        const m = new THREE.Mesh(
            new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.5, 14, false),
            material || matPipe);
        m.castShadow = true;
        scene.add(m);
        return m;
    };
    const clampRing = (x, y, z, r = 0.57) => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.06, 8, 22), matStructure);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(x, y, z);
        ring.castShadow = true;
        scene.add(ring);
    };
    const sidePost = (px, pz, pipeX, clampYs, topY) => {
        // freestanding column beside a vertical drop, with cantilever
        // bracket arms reaching to the pipe + clamp rings on the pipe
        addMesh(new THREE.BoxGeometry(1.0, 0.2, 1.0), matStructure, px, 0.1, pz);
        addMesh(new THREE.BoxGeometry(0.28, topY, 0.28), matStructure, px, topY / 2 + 0.2, pz);
        clampYs.forEach(clampY => {
            const arm = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(pipeX - px) + 0.3, 0.22, 0.22), matStructure);
            arm.position.set((px + pipeX) / 2, clampY, pz);
            arm.castShadow = true;
            scene.add(arm);
            clampRing(pipeX, clampY, pz);
        });
    };
    // --- south drop: short straight vertical straight into a concrete
    // footing. No grade stub, no blind end, no valve clutter.
    elbowM([V3(1.2, 7.4, 40.3), V3(1.2, 6.6, 41.2), V3(1.2, 5.6, 41.6)], heroPipeMat);
    flangeY(1.2, 5.6, 41.6, 0.63);
    addMesh(new THREE.CylinderGeometry(0.5, 0.5, 5.3, 16), heroPipeMat, 1.2, 2.95, 41.6);
    clampRing(1.2, 4.2, 41.6);
    sidePost(2.3, 41.6, 1.2, [4.2], 4.4);
    flangeY(1.2, 0.7, 41.6, 0.63);
    addMesh(new THREE.BoxGeometry(1.9, 0.6, 1.9), matGround, 1.2, 0.3, 41.6);
    addAO(1.2, 41.6, 3.0, 3.0, 0.5);
    // NORTH end: sweep off the rack into one straight vertical drop straight
    // into a concrete footing. Short, plumb, no grade stubs.
    elbowM([V3(0.2, 7.4, -12.8), V3(0.2, 7.3, -13.7), V3(0.2, 6.4, -14.0)], heroPipeMat);
    flangeY(0.2, 6.4, -14.0, 0.63);
    addMesh(new THREE.CylinderGeometry(0.5, 0.5, 5.9, 16), heroPipeMat, 0.2, 3.45, -14.0);
    sidePost(-1.1, -14.0, 0.2, [5.6, 3.0], 5.8);
    flangeY(0.2, 0.7, -14.0, 0.63);
    addMesh(new THREE.BoxGeometry(1.9, 0.6, 1.9), matGround, 0.2, 0.3, -14.0);
    addAO(0.2, -14.0, 3.0, 3.0, 0.5);

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

/* ==========================================================================
   FIXED-ROOF STORAGE TANK — accurate anatomy (API 650 / API 2020)
   shell -> top angle curb -> cone roof -> roof vents, gauge hatch, nozzle
   manway; helical stairway to a top platform; wind girder; earthing straps;
   a roof FOAM CHAMBER (held closed) and a roof COOLING WATER RING.
   ========================================================================== */
let matConcentrate;

/* height of the cone roof surface at an offset (dx,dz) from the tank centre */
function roofSurfaceY(dx, dz) {
    const R = TANK.R, CONE = 1.3, APEX = TANK.H + CONE;
    return APEX - (Math.sqrt(dx * dx + dz * dz) / (R + 0.28)) * CONE;
}

/* ---------- helical stairway + top platform (API 650 access) ---------- */
function buildTankStairs(g, x, z, treadGeo, legGeo, m4, q, s3, APEX) {
    const R = TANK.R, H = TANK.H;
    const steps = Math.round(H / 0.46);
    const treadInst = new THREE.InstancedMesh(treadGeo, matStructure, steps);
    const railPts = [], strPts = [];
    for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 1.85;   // ~0.93 of a full turn
        const y = 0.25 + (i / (steps - 1)) * (H - 0.5);
        q.setFromAxisAngle(V3(0, 1, 0), -a);
        m4.compose(V3(x + Math.cos(a) * (R + 0.55), y, z + Math.sin(a) * (R + 0.55)), q, s3);
        treadInst.setMatrixAt(i, m4);
        railPts.push(V3(x + Math.cos(a) * (R + 1.0), y + 1.02, z + Math.sin(a) * (R + 1.0)));
        railPts.push(V3(x + Math.cos(a) * (R + 1.0), y + 0.52, z + Math.sin(a) * (R + 1.0)));
        strPts.push(V3(x + Math.cos(a) * (R + 0.55), y - 0.08, z + Math.sin(a) * (R + 0.55)));
    }
    treadInst.castShadow = true;
    g.add(treadInst);
    // stair stringer follows the same helix, one edge below the treads
    strPts.unshift(strPts[0].clone().setY(0.02));
    strPts.push(strPts[strPts.length - 1].clone());
    g.add(new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(strPts), 56, 0.07, 5, false),
        matStructure
    ));
    // handrail — two helical runs (top rail + mid rail)
    railPts.unshift(railPts[0].clone().setY(1.35));
    railPts.push(railPts[railPts.length - 1].clone().setY(railPts[0].y));
    g.add(new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPts), 110, 0.035, 6, false),
        matPipe
    ));

    /* top platform + guardrail at the roof apex */
    const platGeo = new THREE.RingGeometry(0.55, 1.5, 24);
    platGeo.rotateX(-Math.PI / 2);
    addMesh(platGeo, matStructure, x, APEX + 0.42, z, g);
    const guard = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.04, 6, 28), matPipe);
    guard.rotation.x = Math.PI / 2;
    guard.position.set(x, APEX + 1.45, z);
    g.add(guard);
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.78;
        addMesh(legGeo, matStructure,
            x + Math.cos(a) * 1.35, APEX - 0.1, z + Math.sin(a) * 1.35, g);
    }
}

/* ---------- roof foam chamber (installed, held CLOSED for this scenario) ---------- */
function buildFoamChamber(g, x, z) {
    const R = TANK.R, ang = Math.PI * 0.75;
    const ox = Math.cos(ang) * (R - 1.2), oz = Math.sin(ang) * (R - 1.2);
    const fc = new THREE.Group();
    fc.position.set(x + ox, roofSurfaceY(ox, oz), z + oz);
    fc.rotation.y = -ang + Math.PI / 2;
    g.add(fc);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.85, 0.8), matStructure);
    body.castShadow = true;
    fc.add(body);
    // inlet spool from the riser, horizontal into the chamber body
    const inlet = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.7, 12), matPipe);
    inlet.rotation.z = Math.PI / 2;
    inlet.position.set(-0.55, 0.1, 0);
    fc.add(inlet);
    // internal deflector baffle — makes the foam drain down the shell
    const baffle = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.03), matAccent);
    baffle.position.set(0.06, -0.1, 0);
    fc.add(baffle);
    // pressure gauge provision at the chamber inlet (NFPA 11 commissioning)
    const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 12), matIce);
    gauge.rotation.z = Math.PI / 2;
    gauge.position.set(-0.82, 0.32, 0.3);
    fc.add(gauge);
    return fc;
}

/* ---------- roof cooling water ring: circle of spray nozzles ---------- */
function buildCoolingRing(g, tk, x, z, EAVE, m4, q, s3) {
    const R = TANK.R;
    const cr = new THREE.Group();
    cr.position.set(x, EAVE + 0.12, z);
    g.add(cr);

    const ringGeo = new THREE.TorusGeometry(R - 0.55, 0.13, 8, 44);
    ringGeo.rotateX(Math.PI / 2);
    const ringPipe = new THREE.Mesh(ringGeo, matPipe);
    ringPipe.castShadow = true;
    cr.add(ringPipe);

    const nozInst = new THREE.InstancedMesh(
        new THREE.ConeGeometry(0.11, 0.34, 8), matAccent, 16);
    const nozzles = [];
    for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        q.setFromEuler(new THREE.Euler(0, -a, Math.PI * 0.62));
        m4.compose(
            V3(Math.cos(a) * (R - 0.55), 0.42, Math.sin(a) * (R - 0.55)), q, s3);
        nozInst.setMatrixAt(i, m4);
        nozzles.push(V3(x + Math.cos(a) * (R - 0.55), EAVE + 0.54, z + Math.sin(a) * (R - 0.55)));
    }
    cr.add(nozInst);

    coolingRings.push({ tank: tk, group: cr, nozzles });
    tk.coolRing = cr;
}

function buildTanks() {
    const R = TANK.R, H = TANK.H, CONE = 1.3, EAVE = H, APEX = H + CONE;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = V3(1, 1, 1);

    const shellGeo = new THREE.CylinderGeometry(R, R, H, 48);
    const skirtGeo = new THREE.CylinderGeometry(R + 0.14, R + 0.14, 0.4, 48);
    const coneGeo = new THREE.ConeGeometry(R + 0.28, CONE, 48);
    const curbGeo = new THREE.TorusGeometry(R + 0.3, 0.1, 8, 48);
    curbGeo.rotateX(Math.PI / 2);
    const ventGeo = new THREE.CylinderGeometry(0.34, 0.42, 0.5, 14);
    const ventCapGeo = new THREE.ConeGeometry(0.52, 0.3, 14);
    const hatchGeo = new THREE.CylinderGeometry(0.26, 0.3, 0.34, 14);
    const manwayGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.2, 16);
    const nozzleGeo = new THREE.CylinderGeometry(0.2, 0.24, 0.72, 14);
    const girderGeo = new THREE.BoxGeometry(0.09, 1.9, 0.09);
    const earthGeo = new THREE.BoxGeometry(0.3, 0.06, 0.04);
    const treadGeo = new THREE.BoxGeometry(1.15, 0.05, 0.36);
    const legGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6);

    TANKS.forEach(tk => {
        const { x, z, id } = tk;
        const g = new THREE.Group();
        /* Container only — every child below is authored in WORLD coordinates,
           the same convention as the dike, fire, foam and pipeline geometry.
           Translating this group by (x, z) pushed the shell, roof, stairs and
           cooling ring out to (2x, 2z), i.e. outside the containment dike.
           The few instanced parts built in LOCAL space add x/z back below. */
        g.position.set(0, 0, 0);
        scene.add(g);
        tk.group = g;

        addMesh(shellGeo, matTank, x, H / 2, z, g);
        addMesh(skirtGeo, matStructure, x, 0.2, z, g);
        addMesh(curbGeo, matStructure, x, EAVE + 0.05, z, g);
        addMesh(coneGeo, matTank, x, EAVE + CONE / 2, z, g);

        /* roof appurtenances — vents, gauge hatch, nozzle manway, shell manway */
        [[-3.1, 2.6], [-1.4, -3.4]].forEach(([dx, dz]) => {
            const vy = roofSurfaceY(dx, dz);
            addMesh(ventGeo, matPipe, x + dx, vy + 0.25, z + dz, g);
            addMesh(ventCapGeo, hazardMat, x + dx, vy + 0.65, z + dz, g);
        });
        const gy = roofSurfaceY(2.6, 1.4);
        addMesh(hatchGeo, matPipe, x + 2.6, gy + 0.16, z + 1.4, g);
        const ny = roofSurfaceY(-2.2, -1.8);
        addMesh(nozzleGeo, matPipe, x - 2.2, ny + 0.34, z - 1.8, g);
        addMesh(manwayGeo, matStructure, x, 1.5, z + R + 0.06, g);

        /* wind girder — vertical angle rods around the upper shell */
        const gInst = new THREE.InstancedMesh(girderGeo, matStructure, 16);
        for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2;
            q.setFromAxisAngle(V3(0, 1, 0), -a);
            m4.compose(V3(x + Math.cos(a) * (R + 0.1), H - 1.1, z + Math.sin(a) * (R + 0.1)), q, s3);
            gInst.setMatrixAt(i, m4);
        }
        gInst.castShadow = true; g.add(gInst);

        /* earthing straps at two shell courses */
        const eInst = new THREE.InstancedMesh(earthGeo, matPipe, 8);
        let e = 0;
        [0.35, 0.7].forEach(frac => {
            for (let i = 0; i < 4; i++) {
                const a = (i / 4) * Math.PI * 2 + 0.4;
                q.setFromAxisAngle(V3(0, 1, 0), -a);
                m4.compose(V3(x + Math.cos(a) * (R + 0.14), H * frac, z + Math.sin(a) * (R + 0.14)), q, s3);
                eInst.setMatrixAt(e++, m4);
            }
        });
        g.add(eInst);

        buildTankStairs(g, x, z, treadGeo, legGeo, m4, q, s3, APEX);
        tk.foamChamber = buildFoamChamber(g, x, z);
        buildCoolingRing(g, tk, x, z, EAVE, m4, q, s3);

        addAO(x, z, TANK.DIKE * 0.95, TANK.DIKE * 0.95, 0.62);
    });
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
    /* REMOVED — per review the freestanding flame post read as a stray
       structure, so the stack, pilot flame and tip glow are all gone. */
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

/* ==========================================================================
   DIKE / BUND — individual containment wall per tank (NFPA 11 5.7).
   The dike floor carries a foam discharge header with low-level outlets
   that discharge foam INTO the bund, so the bund fills from the bottom up.
   ========================================================================== */
function buildDike() {
    const D = TANK.DIKE, half = D / 2, WALL_H = 1.25, T = 0.4;
    const wallGeoX = new THREE.BoxGeometry(D, WALL_H, T);
    const wallGeoZ = new THREE.BoxGeometry(T, WALL_H, D);
    const capGeo = new THREE.BoxGeometry(D, 0.08, T + 0.1);
    const capGeoZ = new THREE.BoxGeometry(T + 0.1, 0.08, D);
    const stairGeo = new THREE.BoxGeometry(0.9, 0.09, 0.34);

    TANKS.forEach(tk => {
        const { x, z } = tk;
        // containment walls on all four sides
        addMesh(wallGeoX, matStructure, x, WALL_H / 2, z - half);
        addMesh(wallGeoX, matStructure, x, WALL_H / 2, z + half);
        addMesh(wallGeoZ, matStructure, x - half, WALL_H / 2, z);
        addMesh(wallGeoZ, matStructure, x + half, WALL_H / 2, z);
        addMesh(capGeo, matStructure, x, WALL_H + 0.04, z - half);
        addMesh(capGeo, matStructure, x, WALL_H + 0.04, z + half);
        addMesh(capGeoZ, matStructure, x - half, WALL_H + 0.04, z);
        addMesh(capGeoZ, matStructure, x + half, WALL_H + 0.04, z);

        // dike crossover stair (caged ladder over the wall) at the outer face
        for (let i = 0; i < 5; i++) {
            const y = 0.22 + i * 0.26;
            const s = new THREE.Mesh(stairGeo, matStructure);
            s.position.set(x + half + T / 2 + 0.3, y, z - 1.6);
            s.castShadow = true;
            scene.add(s);
        }

        /* --- foam discharge header along the dike floor + low-level outlets --- */
        const hdrY = 0.28, inset = half - 0.55;
        const hGeoX = new THREE.CylinderGeometry(0.14, 0.14, D - 1.1, 12);
        hGeoX.rotateZ(Math.PI / 2);
        const hGeoZ = new THREE.CylinderGeometry(0.14, 0.14, D - 1.1, 12);
        hGeoZ.rotateX(Math.PI / 2);
        addMesh(hGeoX, matPipe, x, hdrY, z - inset);
        addMesh(hGeoX, matPipe, x, hdrY, z + inset);
        addMesh(hGeoZ, matPipe, x - inset, hdrY, z);
        addMesh(hGeoZ, matPipe, x + inset, hdrY, z);

        // low-level outlets: short down-turned spouts pointing into the bund
        const outGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.42, 10);
        const outlets = [];
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            const px = x + Math.cos(a) * inset;
            const pz = z + Math.sin(a) * inset;
            const o = new THREE.Mesh(outGeo, matAccent);
            o.position.set(px, hdrY - 0.14, pz);
            o.castShadow = true;
            scene.add(o);
            outlets.push(V3(px, hdrY - 0.34, pz));
        }
        tk.outlets = outlets;

        /* --- foam blanket that fills the bund once the low-level outlets run.
           Modelled as an ANNULUS between the shell and the dike wall: the
           dike floor outside the tank footprint is the only area the dike
           foam actually protects. A solid slab here would intersect the
           tank shell and read as foam inside the tank. --- */
        const bGeo = new THREE.RingGeometry(TANK.R + 0.25, D / 2 - 0.7, 56, 2);
        bGeo.rotateX(-Math.PI / 2);
        // the blanket's albedo matters more than its opacity: 0xf1f5ff sat at
        // ~0.88 in LINEAR space, and with fireLight pouring ~14 units of
        // intensity into the dike the surface radiance ran ~3x over range —
        // it clipped to white long before the bloom pass saw it. A dull,
        // desaturated grey-blue keeps the lit radiance in range.
        const bMat = new THREE.MeshStandardMaterial({
            color: 0x94a1b6, roughness: 0.96, metalness: 0.0,
            transparent: true, opacity: 0, side: THREE.DoubleSide,
            envMapIntensity: 0.25
        });
        const blanket = new THREE.Mesh(bGeo, bMat);
        blanket.position.set(x, 0.03, z);
        blanket.renderOrder = 2;
        blanket.visible = false;
        scene.add(blanket);
        bundFoam.push({ tank: tk, mesh: blanket, mat: bMat });

        /* --- dike floor slab, slightly proud of the surrounding grade --- */
        const fGeo = new THREE.BoxGeometry(D - T, 0.16, D - T);
        addMesh(fGeo, matDark, x, 0.0, z);
    });
}

/* ---------- small 3D tag label ---------- */
function makeLabel(text, color) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(6,12,24,0.82)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, 252, 60);
    ctx.fillStyle = color;
    ctx.font = 'bold 30px Oxanium, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false
    }));
    spr.scale.set(3.4, 0.85, 1);
    return spr;
}

/* ---------- spoked handwheel ---------- */
function buildHandwheel(r, mat) {
    const m = mat || matAccent;
    const w = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.045, 8, 22), m);
    rim.rotation.x = Math.PI / 2;
    w.add(rim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 10), m);
    w.add(hub);
    for (let s = 0; s < 3; s++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(r * 1.8, 0.04, 0.04), m);
        spoke.rotation.y = s * Math.PI / 3;
        w.add(spoke);
    }
    return w;
}

/* ==========================================================================
   PIPE-MOUNTED PRESSURE GAUGE — a real dial on an impulse leg, so the step-7
   pressure decay (10 -> 7 bar) is readable ON THE PIPEWORK itself and not only
   in the incident scene state.

   Sweep: 0 bar at -135 deg (lower-left) through 12 bar at 90 deg (top).
   This orientation makes the needle move visibly downward as pressure falls
   from 10 to the 7 bar low-pressure-switch marker.
   ========================================================================== */
const GAUGE_P_MAX = 12;
const GAUGE_TRIP = 7.6;   // band edge sits just above the 7.0 bar trip point
const gaugeAngleDeg = p => -135 + (clamp(p, 0, GAUGE_P_MAX) / GAUGE_P_MAX) * 225;

function buildGauge(parent, x, y, z, scale, tagText) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.scale.setScalar(scale || 1);
    parent.add(g);

    // impulse leg reaching down into the pipe it is tapped off
    const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 8), matPipe);
    stub.position.y = -0.36;
    g.add(stub);

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.15, 24), matDark);
    body.rotation.x = Math.PI / 2;
    g.add(body);
    g.add(new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 8, 30), matFireRed));

    const face = new THREE.Mesh(
        new THREE.CircleGeometry(0.37, 32),
        new THREE.MeshBasicMaterial({ color: 0xf3f7ff })
    );
    face.position.z = 0.081;
    g.add(face);

    // low-pressure danger band, 0 -> GAUGE_TRIP bar
    const a0 = THREE.MathUtils.degToRad(gaugeAngleDeg(0));
    const a1 = THREE.MathUtils.degToRad(gaugeAngleDeg(GAUGE_TRIP));
    const band = new THREE.Mesh(
        new THREE.RingGeometry(0.22, 0.355, 30, 1, a0, a1 - a0),
        new THREE.MeshBasicMaterial({
            color: 0xd8342a, transparent: true, opacity: 0.9, side: THREE.DoubleSide
        })
    );
    band.position.z = 0.083;
    g.add(band);

    // graduations — one tick per bar, longer at 0 / 4 / 8 / 12
    const tickMat = new THREE.MeshBasicMaterial({ color: 0x27324c });
    for (let i = 0; i <= GAUGE_P_MAX; i++) {
        const a = THREE.MathUtils.degToRad(gaugeAngleDeg(i));
        const len = (i % 4 === 0) ? 0.08 : 0.05;
        const tk = new THREE.Mesh(new THREE.BoxGeometry(0.016, len, 0.006), tickMat);
        tk.position.set(Math.cos(a) * (0.345 - len / 2), Math.sin(a) * (0.345 - len / 2), 0.085);
        tk.rotation.z = a - Math.PI / 2;
        g.add(tk);
    }
    // 7 bar low-pressure-switch marker (NFPA 20 trip point)
    const tripA = THREE.MathUtils.degToRad(gaugeAngleDeg(7));
    const trip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.006),
        new THREE.MeshBasicMaterial({ color: 0x11172a }));
    trip.position.set(Math.cos(tripA) * 0.25, Math.sin(tripA) * 0.25, 0.086);
    trip.rotation.z = tripA - Math.PI / 2;
    g.add(trip);

    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.3, 0.012),
        new THREE.MeshBasicMaterial({ color: 0xd42b1e }));
    needle.position.set(0, 0.15, 0);
    const pivot = new THREE.Group();
    pivot.position.z = 0.098;
    pivot.add(needle);
    g.add(pivot);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12), matDark);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = 0.1;
    g.add(hub);

    gauges.push({ pivot, face });
    if (tagText) {
        const t = makeLabel(tagText, '#7ccfff');
        const s = (scale || 1);
        t.scale.set(2.6 * s, 0.65 * s, 1);
        t.position.set(x, y + 0.72 * s + 0.3 * s, z);
        parent.add(t);
    }
    return g;
}

/* ==========================================================================
   FOAM + WATER NETWORK — how every line physically connects.

   FIRE-WATER RING MAIN (pump discharge, 10 bar static, at grade)
        |
        +-- DELUGE CONTROL VALVE V-101 (actuated by Fire Alarm Panel FACP-01)
        |      +-- F-101-DK  dike foam line  -> low-level outlets in the bund
        |      +-- F-101-FC  foam chamber riser  (HELD CLOSED - standby)
        |
        +-- COOLING BUTTERFLY VALVES
               +-- C-101 ring on TK-001 shell   (8.1 L/min/m2, directly exposed)
               +-- C-102 ring on TK-002 shell   (4.1 L/min/m2, adjacent)
   Concentrate is inducted into the ring main at the foam maker.
   ========================================================================== */
function buildFoamNetwork() {
    const R = TANK.R, H = TANK.H;
    const mainY = 1.05, mainZ = -18.5, mainX0 = -54, mainX1 = 6;

    /* fire water ring main on sleeper supports — RED, this is the fire loop */
    const mainGeo = new THREE.CylinderGeometry(0.26, 0.26, mainX1 - mainX0, 14);
    mainGeo.rotateZ(Math.PI / 2);
    addMesh(mainGeo, matFireWater, (mainX0 + mainX1) / 2, mainY, mainZ);
    const sleeperGeo = new THREE.BoxGeometry(0.7, 0.34, 0.8);
    for (let x = mainX0; x <= mainX1; x += 4.4) {
        addMesh(sleeperGeo, hazardMat, x, 0.17, mainZ);
    }

    /* ring-main PRESSURE GAUGE — tapped off a riser on the main, between the
       two dikes, where the incident and suppression cameras can read it. Its
       needle is driven by state.pressure, so the 10 -> 7 bar decay at step 6
       is visible on the pipe itself. Kept compact (0.85x) so the dial reads
       as an instrument, not a structure. */
    addMesh(new THREE.CylinderGeometry(0.1, 0.1, mainY + 1.5, 10), matPipe,
        -22, (mainY + 1.5) / 2, mainZ);
    buildGauge(scene, -22, mainY + 1.85, mainZ, 1.05, 'RING PRESSURE');

    /* compact horizontal foam bladder tank, matching the packaged vessels
       used on fire-protection skids. */
    matConcentrate = new THREE.MeshStandardMaterial({
        color: 0xd42d20, roughness: 0.5, metalness: 0.35, envMapIntensity: 0.6
    });
    const FT = { x: -43.5, z: -15.5, r: 1.0, shell: 3.3, y: 2.05 };
    const ftTank = new THREE.Group();
    ftTank.position.set(FT.x, FT.y, FT.z);
    scene.add(ftTank);

    const ftShell = new THREE.Mesh(
        new THREE.CylinderGeometry(FT.r, FT.r, FT.shell, 30), matFireRed);
    ftShell.rotation.z = Math.PI / 2;
    ftShell.castShadow = true;
    ftTank.add(ftShell);
    const endHeadGeo = new THREE.SphereGeometry(FT.r, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    const leftHead = new THREE.Mesh(endHeadGeo, matFireRed);
    leftHead.rotation.z = Math.PI / 2;
    leftHead.position.x = -FT.shell / 2;
    leftHead.castShadow = true;
    ftTank.add(leftHead);
    const rightHead = new THREE.Mesh(
        new THREE.SphereGeometry(FT.r, 24, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
        matFireRed);
    rightHead.rotation.z = Math.PI / 2;
    rightHead.position.x = FT.shell / 2;
    rightHead.castShadow = true;
    ftTank.add(rightHead);

    /* circumferential shell welds and the two compact saddle supports */
    [-0.85, 0.85].forEach(x => {
        const weld = new THREE.Mesh(new THREE.TorusGeometry(FT.r + 0.012, 0.025, 6, 32), matConcentrate);
        weld.rotation.y = Math.PI / 2;
        weld.position.x = x;
        ftTank.add(weld);

        const support = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.96, 0.84), matStructure);
        support.position.set(x, -0.55, 0);
        support.castShadow = true;
        ftTank.add(support);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 1.05), matDark);
        foot.position.set(x, -1.03, 0);
        ftTank.add(foot);
    });
    const saddleGeo = new THREE.BoxGeometry(1.05, 0.14, 0.9);
    [-0.85, 0.85].forEach(x => {
        const saddle = new THREE.Mesh(saddleGeo, matStructure);
        saddle.position.set(x, -0.98, 0);
        ftTank.add(saddle);
    });

    /* top service nozzle, flange and a readable compact pressure gauge */
    const topNozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.35, 12), matPipe);
    topNozzle.position.set(-0.6, 1.03, 0);
    ftTank.add(topNozzle);
    const topFlange = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.09, 16), matConcentrate);
    topFlange.position.set(-0.6, 1.2, 0);
    ftTank.add(topFlange);
    const gaugeStem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 8), matPipe);
    gaugeStem.position.set(-0.6, 1.34, 0);
    ftTank.add(gaugeStem);
    const ftGauge = new THREE.Group();
    ftGauge.position.set(-0.6, 1.52, 0.03);
    ftGauge.rotation.x = 0.35;
    const gaugeCase = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.09, 18), matDark);
    gaugeCase.rotation.x = Math.PI / 2;
    ftGauge.add(gaugeCase);
    const gaugeFace = new THREE.Mesh(
        new THREE.CircleGeometry(0.15, 18),
        new THREE.MeshBasicMaterial({ color: 0xf3f7ff })
    );
    gaugeFace.position.z = 0.05;
    ftGauge.add(gaugeFace);
    const gaugeNeedle = new THREE.Mesh(
        new THREE.BoxGeometry(0.018, 0.1, 0.012),
        new THREE.MeshBasicMaterial({ color: 0xd42d20 })
    );
    gaugeNeedle.position.set(0, 0.035, 0.06);
    ftGauge.add(gaugeNeedle);
    ftTank.add(ftGauge);

    addAO(FT.x, FT.z, 7, 7, 0.5);
    const concTag = makeLabel('FOAM TANK — AFFF 3%', '#ff6a5a');
    concTag.position.set(FT.x, 3.75, FT.z);
    scene.add(concTag);

    const maker = new THREE.Group();
    maker.position.set(-38, mainY, mainZ);
    scene.add(maker);
    const mkBody = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 1.0, 14), matPipe);
    mkBody.rotation.z = Math.PI / 2;
    maker.add(mkBody);
    const mkVent = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.9, 10), matPipe);
    mkVent.position.y = 0.5;
    maker.add(mkVent);
    const mkTag = makeLabel('FOAM MAKER', '#fab95b');
    mkTag.position.set(0, 1.35, 0);
    maker.add(mkTag);
    /* The tank outlet follows a supported, continuous run into the foam
       maker's vertical induction port rather than stopping beside it. */
    const outletX = FT.x + FT.shell / 2 + FT.r * 0.62;
    const outlet = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.42, 12), matPipe);
    outlet.rotation.z = Math.PI / 2;
    outlet.position.set(outletX + 0.21, FT.y, FT.z);
    scene.add(outlet);
    const outletFlange = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.2, 0.1, 16), matConcentrate);
    outletFlange.rotation.z = Math.PI / 2;
    outletFlange.position.set(outletX + 0.43, FT.y, FT.z);
    scene.add(outletFlange);
    const drawPath = new THREE.CatmullRomCurve3([
        V3(outletX + 0.48, FT.y, FT.z),
        V3(-39.9, FT.y, FT.z),
        V3(-39.55, FT.y, -15.85),
        V3(-39.55, FT.y, -17.95),
        V3(-39.2, FT.y, -18.3),
        V3(-38.65, FT.y, -18.3),
        V3(-38.16, mainY + 0.7, mainZ)
    ]);
    const draw = new THREE.Mesh(new THREE.TubeGeometry(drawPath, 48, 0.085, 10, false), matConcentrate);
    draw.castShadow = true;
    scene.add(draw);
    [-39.55, -38.9].forEach(x => {
        const pipeSupport = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.68, 0.12), matStructure);
        pipeSupport.position.set(x, FT.y - 0.22, -17.95);
        scene.add(pipeSupport);
        const pipeShoe = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.08, 0.42), matDark);
        pipeShoe.position.set(x, FT.y - 0.58, -17.95);
        scene.add(pipeShoe);
    });

    /* ring main tee down to each tank + foam system valve */
    TANKS.forEach((tk, i) => {
        const { x, z } = tk;
        const teeZ = z + TANK.DIKE / 2 + 1.2;
        const runGeo = new THREE.CylinderGeometry(0.2, 0.2, mainZ - teeZ, 12);
        runGeo.rotateX(Math.PI / 2);
        addMesh(runGeo, matFireWater, x, mainY, (mainZ + teeZ) / 2);

        /* V-10x — diaphragm foam valve, actuated by the control panel. RED. */
        const vGrp = new THREE.Group();
        vGrp.position.set(x, mainY, mainZ + 1.1);
        scene.add(vGrp);
        const vBody = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.9, 18), matFireRed);
        vBody.rotation.x = Math.PI / 2;
        vGrp.add(vBody);
        [-0.5, 0.5].forEach(zz => {
            const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.1, 18), matFireRed);
            fl.rotation.x = Math.PI / 2; fl.position.z = zz;
            vGrp.add(fl);
        });
        const act = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.34, 14), matDark);
        act.position.y = 0.42;
        vGrp.add(act);
        const indMat = new THREE.MeshBasicMaterial({ color: 0x35ff70 });
        const ind = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), indMat);
        ind.position.set(0.3, 0.62, 0);
        vGrp.add(ind);
        const wheel = buildHandwheel(0.38, matFireRed);
        wheel.position.set(0, 0.72, 0);
        vGrp.add(wheel);
        const vTag = makeLabel(`V-10${i + 1}`, '#ff6a5a');
        vTag.scale.set(2.3, 0.58, 1);
        vTag.position.set(0, 1.95, 0);
        vGrp.add(vTag);
        processValves.push({ id: `V-10${i + 1}`, group: vGrp, indicator: indMat, actuator: act, wheel });

        /* F-10x-DK — dike foam branch continuing to the bund header */
        const bGeo = new THREE.CylinderGeometry(0.17, 0.17, mainZ + 1.1 - teeZ + 1.4, 12);
        bGeo.rotateX(Math.PI / 2);
        addMesh(bGeo, matFireWater, x, mainY, (mainZ + teeZ + 1.4) / 2);

        /* F-10x-FC — foam chamber riser up the shell, isolation valve CLOSED */
        const ang = Math.PI * 0.75;
        const rx = x + Math.cos(ang) * (R + 0.45);
        const rz = z + Math.sin(ang) * (R + 0.45);
        addMesh(new THREE.CylinderGeometry(0.15, 0.15, H + 1.4, 10), matPipe, rx, (H + 1.4) / 2, rz);
        const rb = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.44, 12), matPipe);
        rb.position.set(rx, 0.9, rz);
        scene.add(rb);
        const fcInd = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
        const fcLamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), fcInd);
        fcLamp.position.set(rx + 0.28, 1.1, rz);
        scene.add(fcLamp);
        processValves.push({
            id: `V-1${i + 2}0-FC`, group: rb, indicator: fcInd,
            actuator: null, standby: true, standbyLabel: 'FOAM CHAMBER - STANDBY'
        });
        const link = new THREE.CylinderGeometry(0.12, 0.12, 3.4, 8);
        link.rotateZ(Math.PI / 2);
        addMesh(link, matPipe, rx - 1.7, 0.9, rz);
        tk.riserBase = V3(rx, 0, rz);
        tk.chamberValve = processValves[processValves.length - 1];
    });
}

/* ==========================================================================
   IR DETECTION — TWO sensor poles per tank, OPPOSITE each other on the
   north/south axis. Each pole stands IR_POLE_D (26 m) out from the tank
   axis — 14 m clear of the containment wall and 20 m off the shell, far
   enough back that it reads as a separate instrument post instead of a
   fitting hugging the vessel — and carries a single head aimed at the tank
   centre, so the pair covers the vessel from both sides. Each head projects
   a detection field wide enough to SWALLOW the whole shell (base radius
   solved from the tank radius, see below) that sits dim cyan in
   surveillance and latches red on flame detection.
   ========================================================================== */
const IR_POLE_D = TANK.DIKE / 2 + 14;       // 26 m out from the tank axis
function irPolePos(tk, i) {                  // i 0 = front/south pole, 1 = rear/north
    return { px: tk.x, pz: tk.z + (i === 0 ? IR_POLE_D : -IR_POLE_D) };
}
function buildIRCameras() {
    const poleH = TANK.H * 0.72;
    const cameraBodyMat = metalMaterial(0x34475a, 0.5, 0.5, {
        emissive: 0x0e2036, emissiveIntensity: 0.7
    });
    TANKS.forEach(tk => {
        const { x, z } = tk;
        [0, 1].forEach(i => {
            const { px, pz } = irPolePos(tk, i);
            addMesh(new THREE.CylinderGeometry(0.13, 0.19, poleH, 10), matStructure, px, poleH / 2, pz);
            addMesh(new THREE.CylinderGeometry(0.42, 0.5, 0.34, 14), hazardMat, px, 0.17, pz);
            addMesh(new THREE.BoxGeometry(0.9, 0.16, 0.5), matStructure, px, poleH, pz);
            addAO(px, pz, 2.4, 2.4, 0.45);

            /* one head per pole, aimed AT the tank. The old yaw
               atan2(-aim.x, -aim.z) turned the head's +Z forward axis (the
               lens and cone are authored along +Z) 180 deg away from the
               vessel; lookAt orients +Z at the tank centre instead. */
            const cam = new THREE.Group();
            cam.position.set(px, poleH + 0.32, pz);
            scene.add(cam);
            cam.lookAt(x, TANK.H * 0.55, z);

            const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.46, 0.88), cameraBodyMat);
            body.castShadow = true;
            cam.add(body);
            const hood = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.98), matStructure);
            hood.position.y = 0.26;
            cam.add(hood);
            const lensMat = new THREE.MeshBasicMaterial({ color: 0x1a3550 });
            const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.25, 0.14, 14), lensMat);
            lens.rotation.x = Math.PI / 2;
            lens.position.z = 0.48;
            cam.add(lens);
            const ledMat = new THREE.MeshBasicMaterial({ color: 0x35ff70 });
            const led = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), ledMat);
            led.position.set(0.23, 0.14, 0.48);
            cam.add(led);

            /* Detection beam ends at the near shell and is exactly one tank
               radius wide there, with no overshoot beyond the vessel. */
            const d0 = cam.position.distanceTo(V3(x, TANK.H * 0.55, z));
            const dist = d0 - TANK.R;
            const coneR = TANK.R;
            const coneMat = new THREE.MeshBasicMaterial({
                color: 0x7ccfff, transparent: true, opacity: 0.0,
                blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
            });
            const cone = new THREE.Mesh(new THREE.ConeGeometry(coneR, dist, 20, 1, true), coneMat);
            cone.position.set(0, 0, dist / 2);      // centre, half a cone out along +Z
            cone.rotation.x = -Math.PI / 2;         // cone +Y (apex axis) -> local -Z
            cam.add(cone);

            irCameras.push({ tank: tk, index: i, group: cam, cone, coneMat, lensMat, ledMat });

            const tag = makeLabel(`IR 10${TANKS.indexOf(tk) + 1} ${i === 0 ? 'FRONT' : 'REAR'}`, '#7ccfff');
            tag.scale.set(2.3, 0.58, 1);
            tag.position.set(px + 1.5, poleH - 0.15, pz);
            scene.add(tag);
        });
    });
}

/* ==========================================================================
   CONTROL PANEL — FACP-01. Receives the IR signal, then commands the foam
   system valve. Mimic fascia shows both tanks; TK-001 latches red.
   ========================================================================== */
const PANEL_POS = V3(-6.5, 0, -19.5);

function buildControlPanel() {
    const g = new THREE.Group();
    g.position.copy(PANEL_POS);
    scene.add(g);

    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.75, 0.7), matDark);
    cab.position.y = 1.78;
    cab.castShadow = true;
    g.add(cab);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.16, 0.74), hazardMat);
    skirt.position.y = 1.02;
    g.add(skirt);
    [-1.05, 1.05].forEach(x => [-0.25, 0.25].forEach(z => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8), matStructure);
        leg.position.set(x, 0.6, z);
        g.add(leg);
    }));

    /* glazed fire-alarm control panel with a tank mimic and alarm indicators */
    const face = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.35, 0.08), matStructure);
    face.position.set(0, 1.82, 0.39);
    g.add(face);
    const screen = new THREE.Mesh(
        new THREE.BoxGeometry(0.74, 0.72, 0.035),
        new THREE.MeshStandardMaterial({
            color: 0x102633, emissive: 0x145268, emissiveIntensity: 0.7,
            roughness: 0.35, metalness: 0.15
        })
    );
    screen.position.set(-0.55, 1.89, 0.45);
    g.add(screen);
    const statusLamps = [];
    TANKS.forEach((tk, i) => {
        const m = new THREE.MeshBasicMaterial({ color: 0x1d3a2a });
        const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.12, 18), m);
        lamp.position.set(-0.72 + i * 0.34, 2.03, 0.48);
        g.add(lamp);
        statusLamps.push({ mat: m, tank: tk });
    });
    statusLamps.forEach(lamp => panelLamps.push(lamp));
    const controlButtons = [
        { x: 0.35, y: 2.12, color: 0x35ff70 },
        { x: 0.68, y: 2.12, color: 0xff3030 },
        { x: 0.35, y: 1.78, color: 0xfab95b },
        { x: 0.68, y: 1.78, color: 0x7ccfff }
    ];
    controlButtons.forEach(button => {
        const key = new THREE.Mesh(
            new THREE.CylinderGeometry(0.075, 0.075, 0.045, 12),
            new THREE.MeshStandardMaterial({ color: button.color, emissive: button.color, emissiveIntensity: 0.3 })
        );
        key.rotation.x = Math.PI / 2;
        key.position.set(button.x, button.y, 0.48);
        g.add(key);
    });

    /* panel status beacon */
    const bMat = new THREE.MeshBasicMaterial({ color: 0x35ff70 });
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 8), matPipe);
    mast.position.set(0.95, 2.85, 0);
    g.add(mast);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 10), bMat);
    beacon.position.set(0.95, 3.08, 0);
    g.add(beacon);
    panelLamps.push({ mat: bMat, beacon: true });

    const tag = makeLabel('FIRE ALARM', '#35ff70');
    tag.position.set(0, 3.9, 0);
    g.add(tag);
    addAO(PANEL_POS.x, PANEL_POS.z, 4, 4, 0.5);

    /* Keep signal conduit at grade and route around, not across, the pipe rack
       and ring main. Rear sensors take the north/east perimeter corridor. */
    const roundRouteCorners = (points, radius) => {
        const path = new THREE.CurvePath();
        let cursor = points[0].clone();
        for (let i = 1; i < points.length - 1; i++) {
            const corner = points[i];
            const incoming = corner.clone().sub(points[i - 1]);
            const outgoing = points[i + 1].clone().sub(corner);
            const bend = Math.min(radius, incoming.length() / 2, outgoing.length() / 2);
            incoming.normalize();
            outgoing.normalize();
            const enter = corner.clone().addScaledVector(incoming, -bend);
            const leave = corner.clone().addScaledVector(outgoing, bend);
            if (cursor.distanceTo(enter) > 0.001) path.add(new THREE.LineCurve3(cursor, enter));
            path.add(new THREE.QuadraticBezierCurve3(enter, corner, leave));
            cursor = leave;
        }
        path.add(new THREE.LineCurve3(cursor, points[points.length - 1]));
        return path;
    };
    irCameras.forEach(camera => {
        const { px, pz } = irPolePos(camera.tank, camera.index);
        const tankIndex = TANKS.indexOf(camera.tank);
        const routeIndex = tankIndex * 2 + camera.index;
        const conduitY = 0.52;
        const panelX = PANEL_POS.x + (routeIndex - 1.5) * 0.42;
        const panelEntryZ = PANEL_POS.z + 0.5;
        const waypoints = camera.index === 0
            ? [
                camera.group.position.clone(),
                V3(px, conduitY, pz),
                V3(px, conduitY, -9.5 - tankIndex * 1.1),
                V3(panelX, conduitY, -9.5 - tankIndex * 1.1),
                V3(panelX, conduitY, panelEntryZ)
            ]
            : [
                camera.group.position.clone(),
                V3(px, conduitY, pz),
                V3(px, conduitY, -61 - tankIndex * 1.2),
                V3(10.5 + tankIndex * 1.2, conduitY, -61 - tankIndex * 1.2),
                V3(10.5 + tankIndex * 1.2, conduitY, panelEntryZ),
                V3(panelX, conduitY, panelEntryZ)
            ];
        const curve = roundRouteCorners(waypoints, 0.45);
        const panelCableEntry = V3(panelX, conduitY, panelEntryZ);
        const panelRiserTop = V3(panelX, 1.05, panelEntryZ);
        curve.add(new THREE.LineCurve3(panelCableEntry, panelRiserTop));
        curve.add(new THREE.LineCurve3(panelRiserTop, V3(panelX, 1.05, PANEL_POS.z + 0.32)));
        const supportCount = Math.max(2, Math.floor(curve.getLength() / 8));
        for (let i = 1; i < supportCount; i++) {
            const supportPoint = curve.getPointAt(i / supportCount);
            if (supportPoint.y > conduitY + 0.02) continue;
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.035, 0.045, 0.4, 8), matStructure);
            post.position.set(supportPoint.x, 0.24, supportPoint.z);
            scene.add(post);
            const foot = new THREE.Mesh(
                new THREE.BoxGeometry(0.2, 0.1, 0.2), matDark);
            foot.position.set(supportPoint.x, 0.05, supportPoint.z);
            scene.add(foot);
        }
        const traceMat = new THREE.MeshBasicMaterial({
            color: 0x55bfff, transparent: true, opacity: 0.4,
            blending: THREE.AdditiveBlending, depthWrite: false
        });
        scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 140, 0.055, 6, false), traceMat));
        const pulseMat = new THREE.MeshBasicMaterial({
            color: 0xffb52e, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false
        });
        const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), pulseMat);
        scene.add(pulse);
        signalTraces.push({ curve, mat: traceMat, pulse, pulseMat, tank: camera.tank, index: camera.index });
    });
}

/* ==========================================================================
   FIRE PUMP HOUSE — two diesel fire pumps + one electric standby + jockey
   pump (NFPA 20). Pumps run off the low-pressure switch on the ring main.
   ========================================================================== */
const PUMP_POS = V3(-52, 0, -12);

function buildPumpHouse() {
    const g = new THREE.Group();
    g.position.copy(PUMP_POS);
    scene.add(g);
    pumpHouseGroup = g;

    const pumpMetal = metalMaterial(0x31383d, 0.55, 0.62);
    const pumpAlloy = metalMaterial(0x92999d, 0.38, 0.72);
    const pumpRubber = metalMaterial(0x12181d, 0.82, 0.08);
    const pumpCoating = metalMaterial(0x505b63, 0.5, 0.58);
    const addBox = (parent, size, position, material, castShadow = true) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
        mesh.position.set(...position);
        mesh.castShadow = castShadow;
        mesh.receiveShadow = true;
        parent.add(mesh);
        return mesh;
    };
    const addCylinderBetween = (parent, start, end, radius, material, segments = 14) => {
        const delta = end.clone().sub(start);
        const mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(radius, radius, delta.length(), segments),
            material
        );
        mesh.position.copy(start).add(end).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(V3(0, 1, 0), delta.normalize());
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
        return mesh;
    };
    const addPipeRoute = (parent, points, radius, material, segments = 28) => {
        const curve = new THREE.CatmullRomCurve3(points.map(point => point.clone()), false, 'centripetal');
        const pipe = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, 10, false), material);
        pipe.castShadow = true;
        pipe.receiveShadow = true;
        parent.add(pipe);
        return curve;
    };
    const addFlange = (parent, center, axis, radius) => {
        const direction = axis.clone().normalize();
        const flange = new THREE.Group();
        flange.position.copy(center);
        flange.quaternion.setFromUnitVectors(V3(0, 0, 1), direction);
        const plate = new THREE.Mesh(
            new THREE.CylinderGeometry(radius, radius, 0.12, 20),
            matFireRed
        );
        plate.rotation.x = Math.PI / 2;
        flange.add(plate);
        flange.add(new THREE.Mesh(new THREE.TorusGeometry(radius * 0.74, 0.035, 7, 20), pumpAlloy));
        for (let bolt = 0; bolt < 8; bolt++) {
            const angle = bolt * Math.PI / 4;
            const stud = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), pumpAlloy);
            stud.position.set(Math.cos(angle) * radius * 0.78, Math.sin(angle) * radius * 0.78, 0);
            flange.add(stud);
        }
        parent.add(flange);
        return flange;
    };
    const addHeader = (x, y, z0, z1, radius) => {
        addCylinderBetween(g, V3(x, y, z0), V3(x, y, z1), radius, matFireWater, 20);
        [-1, 1].forEach(side => {
            addFlange(g, V3(x, y, side < 0 ? z0 : z1), V3(0, 0, 1), radius * 1.42);
        });
        [-3.05, 2.95].forEach(z => {
            addBox(g, [0.22, Math.max(0.16, y - 0.42), 0.22], [x, y / 2 + 0.21, z], pumpMetal);
            addBox(g, [0.62, 0.12, 0.58], [x, 0.36, z], pumpMetal);
        });
    };

    /* Neutral coated skid frame; fire red stays on pipework and valve details. */
    addBox(g, [10.9, 0.18, 7.8], [0, 0.15, 0], pumpMetal);
    [-3.65, 3.65].forEach(z => addBox(g, [10.7, 0.24, 0.28], [0, 0.34, z], pumpCoating));
    [-5.25, 0, 5.25].forEach(x => addBox(g, [0.28, 0.24, 7.4], [x, 0.34, 0], pumpCoating));
    [-2.5, -0.6, 1.3].forEach(z => {
        [-4.45, -1.8, 0.9, 2.6].forEach(x => {
            const foot = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 1.48), pumpRubber);
            foot.position.set(x, 0.49, z);
            g.add(foot);
        });
    });

    /* Parallel suction and discharge headers, with flanged site supply tie-in. */
    const suctionX = -5.02, suctionY = 1.02;
    const dischargeX = -3.1, dischargeY = 2.72;
    const headerStart = -3.5, headerEnd = 3.5;
    addHeader(suctionX, suctionY, headerStart, headerEnd, 0.21);
    addHeader(dischargeX, dischargeY, headerStart, headerEnd, 0.25);
    const supplyLabel = makeLabel('FIRE-WATER SUPPLY INLET', '#ff6a5a');
    supplyLabel.scale.set(1.4, 0.28, 1);
    supplyLabel.position.set(-4.5, 1.65, -3.15);
    g.add(supplyLabel);
    addFlange(g, V3(suctionX, suctionY, headerEnd), V3(0, 0, 1), 0.36);

    /* Three horizontal centrifugal pumps in parallel with their drivers. */
    const mainRows = [
        { type: 'DIESEL-1', z: -2.25, primary: true },
        { type: 'DIESEL-2', z: -0.35, primary: true },
        { type: 'ELECTRIC', z: 1.55, primary: true }
    ];
    mainRows.forEach((unit, index) => {
        const row = unit.z;
        const pump = new THREE.Group();
        pump.position.set(0, 0, row);
        g.add(pump);

        addBox(pump, [7.1, 0.18, 1.45], [-0.85, 0.56, 0], pumpCoating);
        addBox(pump, [1.35, 0.18, 1.25], [-3.85, 0.73, 0], pumpMetal);

        /* Split-case volute, bolted suction cover, and horizontal shaft. */
        const casing = new THREE.Mesh(new THREE.SphereGeometry(0.64, 20, 16), pumpCoating);
        casing.position.set(-3.85, 1.25, 0);
        casing.scale.set(0.78, 0.95, 0.9);
        casing.castShadow = true;
        pump.add(casing);
        const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.16, 20), pumpAlloy);
        cover.rotation.z = Math.PI / 2;
        cover.position.set(-4.29, 1.25, 0);
        pump.add(cover);
        addFlange(pump, V3(-4.39, 1.25, 0), V3(-1, 0, 0), 0.51);
        const bearing = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.3, 14), pumpMetal);
        bearing.rotation.z = Math.PI / 2;
        bearing.position.set(-3.22, 1.27, 0);
        pump.add(bearing);

        /* Suction branch from the shared header through an isolation valve. */
        const suctionPort = V3(-4.39, 1.25, 0);
        addPipeRoute(pump, [
            V3(suctionX, suctionY, 0),
            V3(-4.82, suctionY, 0),
            V3(-4.58, 1.12, 0),
            suctionPort
        ], 0.15, matFireWater, 16);
        addFlange(pump, V3(-4.84, suctionY, 0), V3(1, 0, 0), 0.29);
        const suctionValve = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.28, 16), matFireRed);
        suctionValve.rotation.z = Math.PI / 2;
        suctionValve.position.set(-4.72, 1.08, 0);
        pump.add(suctionValve);
        const suctionWheel = buildHandwheel(0.2, matFireRed);
        suctionWheel.position.set(-4.72, 1.43, 0);
        suctionWheel.rotation.z = Math.PI / 2;
        pump.add(suctionWheel);

        /* Upturned discharge branch with an isolation/check-valve assembly. */
        addPipeRoute(pump, [
            V3(-3.47, 1.6, 0),
            V3(-3.47, 1.92, 0),
            V3(-3.34, 2.17, 0),
            V3(dischargeX, 2.36, 0),
            V3(dischargeX, dischargeY, 0)
        ], 0.14, matFireWater, 22);
        const checkBody = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.3, 16), matFireRed);
        checkBody.position.set(dischargeX, 2.33, 0);
        pump.add(checkBody);
        addFlange(pump, V3(dischargeX, 2.14, 0), V3(0, 1, 0), 0.31);
        addFlange(pump, V3(dischargeX, 2.53, 0), V3(0, 1, 0), 0.31);
        const dischargeWheel = buildHandwheel(0.18, matFireRed);
        dischargeWheel.position.set(dischargeX + 0.36, 2.33, 0);
        pump.add(dischargeWheel);

        /* Shaft coupling, guarded engine/generator package, and driver detail. */
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.3, 12), pumpAlloy);
        shaft.rotation.z = Math.PI / 2;
        shaft.position.set(-2.55, 1.28, 0);
        pump.add(shaft);
        const coupling = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.26, 14), matFireRed);
        coupling.rotation.z = Math.PI / 2;
        coupling.position.set(-2.84, 1.28, 0);
        pump.add(coupling);
        const guard = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.54, 0.72), pumpMetal);
        guard.position.set(-2.57, 1.28, 0);
        const guardEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(guard.geometry),
            new THREE.LineBasicMaterial({ color: 0xe6a33d })
        );
        guardEdges.position.copy(guard.position);
        pump.add(guardEdges);

        let rotor;
        if (unit.type.startsWith('DIESEL')) {
            addBox(pump, [2.15, 0.86, 1.05], [-0.95, 1.12, 0], pumpMetal);
            addBox(pump, [1.95, 0.28, 1.0], [-0.95, 1.69, 0], pumpCoating);
            for (let cylinder = 0; cylinder < 6; cylinder++) {
                const x = -1.72 + cylinder * 0.31;
                addBox(pump, [0.19, 0.24, 1.08], [x, 1.91, 0], pumpCoating);
                const injector = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 8), pumpAlloy);
                injector.position.set(x, 2.13, 0);
                pump.add(injector);
            }
            const exhaustRail = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1.9, 10), pumpMetal);
            exhaustRail.rotation.z = Math.PI / 2;
            exhaustRail.position.set(-0.95, 2.13, 0.56);
            pump.add(exhaustRail);
            const exhaustBend = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.55, 10), pumpMetal);
            exhaustBend.position.set(0.12, 2.36, 0.56);
            pump.add(exhaustBend);
            const exhaustStack = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.75, 10), pumpMetal);
            exhaustStack.position.set(0.12, 2.83, 0.56);
            pump.add(exhaustStack);
            addBox(pump, [0.44, 0.38, 0.38], [-0.03, 1.42, -0.68], matFireRed);
            addBox(pump, [0.62, 1.45, 1.12], [1.83, 1.28, 0], pumpCoating);
            addBox(pump, [0.08, 1.18, 0.92], [1.49, 1.28, 0], pumpMetal);
            for (let fin = 0; fin < 10; fin++) {
                addBox(pump, [0.035, 1.04, 0.035], [1.43, 0.76 + fin * 0.115, 0], pumpAlloy, false);
            }
            const fan = new THREE.Group();
            fan.position.set(1.39, 1.28, 0);
            const fanHub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.16, 12), pumpAlloy);
            fanHub.rotation.z = Math.PI / 2;
            fan.add(fanHub);
            for (let blade = 0; blade < 5; blade++) {
                const vane = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.48), pumpMetal);
                vane.position.z = 0.25;
                vane.rotation.x = blade * Math.PI * 2 / 5;
                fan.add(vane);
            }
            const fanGuard = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.045, 8, 24), pumpAlloy);
            fanGuard.rotation.y = Math.PI / 2;
            fan.add(fanGuard);
            pump.add(fan);
            rotor = fan;
            [-1.55, -0.85, -0.15].forEach(x => {
                addBox(pump, [0.48, 0.42, 0.48], [x, 0.9, -0.68], pumpMetal);
                addBox(pump, [0.18, 0.06, 0.12], [x - 0.12, 1.14, -0.68], matFireRed, false);
                addBox(pump, [0.18, 0.06, 0.12], [x + 0.12, 1.14, -0.68], matFireRed, false);
            });
        } else {
            const electricMotor = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 1.9, 18), pumpMetal);
            electricMotor.rotation.z = Math.PI / 2;
            electricMotor.position.set(-0.85, 1.26, 0);
            pump.add(electricMotor);
            for (let fin = 0; fin < 8; fin++) {
                const x = -1.62 + fin * 0.22;
                const rib = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.035, 6, 18), pumpAlloy);
                rib.rotation.y = Math.PI / 2;
                rib.position.set(x, 1.26, 0);
                pump.add(rib);
            }
            addBox(pump, [0.48, 0.37, 0.42], [-0.65, 1.83, -0.43], matFireRed);
            const fan = new THREE.Group();
            fan.position.set(0.18, 1.26, 0);
            const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.18, 12), pumpAlloy);
            hub.rotation.z = Math.PI / 2;
            fan.add(hub);
            for (let blade = 0; blade < 5; blade++) {
                const vane = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.46), pumpMetal);
                vane.position.z = 0.23;
                vane.rotation.x = blade * Math.PI * 2 / 5;
                fan.add(vane);
            }
            pump.add(fan);
            rotor = fan;
        }

        const lampMat = new THREE.MeshBasicMaterial({ color: 0x25343c });
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), lampMat);
        lamp.position.set(1.1, 2.0, 0.72);
        pump.add(lamp);
        const label = unit.type.startsWith('DIESEL') ? `${unit.type} ENGINE` : 'ELECTRIC MOTOR';
        const tag = makeLabel(label, unit.primary ? '#ff6654' : '#7ccfff');
        tag.scale.set(0.72, 0.15, 1);
        tag.position.set(-0.8, 2.42, 0.72);
        pump.add(tag);
        pumpUnits.push({ ...unit, rotor, lampMat, rotationAxis: 'x' });
    });

    /* One shared day tank feeds both diesel engines through visible lines. */
    addBox(g, [1.0, 1.72, 1.65], [4.0, 1.25, 0.5], pumpCoating);
    addBox(g, [1.1, 0.16, 1.75], [4.0, 0.38, 0.5], pumpMetal);
    const fuelCap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.18, 12), pumpAlloy);
    fuelCap.position.set(4.0, 2.16, 0.5);
    g.add(fuelCap);
    const levelGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.72, 10), matIce);
    levelGlass.position.set(3.47, 1.3, 0.5);
    g.add(levelGlass);
    const tankTag = makeLabel('DIESEL DAY TANK', '#ff6a5a');
    tankTag.scale.set(1.3, 0.26, 1);
    tankTag.position.set(4.0, 2.38, 1.05);
    g.add(tankTag);
    addPipeRoute(g, [
        V3(3.47, 0.88, 0.5),
        V3(3.1, 0.78, 0.5),
        V3(0.3, 0.78, 0.5)
    ], 0.045, pumpRubber, 24);
    mainRows.filter(unit => unit.type.startsWith('DIESEL')).forEach(unit => {
        addPipeRoute(g, [
            V3(0.3, 0.78, 0.5),
            V3(0.3, 0.78, unit.z),
            V3(0.05, 0.78, unit.z),
            V3(0.05, 0.95, unit.z)
        ], 0.04, pumpRubber, 20);
    });

    /* Dedicated vertical multistage jockey pump and small driver. */
    const jockeyZ = 3.08;
    addBox(g, [2.1, 0.18, 1.42], [-3.6, 0.56, jockeyZ], pumpCoating);
    const jBase = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.42, 0.26, 16), pumpCoating);
    jBase.position.set(-3.72, 0.82, jockeyZ);
    g.add(jBase);
    for (let stage = 0; stage < 4; stage++) {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.19, 14), stage % 2 ? pumpMetal : pumpCoating);
        ring.position.set(-3.72, 0.99 + stage * 0.19, jockeyZ);
        g.add(ring);
    }
    const jMotor = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.92, 16), pumpCoating);
    jMotor.position.set(-3.72, 2.0, jockeyZ);
    g.add(jMotor);
    for (let fin = 0; fin < 5; fin++) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.035, 6, 18), pumpAlloy);
        rib.position.set(-3.72, 1.7 + fin * 0.13, jockeyZ);
        g.add(rib);
    }
    addBox(g, [0.35, 0.3, 0.38], [-3.37, 2.06, jockeyZ], pumpMetal);
    addBox(g, [0.06, 0.22, 0.3], [-3.17, 2.06, jockeyZ], pumpAlloy);
    const jRotor = new THREE.Group();
    jRotor.position.set(-3.72, 2.51, jockeyZ);
    const jFanHub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 10), pumpAlloy);
    jRotor.add(jFanHub);
    for (let blade = 0; blade < 5; blade++) {
        const vane = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.3), pumpMetal);
        vane.position.z = 0.16;
        vane.rotation.y = blade * Math.PI * 2 / 5;
        jRotor.add(vane);
    }
    g.add(jRotor);
    const jockeyLampMat = new THREE.MeshBasicMaterial({ color: 0x25343c });
    const jockeyLamp = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), jockeyLampMat);
    jockeyLamp.position.set(-3.32, 2.5, jockeyZ + 0.35);
    g.add(jockeyLamp);
    const jockeyLabel = makeLabel('JOCKEY PUMP', '#7ccfff');
    jockeyLabel.scale.set(1.0, 0.2, 1);
    jockeyLabel.position.set(-3.65, 3.08, jockeyZ + 0.48);
    g.add(jockeyLabel);
    pumpUnits.push({
        type: 'JOCKEY', z: jockeyZ, primary: false, rotor: jRotor,
        lampMat: jockeyLampMat, rotationAxis: 'y'
    });

    /* Complete the jockey's suction and pressure-maintenance discharge legs. */
    addPipeRoute(g, [
        V3(suctionX, suctionY, jockeyZ),
        V3(-4.72, suctionY, jockeyZ),
        V3(-4.24, 1.0, jockeyZ),
        V3(-4.08, 1.0, jockeyZ)
    ], 0.105, matFireWater, 18);
    addFlange(g, V3(-4.83, suctionY, jockeyZ), V3(1, 0, 0), 0.24);
    const jockeySuctionValve = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.24, 14), matFireRed);
    jockeySuctionValve.rotation.z = Math.PI / 2;
    jockeySuctionValve.position.set(-4.57, 1.02, jockeyZ);
    g.add(jockeySuctionValve);
    const jockeySuctionWheel = buildHandwheel(0.16, matFireRed);
    jockeySuctionWheel.position.set(-4.57, 1.31, jockeyZ);
    jockeySuctionWheel.rotation.z = Math.PI / 2;
    g.add(jockeySuctionWheel);
    addPipeRoute(g, [
        V3(-3.38, 1.42, jockeyZ),
        V3(-3.28, 1.82, jockeyZ),
        V3(dischargeX, 2.1, jockeyZ),
        V3(dischargeX, dischargeY, jockeyZ)
    ], 0.10, matFireWater, 20);
    const jockeyCheck = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.24, 14), matFireRed);
    jockeyCheck.position.set(dischargeX, 2.34, jockeyZ);
    g.add(jockeyCheck);
    addFlange(g, V3(dischargeX, 2.18, jockeyZ), V3(0, 1, 0), 0.24);
    addFlange(g, V3(dischargeX, 2.5, jockeyZ), V3(0, 1, 0), 0.24);

    /* Pressure gauge impulse line taps the discharge manifold directly. */
    addPipeRoute(g, [
        V3(dischargeX, dischargeY, -3.05),
        V3(-2.65, dischargeY, -3.15),
        V3(-1.85, 2.9, -3.15),
        V3(-1.6, 3.0, -3.15)
    ], 0.055, matPipe, 20);
    buildGauge(g, -1.6, 3.22, -3.15, 0.72, 'PUMP DISCH 10 BAR');

    const pTag = makeLabel('FIRE PUMP SKID', '#ff5a4a');
    pTag.scale.set(0.9, 0.18, 1);
    pTag.position.set(0.5, 4.45, -0.2);
    g.add(pTag);
    addAO(PUMP_POS.x, PUMP_POS.z, 13, 10, 0.55);

    /* Common discharge outlet turns off the header and drops into the yard main. */
    const dischargeCurve = addPipeRoute(g, [
        V3(dischargeX, dischargeY, headerStart),
        V3(dischargeX, dischargeY, -3.85),
        V3(-1.8, dischargeY, -4.05),
        V3(0, dischargeY, -4.05),
        V3(0, 2.45, -4.45),
        V3(0, 1.55, -5.6),
        V3(0, 1.05, -6.5)
    ], 0.26, matFireWater, 56);
    addFlange(g, V3(dischargeX, dischargeY, headerStart), V3(0, 0, 1), 0.38);

    const flowMat = new THREE.MeshBasicMaterial({
        color: 0x7ccfff, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    const flowCore = new THREE.Mesh(new THREE.TubeGeometry(dischargeCurve, 56, 0.13, 8, false), flowMat);
    g.add(flowCore);
    pumpDischargeFlow = { curve: dischargeCurve, material: flowMat };
    for (let i = 0; i < 5; i++) {
        const pulse = new THREE.Mesh(
            new THREE.SphereGeometry(0.11, 8, 6),
            new THREE.MeshBasicMaterial({
                color: 0xbfeeff, transparent: true, opacity: 0, depthWrite: false,
                blending: THREE.AdditiveBlending
            })
        );
        g.add(pulse);
        pumpFlowPulses.push(pulse);
    }
}

function buildFireAndWater() {
    /* POOL FIRE in the TK-001 dike — burning product spread around the bund
       annulus, between shell and containment wall. Lower and wider than a
       rim-seal flame: squat, rolling, hugging the dike floor. All five beds
       sit at r = 8.5–9.5 m from the tank axis, i.e. mid-annulus: clear of the
       shell (r 6) and clear of the new 24 m wall (half 12). */
    const fireDefs = [
        { pos: FIRE_POS.clone(), base: 0.62, area: 0.75, hs: 1.5, sMax: 8, f: 0.30 },
        { pos: V3(-31.1, 0.30, -27.0), base: 0.56, area: 0.70, hs: 1.3, sMax: 7, f: 0.20 },
        { pos: V3(-31.1, 0.30, -41.0), base: 0.54, area: 0.70, hs: 1.3, sMax: 7, f: 0.19 },
        { pos: V3(-40.9, 0.30, -27.0), base: 0.50, area: 0.65, hs: 1.2, sMax: 6, f: 0.16 },
        { pos: V3(-40.9, 0.30, -41.0), base: 0.48, area: 0.65, hs: 1.2, sMax: 6, f: 0.15 }
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
        count: QUALITY.smoke, area: 3.4, heightSpread: 1.2,
        sizeMin: 4, sizeMax: 9, vert: SMOKE_VERT, frag: SMOKE_FRAG,
        blending: THREE.NormalBlending
    });
    smokeSys.position.copy(FIRE_POS).add(V3(0, 1.6, 0));
    smokeSys.scale.setScalar(1.0);
    scene.add(smokeSys);

    steamSys = buildParticles({
        count: QUALITY.steam, area: 3.0, heightSpread: 1.2,
        sizeMin: 2.2, sizeMax: 4.6, vert: STEAM_VERT, frag: STEAM_FRAG,
        blending: THREE.NormalBlending
    });
    steamSys.position.copy(FIRE_POS).add(V3(0, 0.3, 0));
    steamSys.scale.setScalar(1.05);
    scene.add(steamSys);

    /* pilot flame REMOVED with the flare stack — no standalone flame post. */
    pilotSys = null;

    /* expanding FOAM BLANKET across the dike floor — driven by bundFill.
       Spreads outward from the pool fire until the whole bund is blanketed. */
    const discGeo = new THREE.CircleGeometry(1, 40);
    discGeo.rotateX(-Math.PI / 2);
    splashDisc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({
        color: 0xaab7cb, transparent: true, opacity: 0,
        depthWrite: false
    }));
    splashDisc.position.set(TANKS[0].x, 0.05, TANKS[0].z);
    splashDisc.renderOrder = 3;
    scene.add(splashDisc);
    const ringGeo = new THREE.TorusGeometry(1, 0.06, 8, 48);
    ringGeo.rotateX(Math.PI / 2);
    // the advancing foam front: a slightly brighter tint of the same dull foam.
    // It used to be pure white with AdditiveBlending, i.e. a genuine emitter
    // sitting on the dike floor, which alone pushed the bund over the bloom
    // threshold. Normal blending keeps it a lit-looking edge instead.
    splashRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xc3cede, transparent: true, opacity: 0, depthWrite: false
    }));
    splashRing.position.set(TANKS[0].x, 0.06, TANKS[0].z);
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
/* Camera keyframes use whole-page scroll progress so the equipment sequence
   starts immediately instead of waiting for the later incident chapter. */
const SIGNAL_TRAVEL_START = 0.215;
const SIGNAL_TRAVEL_END = 0.335;
const SIGNAL_APPROACH_START = 0.19;
const SIGNAL_TRACK_END = 0.325;
const SHOT_DEFS = [
    { progress: 0.0, pos: [-16, 24, 12], look: [-26, 4, -27], fov: 50 },
    { progress: 0.045, pos: [-24, 13, -12], look: [-29, 3, -34], fov: 43 },
    { progress: 0.085, pos: [-26, 8, -18], look: [-26.5, -1, -34], fov: 34 },
    { progress: 0.12, pos: [-31, 8, -14], look: [-26, 1, -34], fov: 32 },

    /* Sweep past the front IR head and beam, keeping the pole in frame. */
    { progress: 0.155, pos: [-42, 12, -14], look: [-34.5, 6, -10], fov: 31 },
    { progress: 0.19, pos: [-33, 10, -5], look: [-36, 8, -8], fov: 34 },

    /* Stay with the signal marker as it descends the pole and follows the cable. */
    { progress: 0.215, signalPath: 0.00, fov: 33 },
    { progress: 0.23, signalPath: 0.06, fov: 33 },
    { progress: 0.245, signalPath: 0.13, fov: 33 },
    { progress: 0.26, signalPath: 0.24, fov: 33 },
    { progress: 0.275, signalPath: 0.38, fov: 33 },
    { progress: 0.29, signalPath: 0.54, fov: 33 },
    { progress: 0.305, signalPath: 0.70, fov: 33 },
    { progress: 0.32, signalPath: 0.86, fov: 33 },
    { progress: 0.335, signalPath: 0.98, fov: 34 },
    /* Hold on V-102 beside the panel as it turns, then sweep once to V-101. */
    { progress: 0.35, pos: [-10, 7, -10], look: [-6, 1.7, -17.4], fov: 31 },
    { progress: 0.36, pos: [-11, 7, -10], look: [-6, 1.7, -17.4], fov: 31 },
    { progress: 0.37, pos: [-12, 7, -10], look: [-6.5, 1.7, -17.4], fov: 31 },
    { progress: 0.375, pos: [-15, 8, -10], look: [-13, 1.7, -17.4], fov: 33 },
    { progress: 0.385, pos: [-24, 9, -10], look: [-29, 1.7, -17.4], fov: 33 },
    { progress: 0.40, pos: [-34, 8, -10], look: [-36, 1.7, -17.4], fov: 32 },
    { progress: 0.415, pos: [-38, 9, -13], look: [-36, 2, -20], fov: 35 },
    { progress: 0.425, pos: [-34, 12, -15], look: [-36, 3, -24], fov: 39 },
    { progress: 0.43, pos: [-29, 13, -12], look: [-38, 2, -27], fov: 44 },

    /* Drone-style pass above the dispenser, moving left-to-right over the throw. */
    { progress: 0.435, pos: [-27, 14, -9], look: [-38, 2, -30], fov: 48 },
    { progress: 0.455, pos: [-25, 14, -9], look: [-38, 2, -30], fov: 48 },
    { progress: 0.475, pos: [-23, 14, -9], look: [-38, 2, -30], fov: 48 },
    { progress: 0.495, pos: [-21, 14, -9], look: [-38, 2, -30], fov: 48 },
    { progress: 0.515, pos: [-19, 14, -9], look: [-38, 2, -30], fov: 48 },
    { progress: 0.535, pos: [-39, 19, -16], look: [-36, 9, -34], fov: 42 },
    { progress: 0.55, pos: [-24, 20, -18], look: [-20, 9, -34], fov: 43 },
    { progress: 0.58, pos: [-8, 18, -20], look: [-6, 9, -34], fov: 42 },
    { progress: 0.58, pos: [-8, 18, -20], look: [-6, 9, -34], fov: 42 },

    /* Track the falling pressure on the gauge while continuing the orbit. */
    { progress: 0.62, pos: [-18, 12, -11], look: [-22, 3, -18.5], fov: 37 },
    { progress: 0.665, pos: [-28, 8, -8], look: [-22, 3, -18.5], fov: 34 },
    { progress: 0.715, pos: [-30, 7, -13], look: [-22, 3, -18.5], fov: 36 },

    /* Give the jockey pump a sustained close pass before returning to the gauge. */
    { progress: 0.76, pos: [-37, 12, -11], look: [-52, 3, -13], fov: 45 },
    { progress: 0.785, pos: [-63.5, 7.0, -6.5], look: [-55.7, 1.7, -8.9], fov: 39 },
    { progress: 0.795, pos: [-63.1, 6.8, -6.2], look: [-55.6, 1.7, -8.8], fov: 38 },
    { progress: 0.805, pos: [-62.7, 6.6, -5.8], look: [-55.5, 1.7, -8.7], fov: 37 },
    { progress: 0.815, pos: [-62.2, 6.8, -5.5], look: [-55.4, 1.7, -8.7], fov: 38 },
    { progress: 0.825, pos: [-61.5, 7.2, -5.3], look: [-55.0, 1.9, -9.0], fov: 40 },

    /* Ease out from the pump skid and arc back to the ring gauge. */
    { progress: 0.832, pos: [-57, 8.2, -4.1], look: [-51.5, 2.6, -10.4], fov: 42 },
    { progress: 0.84, pos: [-51.5, 10, -4.4], look: [-42.5, 4.0, -14.2], fov: 41 },
    { progress: 0.848, pos: [-44, 11.2, -6.7], look: [-33, 4.2, -17.2], fov: 39 },
    { progress: 0.856, pos: [-36, 10, -9.2], look: [-25, 3.8, -18.5], fov: 36 },
    { progress: 0.866, pos: [-30, 8, -9], look: [-22, 3, -18.5], fov: 34 },
    /* Hold on the ring pressure gauge while the pressure recovers. */
    { progress: 0.88, pos: [-27, 7, -8], look: [-22, 3, -18.5], fov: 33 },
    { progress: 0.905, pos: [-25, 9, -9], look: [-22, 3, -18.5], fov: 36 },

    /* Continue the orbit into a gradual pull-back after the gauge shot. */
    { progress: 0.915, pos: [-27, 11, -9], look: [-27, 4, -22], fov: 40 },
    { progress: 0.93, pos: [-31, 14, -7], look: [-34, 4, -27], fov: 45 },
    { progress: 0.95, pos: [-29, 18, -2], look: [-33, 5, -29], fov: 48 },
    { progress: 0.975, pos: [-22, 22, 7], look: [-29, 5, -29], fov: 50 },
    { progress: 1.0, pos: [-16, 24, 12], look: [-26, 4, -27], fov: 50 }
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
        const r = s.act ? chapterRanges && chapterRanges[s.act] : null;
        if (s.progress === undefined && !r) return;
        us.push(s.progress === undefined ? r.start + s.u * (r.end - r.start) : s.progress);
        if (s.signalPath !== undefined) {
            const frontSignal = signalTraces.find(tr => tr.tank.burning && tr.index === 0);
            if (!frontSignal) throw new Error('Front IR camera signal path is missing');
            const pathPoint = frontSignal.curve.getPointAt(s.signalPath);
            camPts.push(pathPoint.add(V3(6, 2.5, 6)));
            lookPts.push(pathPoint);
        } else {
            camPts.push(V3(...s.pos));
            lookPts.push(V3(...s.look));
        }
        fovs.push(s.fov);
    });
    // Adjacent acts share their boundary progress. Nudge only exact duplicate
    // timestamps; spreading dense response keyframes changes the timeline.
    for (let i = 1; i < us.length; i++) {
        if (us[i] <= us[i - 1] + 1e-6) us[i] = us[i - 1] + 1e-4;
    }
    camCurve = new THREE.CatmullRomCurve3(camPts, false, 'catmullrom', 0.35);
    lookCurve = new THREE.CatmullRomCurve3(lookPts, false, 'catmullrom', 0.35);
    rig = { us, fovs };
}

const _camP = new THREE.Vector3(), _lookP = new THREE.Vector3();
const _signalCamP = new THREE.Vector3(), _signalLookP = new THREE.Vector3();
const _signalOffset = V3(6, 2.5, 6);
/* temporally smoothed camera state — guarantees cut-free motion */
const smoothPos = new THREE.Vector3(46, 27, 64);
const smoothLook = new THREE.Vector3(2, 7, 4);
let smoothFov = 58, smoothInit = false;
let targetRoll = 0;
const _q = new THREE.Quaternion();
const UP = V3(0, 1, 0);

function sampleRailRig(p) {
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

function sampleRig(p) {
    if (p > SIGNAL_APPROACH_START && p <= 0.35) {
        const frontSignal = signalTraces.find(tr => tr.tank.burning && tr.index === 0);
        if (!frontSignal) throw new Error('Front IR camera signal path is missing');
        const u = clamp(
            (p - SIGNAL_TRAVEL_START) / (SIGNAL_TRAVEL_END - SIGNAL_TRAVEL_START),
            0,
            1
        );
        const markerPoint = frontSignal.curve.getPointAt(u);
        _signalCamP.copy(markerPoint).add(_signalOffset);
        _signalLookP.copy(markerPoint);

        if (p < SIGNAL_TRAVEL_START) {
            const approach = ss(p, SIGNAL_APPROACH_START, SIGNAL_TRAVEL_START);
            _camP.set(-33, 10, -5).lerp(_signalCamP, approach);
            _lookP.set(-36, 8, -8).lerp(_signalLookP, approach);
            targetRoll = 0;
            return 34 + (38 - 34) * approach;
        }

        if (p <= SIGNAL_TRACK_END) {
            _camP.copy(_signalCamP);
            _lookP.copy(_signalLookP);
            targetRoll = 0;
            return 38;
        }

        const departure = ss(p, SIGNAL_TRACK_END, 0.35);
        _camP.copy(_signalCamP).lerp(V3(-10, 7, -10), departure);
        _lookP.copy(_signalLookP).lerp(V3(-6, 1.7, -17.4), departure);
        targetRoll = 0;
        return 38 + (31 - 38) * departure;
    }

    const railFov = sampleRailRig(p);
    return railFov;
}

/* ==========================================================================
   THE 9-STEP CAUSAL CHAIN. Scroll maps to one ordered sequence — nothing
   acts before its cause. Runs from the incident act into suppression.

     0 IGNITION ......... pool fire established in the TK-001 dike
     1 IR DETECTION ..... opposing TK-001 cameras latch red
     2 SIGNAL -> PANEL .. camera signals reach Fire Alarm Panel FACP-01
     3 PANEL -> VALVE ... V-101 opens the deluge system
     4 TK-001 RESPONSE .. roof sprinklers and dike foam start together
     5 TK-002 RESPONSE .. adjacent tank roof sprinklers start
     6 PRESSURE FALL .... ring pressure reaches the 7 bar switch point
     7 FIRE PUMPS ....... pumps start and discharge into the fire-water main
     8 ALL CLEAR ........ fire controlled; camera pulls out wide
   ========================================================================== */
const STEP_BOUNDS = [0, 0.07, 0.17, 0.30, 0.42, 0.55, 0.66, 0.785, 0.90, 1.0];
const PUMP_HOUSE_ARRIVAL = [0.785, 0.795];
function computeStates(p) {
    const r = chapterRanges || {};
    const net = r.network || { start: 0.12, end: 0.42 };
    const netW = net.end - net.start;

    /* Run the incident over the page scroll itself, not only after the
       network and command chapters, so the fire is active before mid-page. */
    const RESPONSE_START = 0.075;
    const RESPONSE_END = 0.96;
    const T = clamp((p - RESPONSE_START) / (RESPONSE_END - RESPONSE_START), 0, 1);
    const B = STEP_BOUNDS;
    const win = i => ss(T, B[i], B[i] + (B[i + 1] - B[i]) * 0.55);

    state.fire = win(0);                       // 0 ignition
    state.detect = win(1);                     // 1 IR detection
    state.signal = win(2);                     // 2 signal -> panel
    state.valveOpen = win(3);                  // 3 panel -> valve
    state.coolA = win(4);                      // 4 TK-001 overhead sprinklers
    state.dikeFoam = win(4);                   // 4 foam starts with TK-001 cooling
    state.bundFill = ss(T, B[4] + 0.02, B[5]);
    state.coolB = win(5);                      // 5 TK-002 overhead sprinklers

    /* Pressure trips to 7 bar first; pumps visibly start when the camera reaches the skid. */
    const fall = ss(T, B[6], B[6] + (B[7] - B[6]) * 0.55);
    state.pumpStart = ss(p, ...PUMP_HOUSE_ARRIVAL);
    state.jockeyStart = ss(p, ...PUMP_HOUSE_ARRIVAL);
    // Hold at the trip pressure until the camera arrives at the ring gauge.
    const recovery = ss(p, 0.866, 0.905);
    state.pressure = DESIGN.P_STATIC
        + (DESIGN.P_TRIP - DESIGN.P_STATIC) * fall * (1 - recovery);

    /* 8 fire controlled — pumps and foam continue through the discharge time */
    const out = ss(T, B[8], B[8] + 0.05);
    state.fire *= (1 - out);
    state.fireOut = out;

    /* supervisory — the alarm exists only while the dike fire burns */
    state.flow = Math.max(0.22, ss(p, net.start, net.start + netW * 0.3));
    state.alarm = ss(T, B[0], B[1]);
    state.water = Math.max(state.coolA, state.coolB);
    state.steam = state.water * (0.35 + 0.65 * (1 - state.fire));
    state.siren = state.alarm * (1 - ss(T, B[8], B[8] + 0.08));
    state.allclear = ss(T, B[8] + 0.02, 1);
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
        roughness: 0.95, metalness: 0.05,
        // dark asphalt reads as a void under daylight; the light theme opens it
        // up via applySceneTheme() so the yard still reads as ground — the
        // authored value below is the DARK base, applyEnvIntensity() scales
        // from it (never cache a theme-dependent value as the base)
        color: 0xffffff,
        envMapIntensity: 0.25
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

    /* --- red fire-protection kit --------------------------------------- */
    // foam concentrate day tank + foam system valve bodies / handwheels
    matFireRed = new THREE.MeshStandardMaterial({
        color: 0xc4261c, roughness: 0.45, metalness: 0.4, envMapIntensity: 0.6
    });
    // fire-water: same weld skin as the plant pipe, tinted red so the ring
    // main and pump headers read as the FIRE loop and not as process steel
    matFireWater = matPipe.clone();
    matFireWater.color = new THREE.Color(0xff5340);
    matFireWater.roughness = 0.5;
}

/* ---------- environment (IBL) intensity — r160 compatible ----------
   three r160 has no Scene.environmentIntensity (it arrived in r163), so the
   theme's env dial is applied per material instead. Each MeshStandardMaterial
   remembers the envMapIntensity it was authored with; the active theme scales
   them all by the same factor. Called once the whole world is built (so it
   catches every material) and again on every theme switch. Idempotent. */
function applyEnvIntensity() {
    const p = SCENE_THEMES[sceneTheme];
    const scale = p.envIntensity / SCENE_THEMES.dark.envIntensity;
    scene.traverse(o => {
        const m = o.material;
        if (!m) return;
        (Array.isArray(m) ? m : [m]).forEach(mm => {
            if (!mm || !mm.isMeshStandardMaterial) return;
            if (mm.userData.envBase === undefined) {
                mm.userData.envBase = (mm.envMapIntensity === undefined || mm.envMapIntensity === null)
                    ? 1.0 : mm.envMapIntensity;
            }
            mm.envMapIntensity = mm.userData.envBase * scale;
            mm.needsUpdate = false;
        });
    });
}

/* ---------- sprays: roof cooling curtains + dike foam blanket ---------- */
function buildSprays() {
    const R = TANK.R, EAVE = TANK.H;

    /* --- one water curtain per cooling ring, falling from roof to grade --- */
    coolingRings.forEach(cr => {
        const tk = cr.tank;
        const points = buildParticles({
            count: Math.round(QUALITY.jet * 0.55), area: 0.01, heightSpread: 0.01,
            sizeMin: 5, sizeMax: 9, vert: RING_VERT, frag: RING_FRAG,
            blending: THREE.NormalBlending
        });
        const u = points.material.uniforms;
        u.uSpeed = { value: 0.30 };
        u.uRise = { value: 0.15 };
        u.uRadius = { value: R - 0.55 };
        u.uGrav = { value: -4.2 };
        u.uColor = { value: new THREE.Color(0xbfd8ff) };
        points.position.set(tk.x, EAVE + 0.54, tk.z);
        points.visible = false;
        scene.add(points);
        cr.points = points;
    });

    /* --- foam blanket filling the TK-001 dike from the low-level outlets --- */
    TANKS.filter(t => t.burning).forEach(tk => {
        const points = buildParticles({
            count: Math.round(QUALITY.jet * 0.75), area: 0.01, heightSpread: 0.01,
            sizeMin: 7, sizeMax: 13, vert: FOAM_VERT, frag: FOAM_FRAG,
            blending: THREE.NormalBlending
        });
        points.material.uniforms.uSpread = { value: TANK.DIKE / 2 - 1.9 };
        points.position.set(tk.x, 0.04, tk.z);
        points.visible = false;
        scene.add(points);
        tk.foamPoints = points;
    });
}

/* ==========================================================================
   FOAM DISPENSER — red monitor post standing just OUTSIDE the containment
   wall, its barrel angled up over the crest. The F-10x-DK branch stops at
   the wall face, so the discharge is THROWN over the 1.25 m dike wall as a
   visible ballistic arc (FOAM_JET_*) and lands in the bund annulus beside
   the shell — foam visibly entering the dike from above the wall.
   ========================================================================== */
function buildFoamDispensers() {
    const half = TANK.DIKE / 2;
    TANKS.forEach((tk, i) => {
        const wallZ = tk.z + half;                       // south wall centreline
        const postZ = wallZ + 0.55;                      // just outside the wall face
        const g = new THREE.Group();
        g.position.set(tk.x, 0, postZ);
        scene.add(g);

        // base plate + hazard plinth (shifted out so it sits flush against the wall face)
        const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.58, 0.3, 12), hazardMat);
        plinth.position.set(0, 0.15, 0.25);
        g.add(plinth);
        addAO(tk.x, postZ, 2.6, 2.6, 0.5);

        // red riser up the outside of the wall — the branch tee lands on it
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 2.2, 12), matFireRed);
        post.position.y = 1.25;
        post.castShadow = true;
        g.add(post);
        const tee = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 8, 18), matFireRed);
        tee.rotation.x = Math.PI / 2;
        tee.position.y = 1.05;                            // branch runs in at mainY
        g.add(tee);

        // Aim the monitor just inside the wall for a short, contained discharge.
        const targetX = tk.burning ? FIRE_POS.x : tk.x;
        const targetZ = tk.burning ? FIRE_POS.z : tk.z;
        const yaw = Math.atan2(targetX - tk.x, postZ - targetZ);
        const nozzlePitch = 0.20;
        const dir = V3(
            Math.sin(yaw) * Math.cos(nozzlePitch),
            Math.sin(nozzlePitch),
            -Math.cos(yaw) * Math.cos(nozzlePitch)
        );
        const top = V3(0, 2.2, 0);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 1.1, 12), matFireRed);
        barrel.position.copy(top).addScaledVector(dir, 0.55);
        barrel.quaternion.setFromUnitVectors(V3(0, 1, 0), dir);
        barrel.castShadow = true;
        g.add(barrel);
        // nozzle ring at the muzzle
        const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.035, 8, 20), matFireRed);
        muzzle.position.copy(top).addScaledVector(dir, 1.1);
        muzzle.quaternion.setFromUnitVectors(V3(0, 0, 1), dir);
        g.add(muzzle);
        // aim handwheel on the side of the head
        const wheel = buildHandwheel(0.2, matFireRed);
        wheel.position.set(0.34, 2.4, 0);
        wheel.rotation.z = Math.PI / 2;
        g.add(wheel);

        const tag = makeLabel(`FD-10${i + 1}`, '#ff6a5a');
        tag.position.set(0, 3.4, 0);
        g.add(tag);

        /* the throw itself — born at the muzzle, yawed 180 deg so local +Z
           (the jet's forward axis) points INTO the dike */
        const jet = buildParticles({
            count: Math.round(QUALITY.jet * 0.6), area: 0.01, heightSpread: 0.01,
            sizeMin: 4, sizeMax: 8, vert: FOAM_JET_VERT, frag: FOAM_JET_FRAG,
            blending: THREE.NormalBlending
        });
        jet.position.copy(top).addScaledVector(dir, 1.15);
        jet.rotation.y = Math.PI - yaw;
        jet.visible = false;
        g.add(jet);

        dispensers.push({ tank: tk, jet });
    });
}

/* ---------- per-frame updates ---------- */
const _lookDir = new THREE.Vector3(), _right = new THREE.Vector3();
const _bg = new THREE.Color();
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
        [-19.0, 3.2, -22.0], [20.0, 3.0, -3.0], [-42.0, 3.1, -6.0]
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
/* These are the BASE colours the per-frame animation lerps FROM. They are
   re-pointed by applyTheme(), so switching theme mid-session keeps every
   narrative beat (fire warmth, siren red, cooling) working unchanged. */
let _base, _warm, _cool, _bgRed;
let _hemiBase, _hemiWarm, _hemiCool, _hemiRed, _hemiGroundBase;
let _skyTopBase, _skyHorBase;
let dirLight = null, rimLight = null;

function setThemeBaseColors() {
    const p = SCENE_THEMES[sceneTheme];
    _base = new THREE.Color(p.bg);
    _warm = new THREE.Color(p.warm);
    _cool = new THREE.Color(p.cool);
    _bgRed = new THREE.Color(p.bgRed);
    _hemiBase = new THREE.Color(p.hemiSky);
    _hemiGroundBase = new THREE.Color(p.hemiGround);
    _hemiWarm = new THREE.Color(p.hemiWarm);
    _hemiCool = new THREE.Color(p.hemiCool);
    _hemiRed = new THREE.Color(p.hemiRed);
    _skyTopBase = new THREE.Color(p.skyTop);
    _skyHorBase = new THREE.Color(p.skyHorizon);
}
setThemeBaseColors();
const _skyTopRed = new THREE.Color(0x140608), _skyHorRed = new THREE.Color(0x46100c);
const _sirenRedLight = new THREE.Color(0xff2416), _sirenWhiteLight = new THREE.Color(0xfff3e4);
const _beaconWhite = new THREE.Color(0xfff0e2);
const _beaconGreen = new THREE.Color(0x35ff70);
const _cmdCyan = new THREE.Color(0x7ccfff), _cmdRed = new THREE.Color(0xff3030);
const _cmdTmp = new THREE.Color();

/* fire-protection system state colours */
const _camIdle = new THREE.Color(0x2f6f9c);     // IR camera idle field
const _camHot = new THREE.Color(0xff2a18);      // IR camera flame detection
const _signalIdle = new THREE.Color(0x55bfff);
const _camLedOk = new THREE.Color(0x35ff70);
const _camLedRed = new THREE.Color(0xff3b30);
const _panelGreen = new THREE.Color(0x1f9c52);  // panel normal / valve open-ready
const _panelAmber = new THREE.Color(0xfab95b);  // valve open / foam flowing
const _pumpOff = new THREE.Color(0x223049);

function updateScene(t) {
    if (flowTex) flowTex.offset.x = -(t * 0.45) % 1;
    if (heroPipeMat) heroPipeMat.emissiveIntensity = 0.25 + state.flow * (0.75 + 0.2 * Math.sin(t * 3.0));
    if (coreTubeMat) coreTubeMat.opacity = state.flow * 0.55;
    if (branchCoreMat) branchCoreMat.opacity = state.flow * 0.55;

    /* Main-line isolation valves stay SHUT — the ring main is charged and
       pressurised, not flowing. Nothing discharges until the panel commands
       V-101 open at step 3. This is what separates a real system from the
       old scene, where valves opened during the services section. */
    valves.forEach(v => { v.wheel.rotation.y = 0; });

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
    if (beaconMat) {
        if (sirenRed) beaconMat.color.copy(_beaconCalm).lerp(_beaconRed, flash);
        else beaconMat.color.copy(_beaconCalm).lerp(_beaconWhite, flash);
        // all-clear — calm green pulse once the emergency is resolved
        if (state.allclear > 0.001) {
            const gp = state.allclear * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 3.2)));
            beaconMat.color.lerp(_beaconGreen, gp);
        }
    }

    detectors.forEach(d => {
        d.mat.emissiveIntensity = 0.55 + 0.5 * Math.sin(t * 2.4 + d.phase);
        d.mat.emissive.copy(_cmdCyan).lerp(_cmdTmp, cmdOn * 0.9);
    });

    if (runwayMat) runwayMat.opacity = 0.55 + 0.3 * Math.sin(t * 2.2);

    // scene 3 — command protocol: the single handwheel spins up
    cmdWheels.forEach((w, i) => { w.rotation.y = t * (0.4 + cmdT * 1.9) + i * 0.8; });
    // Keep zero-intensity fire systems and lights in the scene so ignition
    // does not introduce new shader variants on the first fire frame.
    fires.forEach((f, i) => {
        // each fire flickers on its own rhythm — never a synchronized blob
        const fp = 1 + Math.sin(t * (26 + i * 7.3) + i * 2.1) * 0.06
                     + Math.sin(t * (41 + i * 5.1)) * 0.04;
        f.sys.material.uniforms.uTime.value = t + i * 3.7;
        f.sys.material.uniforms.uIntensity.value = state.fire;
        f.sys.scale.setScalar(f.base * (0.55 + 0.45 * state.fire) * fp);
    });
    // kept in range: this light lands on the foam blanket and the bundle floor,
    // so its intensity is set by how bright the FOAM may get, not the flame
    fireLight.intensity = state.fire * (6.5 + Math.sin(t * 29) * 1.9 + Math.sin(t * 47) * 1.2)
        * clamp(camera.position.distanceTo(FIRE_POS) / 18, 0.55, 1);
    poolLight.intensity = state.fire * (2.6 + Math.sin(t * 33.7) * 0.8);
    // distant glow beacon — only from afar, gone before the close-up acts
    if (fireGlowMat) {
        const d = camera.position.distanceTo(FIRE_POS);
        fireGlowMat.opacity = state.fire * 0.25 * clamp((d - 20) / 34, 0, 1);
    }

    smokeSys.material.uniforms.uTime.value = t;
    smokeSys.material.uniforms.uIntensity.value = state.fire * 0.9;
    steamSys.material.uniforms.uTime.value = t;
    steamSys.material.uniforms.uIntensity.value = state.steam;
    steamSys.visible = state.steam > 0.01;

    /* pilot + flare-stack light removed — guard so nothing ticks a dead system */
    if (pilotSys) {
        pilotSys.material.uniforms.uTime.value = t;
        pilotSys.material.uniforms.uIntensity.value = 0.55 + 0.1 * Math.sin(t * 11) + 0.06 * Math.sin(t * 23);
    }
    if (flareLight && flareLight.visible) {
        flareLight.intensity = 16 + Math.sin(t * 13) * 5 + Math.sin(t * 5.1) * 3;
    }

    /* ---------- 9-STEP PROCESS DRIVER ---------- */

    /* step 1 — IR cameras: dim cyan surveillance field -> red on detection */
    irCameras.forEach(c => {
        const hot = c.tank.burning
            ? state.detect * (1 - state.valveOpen) * (1 - state.coolA)
            : 0;
        const idle = 0.008 + 0.004 * Math.sin(t * 1.7);
        c.coneMat.opacity = idle + hot * (0.5 - idle);
        c.coneMat.color.copy(_camIdle).lerp(_camHot, hot);
        c.lensMat.color.copy(_camIdle).lerp(_camHot, hot);
        c.ledMat.color.copy(_camLedOk).lerp(_camLedRed, hot);
    });

    /* step 2 — each active camera sends its alarm pulse to the fire panel */
    signalTraces.forEach(tr => {
        const act = tr.tank.burning && tr.index === 0
            ? state.signal * (1 - state.coolA)
            : 0;
        tr.mat.color.copy(_signalIdle).lerp(_camHot, act);
        tr.mat.opacity = 0.4 + act * 0.5;
        if (act > 0.01) {
            const u = clamp(
                (state.p - SIGNAL_TRAVEL_START) / (SIGNAL_TRAVEL_END - SIGNAL_TRAVEL_START),
                0, 1
            );
            tr.pulse.position.copy(tr.curve.getPointAt(u));
            tr.pulseMat.opacity = act * (0.35 + 0.65 * Math.sin(Math.PI * u));
        } else {
            tr.pulseMat.opacity = 0;
        }
    });

    /* step 3 — fire-panel alarm; V-101 deluge actuator and position lamp */
    panelLamps.forEach(l => {
        if (l.beacon) {
            l.mat.color.copy(state.allclear > 0.5 ? _panelGreen : _camLedRed);
            l.mat.color.multiplyScalar(state.allclear > 0.5
                ? 0.4 + 0.3 * Math.sin(t * 3.2)
                : 0.25 + 0.85 * state.alarm * (0.55 + 0.45 * Math.sin(t * 8.2)));
        } else {
            const hot = l.tank.burning ? Math.max(state.detect, state.alarm) : 0;
            l.mat.color.copy(_panelGreen).lerp(_camLedRed, hot);
        }
    });
    processValves.forEach(v => {
        if (v.standby) {
            /* foam chamber isolation valves stay CLOSED — correct for a dike fire */
            v.indicator.color.copy(_camLedRed);
            return;
        }
        const open = state.valveOpen;
        v.indicator.color.copy(_panelGreen).lerp(_panelAmber, open);
        if (v.wheel) v.wheel.rotation.y = open * Math.PI * 1.5;
        if (v.actuator) v.actuator.position.y = 0.42 + open * 0.12;
    });

    /* step 5 — dike low-level foam outlets + bund blanket build-up */
    TANKS.forEach(tk => {
        if (!tk.foamPoints) return;
        const amt = tk.burning ? state.dikeFoam : 0;
        const u = tk.foamPoints.material.uniforms;
        u.uTime.value = t;
        u.uIntensity.value = amt * (0.45 + 0.55 * state.bundFill);
        tk.foamPoints.visible = amt > 0.01;
    });
    /* foam dispensers — a short low-flow pour beside the monitor */
    dispensers.forEach(d => {
        const amt = d.tank.burning ? state.dikeFoam : 0;
        const u = d.jet.material.uniforms;
        u.uTime.value = t;
        u.uIntensity.value = amt;
        d.jet.visible = amt > 0.01;
    });
    bundFoam.forEach(bf => {
        const amt = bf.tank.burning ? state.bundFill : 0;
        bf.mesh.visible = amt > 0.02;
        if (bf.mesh.visible) {
            // deliberately below opaque: on top of the foam particles and the
            // splash disc this stacks in the same few square metres, and a
            // solid white sheet is what saturated the bloom into a blob
            bf.mat.opacity = 0.62 * amt;
            // spreads outward from the shell across the dike floor
            bf.mesh.scale.setScalar(0.55 + 0.45 * amt);
        }
    });
    if (splashDisc) {
        const g = state.bundFill;
        splashDisc.visible = g > 0.02;
        splashDisc.material.opacity = g * 0.36;
        splashDisc.scale.setScalar(1.2 + 5.6 * g + 0.05 * Math.sin(t * 3.1));
        splashRing.visible = g > 0.02;
        splashRing.material.opacity = g * (0.18 + 0.06 * Math.sin(t * 4.3));
        splashRing.scale.setScalar(1.2 + 5.6 * g);
    }

    /* step 4 — roof cooling ring curtains (TK-001 8.1, TK-002 4.1 L/min/m2) */
    coolingRings.forEach(cr => {
        const amt = cr.tank.burning ? state.coolA : state.coolB;
        const u = cr.points.material.uniforms;
        u.uTime.value = t;
        u.uIntensity.value = amt;
        cr.points.visible = amt > 0.01;
    });

    /* step 7 — fire pumps start after the pressure gauge reaches 7 bar */
    pumpUnits.forEach(p => {
        const spinning = p.primary ? state.pumpStart : state.jockeyStart;
        p.rotor.rotation[p.rotationAxis || 'x'] += spinning * (p.primary ? 9 : 17) / 60;
        p.lampMat.color.copy(_pumpOff).lerp(_camLedRed, spinning > 0.3 ? 1 : 0);
    });
    if (pumpDischargeFlow) {
        pumpDischargeFlow.material.opacity = state.pumpStart * 0.55;
        pumpFlowPulses.forEach((pulse, i) => {
            const active = state.pumpStart > 0.03;
            pulse.visible = active;
            pulse.material.opacity = state.pumpStart * 0.95;
            if (active) {
                pulse.position.copy(pumpDischargeFlow.curve.getPointAt(
                    (t * 0.32 + i / pumpFlowPulses.length) % 1
                ));
            }
        });
    }
    gauges.forEach(g => {
        // Match the dial graduations so the needle drops visibly with pressure.
        g.pivot.rotation.z = THREE.MathUtils.degToRad(gaugeAngleDeg(state.pressure)) - Math.PI / 2;
    });

    const res = (chapterRanges && chapterRanges.resolution) || { start: 0.9, end: 1 };
    const resW = res.end - res.start;
    const cool = ss(state.p, res.start + resW * 0.15, res.start + resW * 0.7);
    _bg.copy(_base).lerp(_warm, state.fire * 0.85).lerp(_cool, cool)
        .lerp(_bgRed, state.siren * (0.22 + 0.25 * state.strobe));
    scene.background.copy(_bg);
    scene.fog.color.copy(_bg);
    scene.fog.density = SCENE_THEMES[sceneTheme].fogDensity + state.fire * 0.001;
    hemiLight.color.copy(_hemiBase).lerp(_hemiWarm, state.fire * 0.6).lerp(_hemiCool, cool * 0.5)
        .lerp(_hemiRed, state.siren * (0.15 + 0.25 * state.strobe));
    hemiLight.intensity = SCENE_THEMES[sceneTheme].hemiBase + state.fire * 0.25;
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

    // flare tip sprite removed with the stack — keep it parked at zero
    if (flareSpriteMat) {
        flareSpriteMat.opacity = 0;
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
    // Keep alarm motion subtle so camera poles, panel indicators, and gauges
    // remain easy to follow while the camera is moving.
    if (state.alarm > 0.01 && !reducedMotion) {
        const s = state.alarm * 0.006;
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
    document.body.classList.toggle('signal-camera-active', state.p >= SIGNAL_TRAVEL_START && state.p <= SIGNAL_TRAVEL_END);
    document.body.classList.toggle('valve-camera-active', state.p >= 0.35 && state.p < 0.425);
    document.body.classList.toggle('foam-camera-active', state.p >= 0.435 && state.p < 0.535);
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
    // bloom stays restrained — glow, never whiteout; with the higher threshold
    // only fire and lamps clear it, so the fire term can carry more of the look
    if (bloomPass) {
        const dFire = camera.position.distanceTo(FIRE_POS);
        bloomPass.strength = 0.30 + state.fire * 0.22 * clamp(dFire / 26, 0.55, 1);
    }
    // exposure is theme-driven — this used to pin it to a flat 1.0 every frame,
    // which silently overrode both the init value and any theme palette
    renderer.toneMappingExposure = SCENE_THEMES[sceneTheme].exposure;
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
    console.error('[safyron3d] 3D scene initialization failed:', err && err.message ? err.message : err);
    window.dispatchEvent(new CustomEvent('safyron:error'));
}

function init() {
    if (!webglAvailable()) { fail(new Error('WebGL unavailable')); return; }
    try {
        initRenderer();
        initMaterials();
        initEnvironment();
        buildTanks();
        buildDike();
        buildFoamNetwork();
        buildIRCameras();
        buildControlPanel();
        buildPumpHouse();
        buildFlareStack();
        buildSirenSystem();
        buildFireAndWater();
        buildSprays();
        buildFoamDispensers();
        measureChapters();
        buildCameraRig();
        sampleRig(0);
        camera.position.copy(_camP);
        camera.lookAt(_lookP);
        // every material is authored with its DARK value — apply the active
        // theme once so the first frame is right when booting light
        applySceneTheme(sceneTheme);
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

        /* Debug handle for the verification harness in tools/.
           verify-tanks.cjs asserts tank/dike concentricity and IR sensor placement
           against this graph, so keep it in sync when objects are renamed. */
        window.__dbg = { THREE, scene, camera, renderer, composer, bloomPass, filmPass, state,
            heroPipeMat, coreTubeMat, branchCoreMat, matGround, matTank, matPipe, matStructure,
            splashDisc, splashRing, bundFoam, fires, TANKS, coolingRings,
            dispensers, gauges, processValves, pumpUnits, irCameras,
            rig, chapterRanges, SCENE_THEMES, applySceneTheme,
            get sceneTheme() { return sceneTheme; },
            smokeSys, steamSys, pilotSys, fireLight, poolLight, flareLight };
        tick();
    } catch (err) {
        fail(err);
    }
}
    /* --------------------------------------------------------------------------
   applyTheme — swap the live scene palette when the user flips the toggle.

   Only the BASE state is touched. The per-frame update in updateScene() keeps
   lerping from these bases, so fire warmth / siren red / cooling still animate
   exactly as before — we just changed where they start from.
   -------------------------------------------------------------------------- */
function applySceneTheme(theme) {
    if (!SCENE_THEMES[theme]) return;
    sceneTheme = theme;
    const p = SCENE_THEMES[theme];

    setThemeBaseColors();

    // background + fog are re-derived every frame from _base, so they follow
    // automatically; fog density is not, so set it here
    scene.fog.density = p.fogDensity + state.fire * 0.001;

    if (hemiLight) {
        hemiLight.groundColor.copy(_hemiGroundBase);
    }
    if (dirLight) {
        dirLight.color.setHex(p.dir);
        dirLight.intensity = p.dirIntensity;
        // the shadow map is baked once (autoUpdate = false) and only depends on
        // the light's POSITION, which the theme doesn't move — no rebake needed
    }
    if (rimLight) {
        rimLight.color.setHex(p.rim);
        rimLight.intensity = p.rimIntensity;
    }
    if (skyMat) {
        skyMat.uniforms.topColor.value.copy(_skyTopBase);
        skyMat.uniforms.horizonColor.value.copy(_skyHorBase);
    }
    if (starPoints) starPoints.visible = p.stars;
    if (grid) {
        grid.material.color.setHex(theme === 'light' ? 0x7d99bd : 0x24457e);
        grid.material.opacity = theme === 'light' ? 0.22 : 0.3;
    }
    if (renderer) renderer.toneMappingExposure = p.exposure;
    // RoomEnvironment drives the PBR ambient term — three r160 has no
    // Scene.environmentIntensity, so dial each material's contribution with
    // the theme so daylight materials don't read as night-lit. Runs BEFORE
    // the ground override below, so the override is the final word and the
    // cached envBase stays correct for the next toggle.
    if (scene.environment) applyEnvIntensity();
    // ground albedo follows the theme — set at build time, so keep it in sync
    if (matGround) {
        matGround.color.setHex(theme === 'light' ? 0xb6bcc6 : 0xffffff);
        matGround.envMapIntensity = theme === 'light' ? 0.5 : 0.25;
    }
}

// the DOM layer dispatches this; register before init() so an early toggle
// (or a restored preference) is never missed
window.addEventListener('safyron:theme', function (e) {
    if (e && e.detail && e.detail.theme) applySceneTheme(e.detail.theme);
});

init();
