/* Τοίχος Προσβασιμότητας City4All — απλή JavaScript, χωρίς βιβλιοθήκες. */
(function () {
  "use strict";

  /* ------------------------------------------------------------------------ */
  /*  ΡΥΘΜΙΣΕΙΣ                                                               */
  /* ------------------------------------------------------------------------ */

  // Δοκιμάζονται με τη σειρά. Το πρώτο layer που επιστρέφει επιχειρήσεις χρησιμοποιείται.
  var LAYER_URLS = [
    "https://services4.arcgis.com/D1oWZQPmnyTvHNmk/arcgis/rest/services/survey123_ccd6ad59f5824a6bad1a1700fa0a9197_results/FeatureServer/0",
    "https://services4.arcgis.com/D1oWZQPmnyTvHNmk/arcgis/rest/services/survey123_ccd6ad59f5824a6bad1a1700fa0a9197/FeatureServer/0"
  ];

  // Χρειάζεται μόνο αν το layer ΔΕΝ είναι δημόσιο.
  var ARCGIS_TOKEN = "";

  var BP_URL = "https://www.city4all.org/pages/city4allbp";
  var MAX_IMAGES = 3;
  var SLIDE_INTERVAL_MS = 3000;

  // Τα ονόματα των πεδίων του Survey123. Δοκιμάζεται το πρώτο όνομα που υπάρχει.
  var FIELD_NAMES = {
    name: ["business_name"],
    tagline: ["short_tagline", "tagline"],
    description: ["detailed_description", "description"],
    accessibility: ["detailed_accessibility_info", "accessibility_details"],
    xr: ["city4all_xr_link", "xr_link"],
    site: ["official_business_link", "business_link", "website"],
    // Τοποθεσία: δοκιμάζονται αυτά τα ονόματα. Αν δεν βρεθεί κανένα, ψάχνεται
    // οποιοδήποτε πεδίο με "location" ή "address" στο όνομά του (βλ. findLocation).
    location: [
      "business_location", "location", "business_address", "address",
      "street_address", "location_text", "city4all_location", "official_location"
    ]
  };

  var PLACEHOLDER_SVG =
    '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
    '<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 19.5h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zM8.25 9.75a1.125 1.125 0 100-2.25 1.125 1.125 0 000 2.25zM21 15l-5.16-5.16a2.25 2.25 0 00-3.18 0L3 18.75"/>' +
    "</svg>";

  /* ------------------------------------------------------------------------ */
  /*  ΒΟΗΘΗΤΙΚΕΣ ΣΥΝΑΡΤΗΣΕΙΣ                                                  */
  /* ------------------------------------------------------------------------ */

  function byId(id) {
    return document.getElementById(id);
  }

  // Δημιουργεί στοιχείο. Το κείμενο μπαίνει πάντα με textContent (ποτέ innerHTML).
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

  // Καθαρίζει έναν σύνδεσμο: "city4all.org" -> "https://city4all.org".
  // Επιστρέφει κενό αν ο σύνδεσμος δεν είναι ασφαλής (π.χ. javascript:).
  function normalizeUrl(raw) {
    var value = String(raw || "").trim();
    if (!value) return "";
    if (/^(javascript|data|vbscript|file|blob|about):/i.test(value)) return "";
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
      if (!/^https?:\/\//i.test(value)) return "";
      value = value.replace(/^http:\/\//i, "https://");
    } else {
      value = "https://" + value.replace(/^\/+/, "");
    }
    return isHttps(value) ? value : "";
  }

  // Βρίσκει πεδίο χωρίς να μετράει πεζά/κεφαλαία.
  function getField(attrs, name) {
    if (Object.prototype.hasOwnProperty.call(attrs, name)) return attrs[name];
    var wanted = name.toLowerCase();
    var keys = Object.keys(attrs);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === wanted) return attrs[keys[i]];
    }
    return undefined;
  }

  // Επιστρέφει την πρώτη μη κενή τιμή από μια λίστα πιθανών ονομάτων πεδίου.
  function pick(attrs, names) {
    for (var i = 0; i < names.length; i++) {
      var value = getField(attrs, names[i]);
      if (value != null && String(value).trim() !== "") return String(value).trim();
    }
    return "";
  }

  // Τοποθεσία ως κείμενο: πρώτα τα γνωστά ονόματα, μετά οποιοδήποτε πεδίο
  // που μοιάζει με τοποθεσία/διεύθυνση και δεν χρησιμοποιείται αλλού.
  function findLocation(attrs) {
    var direct = pick(attrs, FIELD_NAMES.location);
    if (direct) return direct;

    var known = {};
    Object.keys(FIELD_NAMES).forEach(function (group) {
      FIELD_NAMES[group].forEach(function (n) {
        known[n.toLowerCase()] = true;
      });
    });

    var keys = Object.keys(attrs);
    for (var i = 0; i < keys.length; i++) {
      if (known[keys[i].toLowerCase()]) continue;
      if (/locat|addr|τοποθεσ|διευθυν/i.test(keys[i])) {
        var value = attrs[keys[i]];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    }
    return "";
  }

  // Συντεταγμένες από το σημείο του record (0,0 σημαίνει ότι δεν δόθηκε τοποθεσία).
  function readCoords(geometry) {
    if (!geometry) return null;
    var lng = Number(geometry.x);
    var lat = Number(geometry.y);
    if (!isFinite(lng) || !isFinite(lat)) return null;
    if (lng === 0 && lat === 0) return null;
    if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
    return { lat: lat, lng: lng };
  }

  function buildMapUrl(location, coords) {
    var query = coords ? coords.lat + "," + coords.lng : location;
    if (!query) return "";
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query);
  }

  /* ------------------------------------------------------------------------ */
  /*  ΔΕΔΟΜΕΝΑ (ArcGIS)                                                       */
  /* ------------------------------------------------------------------------ */

  async function fetchJson(url, signal) {
    var res = await fetch(url, { signal: signal });
    if (!res.ok) throw new Error("Το αίτημα απέτυχε (" + res.status + ").");
    var data = await res.json();
    // Το ArcGIS συχνά απαντά HTTP 200 με σφάλμα μέσα στο JSON.
    if (data && data.error) {
      throw new Error("Σφάλμα ArcGIS: " + (data.error.message || "άγνωστο σφάλμα") + ".");
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
      return []; // μια αποτυχημένη αναζήτηση φωτογραφιών δεν χαλάει όλο τον τοίχο
    }
  }

  async function loadFromLayer(layerUrl, signal) {
    // outSR=4326: οι συντεταγμένες επιστρέφονται ως γεωγραφικό μήκος/πλάτος.
    var data = await fetchJson(withToken(layerUrl + "/query?where=1%3D1&outFields=*&outSR=4326&f=json"), signal);

    var oidField = data.objectIdFieldName;
    if (!oidField) {
      var oidDef = (data.fields || []).find(function (f) {
        return f.type === "esriFieldTypeOID";
      });
      oidField = oidDef ? oidDef.name : "OBJECTID";
    }

    var records = (data.features || []).filter(function (f) {
      var a = f.attributes || {};
      return getField(a, oidField) != null && pick(a, FIELD_NAMES.name);
    });

    return Promise.all(
      records.map(async function (feature) {
        var attrs = feature.attributes;
        var objectId = getField(attrs, oidField);
        var images = await fetchImageUrls(layerUrl, objectId, signal);
        var location = findLocation(attrs);
        var coords = readCoords(feature.geometry);
        return {
          id: objectId,
          name: pick(attrs, FIELD_NAMES.name),
          tagline: pick(attrs, FIELD_NAMES.tagline),
          description: pick(attrs, FIELD_NAMES.description),
          accessibility: pick(attrs, FIELD_NAMES.accessibility),
          xrLink: normalizeUrl(pick(attrs, FIELD_NAMES.xr)),
          siteUrl: normalizeUrl(pick(attrs, FIELD_NAMES.site)),
          location: location,
          mapUrl: buildMapUrl(location, coords),
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
        console.warn("Το layer απέτυχε:", LAYER_URLS[i], err);
        lastError = err;
      }
    }

    if (!reachedALayer && lastError) throw lastError;
    return [];
  }

  /* ------------------------------------------------------------------------ */
  /*  SLIDESHOW (μέχρι 3 εικόνες, fade κάθε 3 δευτερόλεπτα)                   */
  /* ------------------------------------------------------------------------ */

  var timers = []; // χρονομετρητές των καρτών
  var modalTimers = []; // χρονομετρητές της εικόνας του modal

  function clearList(list) {
    list.forEach(function (t) {
      clearTimeout(t);
      clearInterval(t);
    });
    list.length = 0;
  }

  function createSlideshow(images, altText, position, bag) {
    var wrap = make("div", "slideshow");

    if (!images.length) {
      wrap.className += " slideshow--empty";
      wrap.setAttribute("role", "img");
      wrap.setAttribute("aria-label", altText + " (χωρίς φωτογραφίες)");
      wrap.innerHTML = PLACEHOLDER_SVG; // στατικό markup, χωρίς δεδομένα χρήστη
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
      // Μια χαλασμένη εικόνα βγαίνει από την εναλλαγή αντί να αφήνει κενό.
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
      // Μικρή καθυστέρηση ανά κάρτα, ώστε να μην αλλάζουν όλες ταυτόχρονα.
      var starter = setTimeout(function () {
        var interval = setInterval(function () {
          if (!document.hidden) show(current + 1);
        }, SLIDE_INTERVAL_MS);
        bag.push(interval);
      }, position * 400);
      bag.push(starter);
    }

    return wrap;
  }

  /* ------------------------------------------------------------------------ */
  /*  ΕΜΦΑΝΙΣΗ                                                                */
  /* ------------------------------------------------------------------------ */

  var carousel = byId("c4a-carousel");
  var statusEl = byId("c4a-status");
  var controller = null;

  function createBusinessCard(business, position) {
    var card = make("button", "card");
    card.type = "button";
    card.setAttribute("aria-label", "Άνοιγμα λεπτομερειών για: " + business.name);

    card.appendChild(createSlideshow(business.images, "Φωτογραφία: " + business.name, position, timers));

    var body = make("div", "card__body");
    var top = make("div");
    top.appendChild(make("h3", "card__title", business.name));
    if (business.location) top.appendChild(make("p", "card__location", business.location));
    if (business.tagline) top.appendChild(make("p", "card__tagline", business.tagline));
    body.appendChild(top);
    body.appendChild(make("span", "card__cta", "Εξερευνήστε την επιχείρηση →"));
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
    top.appendChild(make("span", "badge", "Για επιχειρήσεις"));
    top.appendChild(make("h3", "card__title", "Προσθέστε την επιχείρησή σας στον Τοίχο"));
    link.appendChild(top);
    link.appendChild(make("span", "card__cta", "Δείτε τα πακέτα για επιχειρήσεις →"));
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
    clearList(timers);
    statusEl.hidden = true;
    statusEl.textContent = "";
    carousel.hidden = false;
    carousel.setAttribute("aria-busy", "true");
    carousel.replaceChildren();
    for (var i = 0; i < 4; i++) carousel.appendChild(createSkeletonCard());
  }

  function renderError(message) {
    clearList(timers);
    carousel.replaceChildren();
    carousel.hidden = true;
    carousel.removeAttribute("aria-busy");

    statusEl.className = "status status--error";
    statusEl.setAttribute("role", "alert");
    statusEl.textContent = "";
    statusEl.appendChild(make("p", "status__title", "Δεν μπορέσαμε να φορτώσουμε τον Τοίχο Προσβασιμότητας."));
    statusEl.appendChild(make("p", "status__msg", message));

    var retry = make("button", "btn-retry", "Δοκιμάστε ξανά");
    retry.type = "button";
    retry.addEventListener("click", loadWall);
    statusEl.appendChild(retry);
    statusEl.hidden = false;
  }

  function renderBusinesses(items) {
    clearList(timers);
    carousel.hidden = false;
    carousel.removeAttribute("aria-busy");
    carousel.replaceChildren();

    if (items.length === 0) {
      statusEl.className = "status status--empty";
      statusEl.removeAttribute("role");
      statusEl.textContent = "Δεν υπάρχουν ακόμα επιχειρήσεις στον Τοίχο — γίνετε ο πρώτος!";
      statusEl.hidden = false;
    } else {
      statusEl.hidden = true;
      statusEl.textContent = "";
    }

    items.forEach(function (business, i) {
      carousel.appendChild(createBusinessCard(business, i));
    });
    carousel.appendChild(createAddCard()); // πάντα η τελευταία κάρτα στο scroll
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
      renderError(err.message || "Κάτι πήγε στραβά.");
    }
  }

  /* ------------------------------------------------------------------------ */
  /*  MODAL (Επισκόπηση + καρτέλα 3D)                                         */
  /* ------------------------------------------------------------------------ */

  var modal = byId("c4a-modal");
  var closeBtn = byId("c4a-close");
  var banner = byId("c4a-banner");
  var titleEl = byId("c4a-modal-title");
  var taglineEl = byId("c4a-modal-tagline");
  var tabsEl = byId("c4a-tabs");
  var tabInfo = byId("c4a-tab-info");
  var tab3d = byId("c4a-tab-3d");
  var panelInfo = byId("c4a-panel-info");
  var panel3d = byId("c4a-panel-3d");
  var aboutSec = byId("c4a-about");
  var aboutText = byId("c4a-about-text");
  var locationSec = byId("c4a-location");
  var locationText = byId("c4a-location-text");
  var mapLink = byId("c4a-map");
  var accessSec = byId("c4a-access");
  var accessBody = byId("c4a-access-body");
  var accessCount = byId("c4a-access-count");
  var siteLink = byId("c4a-site");
  var emptyEl = byId("c4a-empty");
  var frame = byId("c4a-frame");
  var newTab = byId("c4a-newtab");

  var lastTrigger = null;
  var currentBusiness = null;
  var frameLoaded = false;

  // Κάθε γραμμή του κειμένου γίνεται ένα χαρακτηριστικό προσβασιμότητας (κάρτα,
  // χωρίς bullets). Αν υπάρχει μία μόνο γραμμή με ερωτηματικά ";", σπάει σε πολλά.
  function parseAccessibility(text) {
    var lines = String(text || "").split(/\r?\n/);
    if (lines.length === 1 && lines[0].indexOf(";") !== -1) lines = lines[0].split(";");
    return lines
      .map(function (line) {
        return line.replace(/^\s*(?:[-•*·]|\d+[.)])\s*/, "").trim();
      })
      .filter(Boolean);
  }

  function renderAccessibility(text) {
    accessBody.textContent = "";
    var items = parseAccessibility(text);
    if (!items.length) {
      accessCount.textContent = "";
      return 0;
    }

    var grid = make("ul", "access-grid");
    grid.setAttribute("role", "list"); // το Safari αφαιρεί τη σημασιολογία λίστας όταν δεν υπάρχουν bullets
    items.forEach(function (item) {
      var cls = "access-item" + (items.length === 1 ? " access-item--wide" : "");
      grid.appendChild(make("li", cls, item));
    });
    accessBody.appendChild(grid);

    accessCount.textContent = items.length + (items.length === 1 ? " χαρακτηριστικό" : " χαρακτηριστικά");
    return items.length;
  }

  function selectTab(which, moveFocus) {
    var is3d = which === "3d";
    tabInfo.setAttribute("aria-selected", String(!is3d));
    tabInfo.tabIndex = is3d ? -1 : 0;
    tab3d.setAttribute("aria-selected", String(is3d));
    tab3d.tabIndex = is3d ? 0 : -1;
    panelInfo.hidden = is3d;
    panel3d.hidden = !is3d;

    // Το iframe φορτώνεται μόνο όταν ανοίξει η καρτέλα 3D.
    if (is3d && currentBusiness && currentBusiness.xrLink && !frameLoaded) {
      frame.title = "Διαδραστικός 3D χώρος: " + currentBusiness.name;
      frame.src = currentBusiness.xrLink; // από το πεδίο city4all_xr_link
      frameLoaded = true;
    }
    if (moveFocus) (is3d ? tab3d : tabInfo).focus();
  }

  tabInfo.addEventListener("click", function () {
    selectTab("info", false);
  });
  tab3d.addEventListener("click", function () {
    selectTab("3d", false);
  });
  tabsEl.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      var go3d = e.key === "ArrowRight" || e.key === "End";
      selectTab(go3d ? "3d" : "info", true);
    }
  });

  function openModal(business, trigger) {
    lastTrigger = trigger || null;
    currentBusiness = business;
    frameLoaded = false;
    frame.removeAttribute("src");

    // Φωτογραφίες στην κορυφή
    clearList(modalTimers);
    banner.replaceChildren();
    if (business.images.length) {
      banner.appendChild(createSlideshow(business.images, "Φωτογραφία: " + business.name, 0, modalTimers));
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }

    titleEl.textContent = business.name;
    taglineEl.textContent = business.tagline;
    taglineEl.hidden = !business.tagline;

    // Επισκόπηση
    aboutText.textContent = business.description;
    aboutSec.hidden = !business.description;

    // Τοποθεσία (κείμενο και/ή σύνδεσμος χάρτη)
    locationText.textContent = business.location;
    locationText.hidden = !business.location;
    if (business.mapUrl) {
      mapLink.href = business.mapUrl;
      mapLink.hidden = false;
    } else {
      mapLink.hidden = true;
    }
    locationSec.hidden = !(business.location || business.mapUrl);

    var accessItems = renderAccessibility(business.accessibility);
    accessSec.hidden = accessItems === 0;

    if (business.siteUrl) {
      siteLink.href = business.siteUrl;
      siteLink.hidden = false;
    } else {
      siteLink.hidden = true;
    }

    emptyEl.hidden = !!(
      business.description ||
      business.location ||
      business.mapUrl ||
      accessItems ||
      business.siteUrl
    );

    // Καρτέλα 3D: εμφανίζεται μόνο αν υπάρχει σύνδεσμος
    if (business.xrLink) {
      newTab.href = business.xrLink;
      tabsEl.hidden = false;
    } else {
      tabsEl.hidden = true;
    }
    selectTab("info", false);

    modal.hidden = false;
    document.body.classList.add("modal-open");
    closeBtn.focus();
  }

  function closeModal() {
    if (modal.hidden) return;
    modal.hidden = true;
    frame.src = "about:blank"; // σταματάει ο 3D χώρος
    frameLoaded = false;
    currentBusiness = null;
    clearList(modalTimers);
    document.body.classList.remove("modal-open");
    if (lastTrigger && typeof lastTrigger.focus === "function") lastTrigger.focus();
    lastTrigger = null;
  }

  closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeModal(); // κλικ στο σκοτεινό φόντο
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
  });

  /* ------------------------------------------------------------------------ */
  /*  ΕΚΚΙΝΗΣΗ                                                                */
  /* ------------------------------------------------------------------------ */

  loadWall();
})();
