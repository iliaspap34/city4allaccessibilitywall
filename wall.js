/* City4All Accessible Wall — plain JavaScript, no libraries. */
(function () {
  "use strict";

  /* ------------------------------------------------------------------------ */
  /*  CONFIG                                                                  */
  /* ------------------------------------------------------------------------ */

  // Tried in order. The first layer that returns businesses is used.
  var LAYER_URLS = [
    "https://services4.arcgis.com/D1oWZQPmnyTvHNmk/arcgis/rest/services/survey123_ccd6ad59f5824a6bad1a1700fa0a9197_results/FeatureServer/0",
    "https://services4.arcgis.com/D1oWZQPmnyTvHNmk/arcgis/rest/services/survey123_ccd6ad59f5824a6bad1a1700fa0a9197/FeatureServer/0"
  ];

  // Only needed if the layer is NOT shared publicly.
  var ARCGIS_TOKEN = "";

  var BP_URL = "https://www.city4all.org/pages/city4allbp";
  var MAX_IMAGES = 3;
  var SLIDE_INTERVAL_MS = 3000;

  var PLACEHOLDER_SVG =
    '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
    '<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 19.5h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zM8.25 9.75a1.125 1.125 0 100-2.25 1.125 1.125 0 000 2.25zM21 15l-5.16-5.16a2.25 2.25 0 00-3.18 0L3 18.75"/>' +
    "</svg>";

  /* ------------------------------------------------------------------------ */
  /*  HELPERS                                                                 */
  /* ------------------------------------------------------------------------ */

  function byId(id) {
    return document.getElementById(id);
  }

  // Create an element. Text is always set with textContent (never innerHTML).
  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function withToken(url) {
    if (!ARCGIS_TOKEN) return url;
    return url + (url.indexOf("?") === -1 ? "?" : "&") + "token=" + encodeURIComponent(ARCGIS_TOKEN);
  }

  function isHttps(url) {
    try {
      return new URL(url).protocol === "https:";
    } catch (e) {
      return false;
    }
  }

  // Finds a field ignoring upper/lower case (Business_Name = business_name).
  function getField(attrs, name) {
    if (Object.prototype.hasOwnProperty.call(attrs, name)) return attrs[name];
    var wanted = name.toLowerCase();
    var keys = Object.keys(attrs);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === wanted) return attrs[keys[i]];
    }
    return undefined;
  }

  /* ------------------------------------------------------------------------ */
  /*  DATA LAYER (ArcGIS)                                                     */
  /* ------------------------------------------------------------------------ */

  async function fetchJson(url, signal) {
    var res = await fetch(url, { signal: signal });
    if (!res.ok) throw new Error("Request failed (" + res.status + ")");
    var data = await res.json();
    // ArcGIS often answers HTTP 200 with an error object inside the JSON.
    if (data && data.error) {
      throw new Error(data.error.message || "ArcGIS returned an error");
    }
    return data;
  }

  async function fetchImageUrls(layerUrl, objectId, signal) {
    try {
      var base = layerUrl + "/" + objectId + "/attachments";
      var data = await fetchJson(withToken(base + "?f=json"), signal);
      return (data.attachmentInfos || [])
        .filter(function (a) {
          return String(a.contentType || "").toLowerCase().indexOf("image/") === 0;
        })
        .slice(0, MAX_IMAGES)
        .map(function (a) {
          return withToken(base + "/" + a.id);
        });
    } catch (err) {
      if (err.name === "AbortError") throw err;
      return []; // one failed attachment lookup must not break the whole wall
    }
  }

  async function loadFromLayer(layerUrl, signal) {
    var data = await fetchJson(withToken(layerUrl + "/query?where=1%3D1&outFields=*&f=json"), signal);

    var oidField = data.objectIdFieldName;
    if (!oidField) {
      var oidDef = (data.fields || []).find(function (f) {
        return f.type === "esriFieldTypeOID";
      });
      oidField = oidDef ? oidDef.name : "OBJECTID";
    }

    var records = (data.features || [])
      .map(function (f) {
        return f.attributes || {};
      })
      .filter(function (a) {
        return a[oidField] != null && getField(a, "business_name");
      });

    return Promise.all(
      records.map(async function (attrs) {
        var objectId = attrs[oidField];
        var images = await fetchImageUrls(layerUrl, objectId, signal);
        return {
          id: objectId,
          name: String(getField(attrs, "business_name")),
          tagline: getField(attrs, "tagline") || "",
          description: getField(attrs, "description") || "",
          accessibility: getField(attrs, "accessibility_details") || "",
          xrLink: getField(attrs, "xr_link") || "",
          images: images
        };
      })
    );
  }

  async function fetchBusinesses(signal) {
    var lastError = null;
    var reachedALayer = false;

    for (var i = 0; i < LAYER_URLS.length; i++) {
      try {
        var items = await loadFromLayer(LAYER_URLS[i], signal);
        reachedALayer = true;
        if (items.length > 0) return items;
      } catch (err) {
        if (err.name === "AbortError") throw err;
        console.warn("Layer failed:", LAYER_URLS[i], err);
        lastError = err;
      }
    }

    if (!reachedALayer && lastError) throw lastError;
    return [];
  }

  /* ------------------------------------------------------------------------ */
  /*  SLIDESHOW (3 images, fade every 3 seconds)                              */
  /* ------------------------------------------------------------------------ */

  var timers = [];

  function clearTimers() {
    timers.forEach(function (t) {
      clearTimeout(t);
      clearInterval(t);
    });
    timers = [];
  }

  function createSlideshow(images, altText, position) {
    var wrap = make("div", "slideshow");

    if (!images.length) {
      wrap.className += " slideshow--empty";
      wrap.setAttribute("role", "img");
      wrap.setAttribute("aria-label", altText + " (no photos yet)");
      wrap.innerHTML = PLACEHOLDER_SVG; // static markup, no user data
      return wrap;
    }

    var current = 0;

    function slides() {
      return wrap.querySelectorAll(".slide");
    }

    function show(index) {
      var list = slides();
      if (!list.length) return;
      current = ((index % list.length) + list.length) % list.length;
      list.forEach(function (node, i) {
        node.classList.toggle("is-active", i === current);
      });
    }

    images.forEach(function (src, i) {
      var img = document.createElement("img");
      img.className = "slide" + (i === 0 ? " is-active" : "");
      img.src = src;
      img.alt = i === 0 ? altText : "";
      img.loading = "lazy";
      img.draggable = false;
      // A broken image is dropped from the rotation instead of showing a gap.
      img.addEventListener("error", function () {
        img.remove();
        show(current);
        if (!slides().length) {
          wrap.className += " slideshow--empty";
          wrap.innerHTML = PLACEHOLDER_SVG;
        }
      });
      wrap.appendChild(img);
    });

    if (images.length > 1) {
      // Small stagger so every card doesn't flip at the exact same moment.
      var starter = setTimeout(function () {
        var interval = setInterval(function () {
          if (!document.hidden) show(current + 1);
        }, SLIDE_INTERVAL_MS);
        timers.push(interval);
      }, position * 400);
      timers.push(starter);
    }

    return wrap;
  }

  /* ------------------------------------------------------------------------ */
  /*  RENDERING                                                               */
  /* ------------------------------------------------------------------------ */

  var carousel = byId("c4a-carousel");
  var statusEl = byId("c4a-status");
  var controller = null;

  function createBusinessCard(business, position) {
    var card = make("button", "card");
    card.type = "button";
    card.setAttribute("aria-label", "Open details for " + business.name);

    card.appendChild(createSlideshow(business.images, business.name + " photo", position));

    var body = make("div", "card__body");
    var top = make("div");
    top.appendChild(make("h3", "card__title", business.name));
    if (business.tagline) top.appendChild(make("p", "card__tagline", business.tagline));
    body.appendChild(top);
    body.appendChild(make("span", "card__cta", "Explore in 3D →"));
    card.appendChild(body);

    card.addEventListener("click", function () {
      openModal(business, card);
    });
    return card;
  }

  function createAddCard() {
    var link = make("a", "card card--add");
    link.href = BP_URL;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    var top = make("div");
    top.appendChild(make("span", "badge", "For businesses"));
    top.appendChild(make("h3", "card__title", "Add your business to the wall"));
    link.appendChild(top);
    link.appendChild(make("span", "card__cta", "View business plans →"));
    return link;
  }

  function createSkeletonCard() {
    var card = make("div", "card card--skeleton");
    card.setAttribute("aria-hidden", "true");
    card.appendChild(make("div", "sk-img"));
    var lines = make("div", "sk-lines");
    lines.appendChild(make("div", "sk-line sk-line--title"));
    lines.appendChild(make("div", "sk-line"));
    lines.appendChild(make("div", "sk-line sk-line--short"));
    card.appendChild(lines);
    return card;
  }

  function renderLoading() {
    clearTimers();
    statusEl.hidden = true;
    statusEl.textContent = "";
    carousel.hidden = false;
    carousel.setAttribute("aria-busy", "true");
    carousel.replaceChildren();
    for (var i = 0; i < 4; i++) carousel.appendChild(createSkeletonCard());
  }

  function renderError(message) {
    clearTimers();
    carousel.replaceChildren();
    carousel.hidden = true;
    carousel.removeAttribute("aria-busy");

    statusEl.className = "status status--error";
    statusEl.setAttribute("role", "alert");
    statusEl.textContent = "";
    statusEl.appendChild(make("p", "status__title", "We couldn't load the Accessible Wall."));
    statusEl.appendChild(make("p", "status__msg", message));

    var retry = make("button", "btn-retry", "Try again");
    retry.type = "button";
    retry.addEventListener("click", loadWall);
    statusEl.appendChild(retry);
    statusEl.hidden = false;
  }

  function renderBusinesses(items) {
    clearTimers();
    carousel.hidden = false;
    carousel.removeAttribute("aria-busy");
    carousel.replaceChildren();

    if (items.length === 0) {
      statusEl.className = "status status--empty";
      statusEl.removeAttribute("role");
      statusEl.textContent = "No businesses are on the wall yet — be the first!";
      statusEl.hidden = false;
    } else {
      statusEl.hidden = true;
      statusEl.textContent = "";
    }

    items.forEach(function (business, i) {
      carousel.appendChild(createBusinessCard(business, i));
    });
    carousel.appendChild(createAddCard()); // always the last card in the scroll
  }

  async function loadWall() {
    if (controller) controller.abort();
    controller = new AbortController();
    var signal = controller.signal;

    renderLoading();
    try {
      var items = await fetchBusinesses(signal);
      if (signal.aborted) return;
      renderBusinesses(items);
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error(err);
      renderError(err.message || "Something went wrong.");
    }
  }

  /* ------------------------------------------------------------------------ */
  /*  MODAL                                                                   */
  /* ------------------------------------------------------------------------ */

  var modal = byId("c4a-modal");
  var closeBtn = byId("c4a-close");
  var frame = byId("c4a-frame");
  var noXr = byId("c4a-noxr");
  var titleEl = byId("c4a-modal-title");
  var taglineEl = byId("c4a-modal-tagline");
  var aboutSec = byId("c4a-about");
  var aboutText = byId("c4a-about-text");
  var accessSec = byId("c4a-access");
  var accessText = byId("c4a-access-text");
  var newTab = byId("c4a-newtab");
  var lastTrigger = null;

  function openModal(business, trigger) {
    lastTrigger = trigger || null;

    titleEl.textContent = business.name;

    taglineEl.textContent = business.tagline;
    taglineEl.hidden = !business.tagline;

    aboutText.textContent = business.description;
    aboutSec.hidden = !business.description;

    accessText.textContent = business.accessibility;
    accessSec.hidden = !business.accessibility;

    // The iframe src is set dynamically from the record's xr_link field.
    if (business.xrLink && isHttps(business.xrLink)) {
      frame.title = business.name + " interactive 3D space";
      frame.src = business.xrLink;
      frame.hidden = false;
      noXr.hidden = true;
      newTab.href = business.xrLink;
      newTab.hidden = false;
    } else {
      frame.removeAttribute("src");
      frame.hidden = true;
      noXr.hidden = false;
      newTab.hidden = true;
    }

    modal.hidden = false;
    document.body.classList.add("modal-open");
    closeBtn.focus();
  }

  function closeModal() {
    if (modal.hidden) return;
    modal.hidden = true;
    frame.src = "about:blank"; // stops the 3D scene
    document.body.classList.remove("modal-open");
    if (lastTrigger && typeof lastTrigger.focus === "function") lastTrigger.focus();
    lastTrigger = null;
  }

  closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeModal(); // click on the dark backdrop
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
  });

  /* ------------------------------------------------------------------------ */
  /*  START                                                                   */
  /* ------------------------------------------------------------------------ */

  loadWall();
})();
