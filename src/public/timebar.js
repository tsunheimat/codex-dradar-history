/* dradar2 archive toolbar — self-contained IIFE, first <head> script of every
 * cloned page. (1) wraps fetch so time-travel (?at=) propagates to the page's
 * own API calls; (2) renders a bottom-right time-travel control (zh/en). No
 * external requests except /archive-api/versions; degrades when archive empty. */
(function () {
  "use strict";

  var script = document.currentScript;
  var ds = (script && script.dataset) || {};
  var FEED = ds.feed || "";
  var CAP = ds.capturedAt || ""; // firstAt of the snapshot shown
  var AT = ds.at || ""; // requested ?at= (empty → live)
  var LIVE = !AT;

  // 1. fetch wrapper — installed synchronously, before any page script runs.
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;

  function needsAt(pathname) {
    return (
      pathname.indexOf("/api/") === 0 ||
      pathname.indexOf("/data/") === 0 ||
      pathname.indexOf("/deng-api/") === 0 ||
      pathname === "/current.json"
    );
  }

  if (nativeFetch && !LIVE) {
    window.fetch = function (input, init) {
      try {
        // A WHATWG URL object exposes .href (NOT .url); a Request exposes .url.
        var isUrlObj = typeof URL !== "undefined" && input instanceof URL;
        var href = typeof input === "string" ? input : isUrlObj ? input.href : input && input.url;
        if (href) {
          var u = new URL(href, location.href);
          if (
            u.origin === location.origin &&
            needsAt(u.pathname) &&
            !u.searchParams.has("at")
          ) {
            u.searchParams.set("at", AT);
            if (typeof input === "string" || isUrlObj) {
              // string or URL input: no init to preserve, pass the rewritten URL.
              input = u.toString();
            } else {
              input = new Request(u.toString(), input);
            }
          }
        }
      } catch (e) {
        /* fall through to native fetch on any parsing error */
      }
      return nativeFetch(input, init);
    };
  }

  // -- helpers ----------------------------------------------------------------
  function fmtTime(iso) {
    if (!iso) return "";
    try {
      return (
        new Intl.DateTimeFormat("zh-CN", {
          timeZone: "Asia/Shanghai",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(new Date(iso)) + " UTC+8"
      );
    } catch (e) {
      return iso;
    }
  }

  function dayOf(iso) {
    try {
      // en-CA renders as YYYY-MM-DD.
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(iso || Date.now()));
    } catch (e) {
      return "";
    }
  }

  function versionsUrl(params) {
    var qs = "feed=" + encodeURIComponent(FEED);
    for (var k in params) {
      if (params[k] != null && params[k] !== "")
        qs += "&" + k + "=" + encodeURIComponent(params[k]);
    }
    return "/archive-api/versions?" + qs;
  }

  // Use nativeFetch directly so toolbar calls never get an ?at= appended.
  function getVersions(params) {
    if (!nativeFetch) return Promise.reject(new Error("no fetch"));
    return nativeFetch(versionsUrl(params)).then(function (r) {
      return r.json();
    });
  }

  function goAt(firstAt) {
    location.href = location.pathname + "?at=" + encodeURIComponent(firstAt);
  }
  function goLatest() {
    location.href = location.pathname;
  }

  // -- 2. UI (built after DOM is ready) --------------------------------------
  function buildUI() {
    if (document.getElementById("dradar-timebar")) return;

    var css = document.createElement("style");
    css.textContent =
      "#dradar-timebar{position:fixed;right:12px;bottom:12px;z-index:2147483000;" +
      "font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#c8ffe0}" +
      "#dradar-timebar *{box-sizing:border-box}" +
      "#dradar-timebar .dt-pill{cursor:pointer;background:#05170d;border:1px solid #00e5ff;" +
      "border-radius:999px;padding:6px 12px;color:#39ff14;box-shadow:0 2px 10px rgba(0,0,0,.5);" +
      "user-select:none;white-space:nowrap}" +
      "#dradar-timebar .dt-pill .dt-badge{color:#00e5ff;margin-left:6px}" +
      "#dradar-timebar .dt-warn{color:#ff6b6b}" +
      "#dradar-timebar .dt-panel{display:none;width:290px;max-width:82vw;background:#04140b;" +
      "border:1px solid #00e5ff;border-radius:10px;padding:12px;margin-bottom:8px;" +
      "box-shadow:0 4px 20px rgba(0,0,0,.6)}" +
      "#dradar-timebar.dt-open .dt-panel{display:block}" +
      "#dradar-timebar.dt-open .dt-pill{display:none}" +
      "#dradar-timebar h4{margin:0 0 6px;color:#39ff14;font-size:12px;font-weight:600;" +
      "display:flex;justify-content:space-between;align-items:center}" +
      "#dradar-timebar .dt-x{cursor:pointer;color:#5f8f76;padding:0 4px}" +
      "#dradar-timebar .dt-now{color:#7dffb0;margin:0 0 8px;word-break:break-all}" +
      "#dradar-timebar .dt-live{color:#04140b;background:#39ff14;border-radius:4px;" +
      "padding:1px 6px;font-weight:700;margin-left:6px}" +
      "#dradar-timebar .dt-row{display:flex;gap:6px;margin:6px 0;flex-wrap:wrap}" +
      "#dradar-timebar button,#dradar-timebar input,#dradar-timebar select{" +
      "font:inherit;background:#05170d;color:#c8ffe0;border:1px solid #1c6b47;" +
      "border-radius:6px;padding:4px 7px;cursor:pointer}" +
      "#dradar-timebar select,#dradar-timebar input{cursor:auto;min-width:0;flex:1}" +
      "#dradar-timebar button:hover{border-color:#00e5ff;color:#39ff14}" +
      "#dradar-timebar .dt-nav{margin-top:8px;border-top:1px solid #123a27;padding-top:8px;" +
      "line-height:1.9}" +
      "#dradar-timebar .dt-nav a{color:#00e5ff;text-decoration:none;margin-right:4px}" +
      "#dradar-timebar .dt-attr{margin-top:8px;color:#5f8f76;font-size:11px}" +
      "#dradar-timebar .dt-attr a{color:#7dffb0}";
    document.head.appendChild(css);

    var wrap = document.createElement("div");
    wrap.id = "dradar-timebar";

    var warnHtml = window.__DRADAR_PATCH_WARNING
      ? '<span class="dt-warn" title="' +
        String(window.__DRADAR_PATCH_WARNING).replace(/"/g, "&quot;") +
        '">⚠</span> '
      : "";

    var pill = document.createElement("div");
    pill.className = "dt-pill";
    pill.innerHTML =
      warnHtml +
      "🗄 存档 ARCHIVE" +
      '<span class="dt-badge">' +
      (LIVE ? "LIVE" : "⏱") +
      "</span>";

    var panel = document.createElement("div");
    panel.className = "dt-panel";
    panel.innerHTML =
      '<h4><span>' +
      warnHtml +
      "🗄 存档时光机 Time machine</span><span class=\"dt-x\" title=\"收起 close\">✕</span></h4>" +
      '<div class="dt-now"></div>' +
      '<div class="dt-row">' +
      '<button class="dt-prev" title="上一版">⏮ 上一版</button>' +
      '<button class="dt-next" title="下一版">下一版 ⏭</button>' +
      '<button class="dt-latest" title="最新">最新 latest</button>' +
      "</div>" +
      '<div class="dt-row">' +
      '<input class="dt-date" type="date" title="选择日期 date">' +
      "</div>" +
      '<div class="dt-row">' +
      '<select class="dt-sel"><option>—</option></select>' +
      '<button class="dt-go">Go</button>' +
      "</div>" +
      '<div class="dt-nav">' +
      '<a href="/">主站 /</a>· <a href="/deng/">分布式 /deng/</a>· ' +
      '<a href="/history">长期历史 /history</a>· <a href="/sources">采集状态 /sources</a>' +
      "</div>" +
      '<div class="dt-attr">数据来自 Codex 雷达 ' +
      '<a href="https://codexradar.com" target="_blank" rel="noreferrer">codexradar.com</a>' +
      " · dradar2 archive replica</div>";

    wrap.appendChild(panel);
    wrap.appendChild(pill);
    document.body.appendChild(wrap);

    var nowEl = panel.querySelector(".dt-now");
    if (LIVE) {
      nowEl.innerHTML =
        "当前 viewing:<span class=\"dt-live\">LIVE-latest</span><br>" +
        (CAP ? fmtTime(CAP) : "—");
    } else {
      nowEl.innerHTML = "快照 snapshot:<br>" + fmtTime(CAP || AT);
    }

    // open / close
    pill.addEventListener("click", function () {
      wrap.classList.add("dt-open");
      loadDay(dateInput.value);
    });
    panel.querySelector(".dt-x").addEventListener("click", function () {
      wrap.classList.remove("dt-open");
    });

    // prev / next / latest
    var anchor = CAP || AT || new Date().toISOString();
    panel.querySelector(".dt-prev").addEventListener("click", function () {
      getVersions({ before: anchor, limit: 1 })
        .then(function (d) {
          var v = d && d.versions && d.versions[0];
          if (v) goAt(v.firstAt);
          else flash("已到最早 earliest");
        })
        .catch(function () {
          flash("无法加载 error");
        });
    });
    panel.querySelector(".dt-next").addEventListener("click", function () {
      getVersions({ after: anchor, limit: 1 })
        .then(function (d) {
          var v = d && d.versions && d.versions[0];
          if (v) goAt(v.firstAt);
          else goLatest();
        })
        .catch(function () {
          flash("无法加载 error");
        });
    });
    panel.querySelector(".dt-latest").addEventListener("click", goLatest);

    // date → version list
    var dateInput = panel.querySelector(".dt-date");
    var sel = panel.querySelector(".dt-sel");
    dateInput.value = dayOf(CAP || AT);
    dateInput.addEventListener("change", function () {
      loadDay(dateInput.value);
    });
    panel.querySelector(".dt-go").addEventListener("click", function () {
      if (sel.value && sel.value !== "—") goAt(sel.value);
    });

    function loadDay(day) {
      if (!day) return;
      sel.innerHTML = "<option>…</option>";
      getVersions({ day: day, limit: 1000 })
        .then(function (d) {
          var vs = (d && d.versions) || [];
          if (!vs.length) {
            sel.innerHTML = "<option>该日无快照 none</option>";
            return;
          }
          sel.innerHTML = "";
          vs.forEach(function (v) {
            var o = document.createElement("option");
            o.value = v.firstAt;
            o.textContent = fmtTime(v.firstAt);
            if (v.firstAt === (CAP || AT)) o.selected = true;
            sel.appendChild(o);
          });
        })
        .catch(function () {
          sel.innerHTML = "<option>加载失败 error</option>";
        });
    }

    function flash(msg) {
      nowEl.setAttribute("data-flash", msg);
      var prev = nowEl.innerHTML;
      nowEl.innerHTML = "<span class=\"dt-warn\">" + msg + "</span>";
      setTimeout(function () {
        nowEl.innerHTML = prev;
      }, 1400);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildUI);
  } else {
    buildUI();
  }
})();
