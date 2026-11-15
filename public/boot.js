/* apply the saved page colour and text size before anything draws (white unless the visitor chose black) */
try { document.documentElement.dataset.theme = localStorage.getItem('loom-theme') === 'dark' ? 'dark' : 'light'; } catch (e) { document.documentElement.dataset.theme = 'light'; }
try { var t = localStorage.getItem('loom-text'); document.documentElement.style.setProperty('--ts', t === 'small' ? '0.85' : t === 'large' ? '1.25' : '1'); } catch (e) {}
