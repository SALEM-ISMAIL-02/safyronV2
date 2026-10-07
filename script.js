/* Safyron Engineering — UI layer: navigation, captions, HUD, loader, and fallback */
(function () {
    'use strict';

    var siteHeader = document.querySelector('.site-header');
    var navToggle = document.querySelector('.nav-toggle');
    var navLinks = document.querySelectorAll('#mainNav a, #mainNav button');
    var languageButtons = document.querySelectorAll('[data-language]');
    var MOBILE_NAV_BREAKPOINT = 960;

    /* ---------- language (English / French) ---------- */
    var LANGUAGE_KEY = 'safyron-language';
    var currentLanguage = 'en';
    try {
        currentLanguage = localStorage.getItem(LANGUAGE_KEY) === 'fr' ? 'fr' : 'en';
    } catch (e) {
        currentLanguage = 'en';
    }

    function applyLanguage(language, persist) {
        currentLanguage = language === 'fr' ? 'fr' : 'en';
        document.documentElement.lang = currentLanguage;
        document.querySelectorAll('[data-en][data-fr]').forEach(function (element) {
            element.textContent = element.getAttribute('data-' + currentLanguage);
        });
        document.querySelectorAll('[data-en-placeholder][data-fr-placeholder]').forEach(function (element) {
            element.setAttribute('placeholder', element.getAttribute('data-' + currentLanguage + '-placeholder'));
        });
        languageButtons.forEach(function (button) {
            var selected = button.getAttribute('data-language') === currentLanguage;
            button.setAttribute('aria-pressed', String(selected));
        });
        var languageGroup = document.querySelector('.language-toggle');
        if (languageGroup) {
            languageGroup.setAttribute('aria-label', currentLanguage === 'fr' ? 'Choisir la langue' : 'Choose language');
        }
        document.title = currentLanguage === 'fr'
            ? 'Safyron Engineering | Sécurité des procédés et protection incendie'
            : 'Safyron Engineering | Process Safety & Fire Protection';
        var bookingClose = document.querySelector('.booking-close');
        if (bookingClose) {
            var closeLabel = bookingClose.getAttribute('data-' + currentLanguage + '-label');
            bookingClose.setAttribute('aria-label', closeLabel);
            bookingClose.setAttribute('title', closeLabel);
        }
        if (themeToggle) {
            var themeLabel = currentLanguage === 'fr'
                ? (currentTheme() === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre')
                : (currentTheme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
            themeToggle.setAttribute('aria-label', themeLabel);
            themeToggle.setAttribute('title', themeLabel);
        }
        if (navToggle) {
            var navIsOpen = navToggle.getAttribute('aria-expanded') === 'true';
            navToggle.setAttribute('aria-label', currentLanguage === 'fr'
                ? (navIsOpen ? 'Fermer le menu' : 'Ouvrir le menu')
                : (navIsOpen ? 'Close navigation menu' : 'Open navigation menu'));
        }
        if (persist) {
            try { localStorage.setItem(LANGUAGE_KEY, currentLanguage); } catch (e) { /* private mode */ }
        }
        window.dispatchEvent(new CustomEvent('safyron:language', { detail: { language: currentLanguage } }));
    }

    languageButtons.forEach(function (button) {
        button.addEventListener('click', function () {
            applyLanguage(button.getAttribute('data-language'), true);
        });
    });
    applyLanguage(currentLanguage, false);

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
        var label = currentLanguage === 'fr'
            ? (toLight ? 'Passer en mode clair' : 'Passer en mode sombre')
            : (toLight ? 'Switch to light mode' : 'Switch to dark mode');
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
        navToggle.setAttribute('aria-label', currentLanguage === 'fr'
            ? (isOpen ? 'Fermer le menu' : 'Ouvrir le menu')
            : (isOpen ? 'Close navigation menu' : 'Open navigation menu'));
    }
    navToggle.addEventListener('click', function () {
        setMobileNavState(navToggle.getAttribute('aria-expanded') !== 'true');
    });
    navLinks.forEach(function (link) {
        link.addEventListener('click', function () {
            if (window.innerWidth <= MOBILE_NAV_BREAKPOINT) setMobileNavState(false);
        });
    });
    document.addEventListener('click', function (event) {
        if (
            window.innerWidth <= MOBILE_NAV_BREAKPOINT &&
            siteHeader.classList.contains('nav-open') &&
            !siteHeader.contains(event.target)
        ) setMobileNavState(false);
    });
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') setMobileNavState(false);
    });
    window.addEventListener('resize', function () {
        if (window.innerWidth > MOBILE_NAV_BREAKPOINT) setMobileNavState(false);
    });

    /* ---------- HUD ---------- */
    var ACT_TITLES = {
        en: ['Overview', 'Detection & control', 'Valve & foam', 'Tank response', 'Fire pumps', 'All clear'],
        fr: ['Vue d’ensemble', 'Détection & commande', 'Vannes & mousse', 'Protection des bacs', 'Pompes incendie', 'Fin d’intervention']
    };
    var hudDots = document.querySelectorAll('#hudRail .hud-dot');
    var hudIndex = document.getElementById('hudIndex');
    var hudTitle = document.getElementById('hudTitle');
    var activeActIndex = 0;
    window.addEventListener('safyron:act', function (e) {
        activeActIndex = e.detail.index;
        hudDots.forEach(function (dot, k) { dot.classList.toggle('is-active', k === activeActIndex); });
        hudIndex.textContent = String(activeActIndex + 1).padStart(2, '0') + ' / 06';
        hudTitle.textContent = ACT_TITLES[currentLanguage][activeActIndex] || '';
    });
    window.addEventListener('safyron:language', function () {
        hudTitle.textContent = ACT_TITLES[currentLanguage][activeActIndex] || '';
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
        loaderText.textContent = currentLanguage === 'fr' ? 'Système de protection opérationnel' : 'Protection grid online';
        setTimeout(function () { loader.classList.add('done'); }, 350);
    }
    window.addEventListener('safyron:ready', finishLoader);
    setTimeout(function () { if (!loaderDone) loaderBar.style.width = '72%'; }, 400);

    function showSceneError() {
        loaderText.textContent = currentLanguage === 'fr'
            ? 'Scène 3D indisponible. Vérifiez WebGL puis rechargez la page.'
            : '3D scene unavailable. Check WebGL support and reload.';
        loaderBar.style.width = '100%';
        loaderBar.style.background = 'var(--danger-ink)';
    }
    window.addEventListener('safyron:error', showSceneError);
    document.addEventListener('error', function (event) {
        if (event.target instanceof HTMLScriptElement && event.target.type === 'module') {
            showSceneError();
        }
    }, true);

    /* ---------- booking preview ---------- */
    var bookingDialog = document.getElementById('bookingDialog');
    var bookingForm = document.getElementById('bookingForm');
    var bookingDate = document.getElementById('bookingDate');
    var bookingFeedback = document.getElementById('bookingFeedback');
    var today = new Date();
    if (bookingDate) {
        bookingDate.min = [
            today.getFullYear(),
            String(today.getMonth() + 1).padStart(2, '0'),
            String(today.getDate()).padStart(2, '0')
        ].join('-');
    }
    document.querySelectorAll('.booking-trigger').forEach(function (button) {
        button.addEventListener('click', function () {
            bookingFeedback.textContent = '';
            bookingDialog.showModal();
        });
    });
    document.querySelector('.booking-close').addEventListener('click', function () {
        bookingDialog.close();
    });
    bookingDialog.addEventListener('click', function (event) {
        if (event.target === bookingDialog) bookingDialog.close();
    });
    bookingForm.addEventListener('submit', function (event) {
        event.preventDefault();
        bookingFeedback.textContent = currentLanguage === 'fr'
            ? 'Prévisualisation uniquement : votre sélection n’est pas envoyée et aucun rendez-vous n’est réservé.'
            : 'Preview only: your selection is not submitted and no meeting has been booked.';
    });
})();
