/* Safyron Engineering — UI layer: nav, captions, HUD, loader, newsletter, 2D fallback */
(function () {
    'use strict';

    var body = document.body;
    var siteHeader = document.querySelector('.site-header');
    var navToggle = document.querySelector('.nav-toggle');
    var navLinks = document.querySelectorAll('.nav a');

    /* ---------- theme (dark / light) ----------
       The <html data-theme> attribute is the single source of truth; CSS does all
       the work. This block only flips the attribute, persists the choice, and
       notifies the 3D scene (which owns its own palette) via a CustomEvent. */
    var THEME_KEY = 'safyron-theme';
    var root = document.documentElement;
    var themeToggle = document.getElementById('themeToggle');
    var systemLight = window.matchMedia('(prefers-color-scheme: light)');

    function currentTheme() {
        return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    }

    function syncToggle(theme) {
        if (!themeToggle) return;
        var toLight = theme === 'dark';
        themeToggle.setAttribute('aria-pressed', String(theme === 'light'));
        var label = toLight ? 'Switch to light mode' : 'Switch to dark mode';
        themeToggle.setAttribute('aria-label', label);
        themeToggle.setAttribute('title', label);
    }

    function applyTheme(theme, persist) {
        root.setAttribute('data-theme', theme);
        syncToggle(theme);
        var meta = document.getElementById('themeColorMeta');
        if (meta) meta.setAttribute('content', theme === 'light' ? '#eef2f8' : '#050b16');
        if (persist) {
            try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* private mode */ }
        }
        // the 3D canvas keeps its own colour pipeline and listens for this
        window.dispatchEvent(new CustomEvent('safyron:theme', { detail: { theme: theme } }));
    }

    // the inline <head> script already set the attribute before first paint —
    // just bring the button's label in line with it
    syncToggle(currentTheme());

    if (themeToggle) {
        themeToggle.addEventListener('click', function () {
            applyTheme(currentTheme() === 'light' ? 'dark' : 'light', true);
        });
    }

    // follow the OS only while the visitor hasn't made an explicit choice
    var onSystemChange = function (e) {
        var saved = null;
        try { saved = localStorage.getItem(THEME_KEY); } catch (err) { /* ignore */ }
        if (!saved) applyTheme(e.matches ? 'light' : 'dark', false);
    };
    if (systemLight.addEventListener) systemLight.addEventListener('change', onSystemChange);
    else if (systemLight.addListener) systemLight.addListener(onSystemChange);

    /* ---------- mobile nav ---------- */
    function setMobileNavState(isOpen) {
        siteHeader.classList.toggle('nav-open', isOpen);
        navToggle.setAttribute('aria-expanded', String(isOpen));
        navToggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
    }
    navToggle.addEventListener('click', function () {
        setMobileNavState(navToggle.getAttribute('aria-expanded') !== 'true');
    });
    navLinks.forEach(function (link) {
        link.addEventListener('click', function () {
            if (window.innerWidth <= 860) setMobileNavState(false);
        });
    });
    document.addEventListener('click', function (event) {
        if (
            window.innerWidth <= 860 &&
            siteHeader.classList.contains('nav-open') &&
            !siteHeader.contains(event.target)
        ) setMobileNavState(false);
    });
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') setMobileNavState(false);
    });
    window.addEventListener('resize', function () {
        if (window.innerWidth > 860) setMobileNavState(false);
    });

    /* ---------- caption reveal per act (reversible, follows the 3D timeline) ---------- */
    var acts = document.querySelectorAll('.act');
    var captionObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            var caption = entry.target.querySelector('.caption');
            if (caption) caption.classList.toggle('is-active', entry.isIntersecting);
        });
    }, { threshold: 0.28 });
    acts.forEach(function (act) { captionObserver.observe(act); });

    /* ---------- HUD ---------- */
    var ACT_TITLES = ['Overview', 'Service Network', 'Command', 'Incident', 'Suppression', 'Resolution'];
    var hudDots = document.querySelectorAll('#hudRail .hud-dot');
    var hudIndex = document.getElementById('hudIndex');
    var hudTitle = document.getElementById('hudTitle');
    window.addEventListener('safyron:act', function (e) {
        var i = e.detail.index;
        hudDots.forEach(function (dot, k) { dot.classList.toggle('is-active', k === i); });
        hudIndex.textContent = String(i + 1).padStart(2, '0') + ' / 06';
        hudTitle.textContent = ACT_TITLES[i] || '';
    });

    /* ---------- network service steps ---------- */
    var steps = document.querySelectorAll('#networkSteps .step');
    var progressBar = document.getElementById('networkProgressBar');
    var currentStep = -1;
    window.addEventListener('safyron:network', function (e) {
        if (e.detail.index !== currentStep) {
            currentStep = e.detail.index;
            steps.forEach(function (s, k) { s.classList.toggle('is-active', k === currentStep); });
        }
        progressBar.style.transform = 'scaleX(' + e.detail.t.toFixed(3) + ')';
    });
    if (steps.length) { currentStep = 0; steps[0].classList.add('is-active'); }

    /* ---------- 9-step dike-fire sequence + live telemetry ---------- */
    var seqItems = document.querySelectorAll('#seqList li');
    window.addEventListener('safyron:step', function (e) {
        var i = e.detail.index;
        seqItems.forEach(function (li, k) {
            li.classList.toggle('is-active', k === i);
            li.classList.toggle('is-done', k < i);
        });
    });

    var telPressure = document.getElementById('telPressure');
    var telPressureBar = document.getElementById('telPressureBar');
    var telFoam = document.getElementById('telFoam');
    var telCoolA = document.getElementById('telCoolA');
    var telCoolB = document.getElementById('telCoolB');
    var telTotal = document.getElementById('telTotal');
    var telSolution = document.getElementById('telSolution');
    var telConc = document.getElementById('telConc');
    var telPump = document.getElementById('telPump');
    var telValve = document.getElementById('telValve');
    var telemetry = document.getElementById('telemetry');

    function fmt(v, d) { return v.toFixed(d === undefined ? 0 : d); }

    window.addEventListener('safyron:tel', function (e) {
        var d = e.detail;
        if (!telPressure) return;
        telemetry.classList.toggle('is-live', d.active);
        telPressure.textContent = fmt(d.pressure, 1) + ' bar';
        // bar fills against the 10 bar static, 7 bar trip marked on the scale
        telPressureBar.style.width = Math.max(0, Math.min(100, (d.pressure / 10) * 100)) + '%';
        telPressureBar.classList.toggle('is-low', d.pressure < 7.6);
        telFoam.textContent = fmt(d.foam) + ' L/min';
        telCoolA.textContent = fmt(d.coolA) + ' L/min';
        telCoolB.textContent = fmt(d.coolB) + ' L/min';
        telTotal.textContent = fmt(d.total, 1) + ' m³/h';
        telSolution.textContent = fmt(d.solution / 1000, 1) + ' m³';
        telConc.textContent = fmt(d.concentrate) + ' L';

        telPump.textContent = d.pump > 0.5 ? 'PUMPS — RUNNING' : 'PUMPS — STANDBY';
        telPump.classList.toggle('is-run', d.pump > 0.5);
        telValve.textContent = d.valve > 0.5 ? 'V-101 — OPEN' : 'V-101 — CLOSED';
        telValve.classList.toggle('is-run', d.valve > 0.5);
    });

    /* ---------- loader ---------- */
    var loader = document.getElementById('loader');
    var loaderBar = document.getElementById('loaderBar');
    var loaderText = document.getElementById('loaderText');
    var loaderDone = false;
    function finishLoader() {
        if (loaderDone) return;
        loaderDone = true;
        loaderBar.style.width = '100%';
        loaderText.textContent = 'Protection grid online';
        setTimeout(function () { loader.classList.add('done'); }, 350);
    }
    window.addEventListener('safyron:ready', finishLoader);
    setTimeout(function () { if (!loaderDone) loaderBar.style.width = '72%'; }, 400);

    function showSceneError() {
        loaderText.textContent = '3D scene unavailable. Check WebGL support and reload.';
        loaderBar.style.width = '100%';
        loaderBar.style.background = 'var(--danger-ink)';
    }
    window.addEventListener('safyron:error', showSceneError);
    document.addEventListener('error', function (event) {
        if (event.target instanceof HTMLScriptElement && event.target.type === 'module') {
            showSceneError();
        }
    }, true);

    /* ---------- newsletter ---------- */
    var newsletterForm = document.getElementById('newsletterForm');
    var newsletterNote = document.getElementById('newsletterNote');
    if (newsletterForm) {
        newsletterForm.addEventListener('submit', function (event) {
            event.preventDefault();
            newsletterNote.textContent = 'Demo captured. A backend or email tool can be connected later.';
        });
    }
})();
