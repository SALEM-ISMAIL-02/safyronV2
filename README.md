# Safyron Engineering

Marketing site for Safyron Engineering — an industrial process-safety and fire
protection consultancy. The hero experience is a scroll-driven 3D tank-farm
scenario (dike fire → opposing IR detection → fire alarm panel → deluge
valve → overhead cooling and dike foam → 7 bar pump start → all-clear)
built with [three.js](https://threejs.org/).

The open-sided fire-pump skid shows two diesel-driven centrifugal pumps, an
electric main pump, and a separate vertical multistage jockey pump. Shared
suction and discharge manifolds connect the pump branches; the discharge ties
into the site ring main, with a shared diesel day tank and visible driver
details. This is a visual concept model, not a fabrication drawing.

## Layout

```
index.html      page structure and all copy
styles.css      design system, layout, responsive rules
scene3d.js      three.js scene: tanks, piping, foam system, camera rig, scroll timeline
script.js       DOM layer: nav, loader, HUD, telemetry, sequence list
logo.png        brand mark
tools/          local dev + verification scripts (see below)
```

The site is plain static files with **no build step or npm dependencies**.
Three.js is loaded from a CDN via an import map, so the site needs a network
connection on first load.

## Run locally

ES modules can't be loaded over `file://`, so serve the folder:

```bash
node tools/serve.cjs          # → http://127.0.0.1:8731/
node tools/serve.cjs 3000     # custom port
```

## Tools

Screenshots and geometry assertions drive a headless browser over the Chrome
DevTools Protocol. Start Edge/Chrome with remote debugging first:

```bash
msedge --remote-debugging-port=9222
```

| Script | Purpose |
|---|---|
| `tools/serve.cjs` | Static dev server with no caching. |
| `tools/shot.cjs` | Scroll to a position in an act and capture a PNG. |
| `tools/verify-tanks.cjs` | Asserts tank/dike concentricity and IR sensor placement. |

```bash
node tools/verify-tanks.cjs http://127.0.0.1:8731/ out.png incident 0.3
```

`verify-tanks.cjs` exits non-zero on failure, so it can be used as a check.
Set `HIDE_PANEL=1` to hide the DOM caption card when capturing, so it doesn't
occlude the 3D scene.

## How the 3D scene is verified

`scene3d.js` publishes `window.__dbg` — a handle on the scene graph, used by
`tools/verify-tanks.cjs` to read real world-space positions. If objects are
renamed or restructured, update that handle or the assertions will silently
stop finding their targets.

## Light / dark theme

The site ships with a light mode. The sun/moon button in the header toggles it;
the choice is saved in `localStorage` and applied **before first paint** by a
small inline script in `<head>`, so there is no flash of the wrong background.

- **Default** follows `prefers-color-scheme`, and keeps following it until the
  visitor picks a theme explicitly.
- **CSS**: `styles.css` declares ~92 semantic tokens (`--bg`, `--text`,
  `--glass`, `--accent`, `--data`, …) in `:root`. The light palette is a single
  `[data-theme="light"]` block that only overrides token *values* — no rule
  knows which theme is active. **Use tokens, never raw hex/rgba**, or the light
  theme will silently miss that element.
- **3D canvas**: three.js colours can't come from CSS, so `scene3d.js` keeps a
  parallel `SCENE_THEMES` palette (background, fog, hemisphere/key/rim lights,
  sky dome, stars, exposure). `script.js` dispatches a `safyron:theme`
  `CustomEvent` and `applySceneTheme()` swaps the live values; the per-frame
  animation still lerps from those bases, so fire/siren/cooling beats are
  unchanged.
- Light mode is a **daylight** reading of the same scene: brighter ambient
  (`hemiBase` 0.55 → 1.35), a warm key light, the starfield switched off, and a
  lighter asphalt so the yard doesn't read as a void.

When adding new themed styles, add the token to **both** `:root` and
`[data-theme="light"]`, then confirm nothing still hardcodes a colour.

## Notes

- The scenario follows the 9-step causal chain documented at the top of
  `scene3d.js`; scroll position drives one smooth camera sequence.