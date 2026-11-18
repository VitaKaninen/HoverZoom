// Live-site harness: GM stand-ins on localStorage ('hzgm:' keys), counted GM_xhr via fetch, saves recorded; then the script.
(function () {
  if (window.__hzHarness) return;
  window.__hzHarness = true;
  var P = 'hzgm:';
  window.GM_getValue = function (k, d) { var v = localStorage.getItem(P + k); return v === null ? d : JSON.parse(v); };
  window.GM_setValue = function (k, v) { localStorage.setItem(P + k, JSON.stringify(v)); };
  window.GM_deleteValue = function (k) { localStorage.removeItem(P + k); };
  window.GM_listValues = function () { return Object.keys(localStorage).filter(function (k) { return k.indexOf(P) === 0; }).map(function (k) { return k.slice(P.length); }); };
  window.GM_addValueChangeListener = function () { return 0; };
  window.GM_registerMenuCommand = function () { return 'x'; };
  window.GM_unregisterMenuCommand = function () {};
  window.GM_info = { script: { version: 'harness' } };
  window.__xhr = [];
  window.GM_xmlhttpRequest = function (o) {
    var h = o.headers || {}, rec = { url: o.url, range: h.Range || h.range || '', t: Math.round(performance.now()), st: 0 };
    window.__xhr.push(rec);
    fetch(o.url, { method: o.method || 'GET', headers: h, credentials: 'include' }).then(function (r) {
      rec.st = r.status;
      var hs = ''; r.headers.forEach(function (v, k) { hs += k + ': ' + v + '\r\n'; });
      var body = o.responseType === 'blob' ? r.blob() : o.responseType === 'arraybuffer' ? r.arrayBuffer() : r.text();
      return body.then(function (b) {
        if (o.onload) o.onload({ status: r.status, statusText: r.statusText, responseHeaders: hs, finalUrl: r.url, response: b, responseText: typeof b === 'string' ? b : '' });
      });
    }, function (e) { rec.st = 'err'; if (o.onerror) o.onerror({ error: String(e) }); });
    return { abort: function () {} };
  };
  window.GM_download = function (d) {
    setTimeout(function () {
      var s = JSON.parse(localStorage.getItem('hzgm-saved') || '[]');
      s.push({ kind: d.url.slice(0, 5), name: d.name, at: Date.now(), page: location.pathname });
      localStorage.setItem('hzgm-saved', JSON.stringify(s));
      if (d.onload) d.onload();
    }, 300);
  };
  window.__hzBoot = performance.now();
  var s = document.createElement('script');
  s.src = 'http://localhost:8899/Hover-Zoom.user.js?' + Date.now();
  document.documentElement.appendChild(s);
})();
