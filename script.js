/* Safyron Engineering — UI layer: nav, captions, HUD, loader, newsletter, 2D fallback */
(function () {
    'use strict';

    var body = document.body;
    var siteHeader = document.querySelector('.site-header');
    var navToggle = document.querySelector('.nav-toggle');
    var navLinks = document.querySelectorAll('.nav a');

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

    /* ---------- 2D fallback (no WebGL / module failure / context loss) ---------- */
    var legacyRunning = false;
    function enableLegacy() {
        if (legacyRunning) return;
        legacyRunning = true;
        finishLoader();
        body.classList.add('no-webgl');
        startLegacyPipeline();
    }
    window.addEventListener('safyron:error', enableLegacy);
    setTimeout(function () { if (!loaderDone) enableLegacy(); }, 9000);

    function startLegacyPipeline() {
        var flowPath = document.getElementById('pipeFlow');
        var pipelineNodes = document.querySelectorAll('.pipeline-node');
        var fireScene = document.getElementById('fireScene');
        var sprinklerHead = document.getElementById('sprinklerHead');
        if (!flowPath) return;
        var length = flowPath.getTotalLength();
        flowPath.style.strokeDasharray = '0 ' + length;

        function updateScrollFlow() {
            var maxScroll = document.documentElement.scrollHeight - window.innerHeight;
            var progress = maxScroll > 0 ? window.scrollY / maxScroll : 0;
            flowPath.style.strokeDasharray = (Math.max(8, length * progress)) + ' ' + length;
            pipelineNodes.forEach(function (node, index) {
                var trigger = (index + 1) / (pipelineNodes.length + 1);
                node.classList.toggle('live', progress >= trigger);
            });
            sprinklerHead.classList.toggle('active', progress >= 0.97);
            fireScene.classList.toggle('extinguished', progress >= 0.97);
        }
        updateScrollFlow();
        window.addEventListener('scroll', updateScrollFlow, { passive: true });
        window.addEventListener('resize', updateScrollFlow);
    }

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


