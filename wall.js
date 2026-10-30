/* Τοίχος Προσβασιμότητας City4All — απλή JavaScript, χωρίς βιβλιοθήκες.
 *
 * v5: αυτόματοι 360° χώροι από τα attachments του ArcGIS Survey123,
 *     τέσσερα διαδραστικά σήματα πληροφοριών και επέκταση της κάρτας
 *     σε πλήρη οθόνη μέσω postMessage με τη γονική σελίδα.
 */
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

  var BP_URL = "https://iliaspap34.github.io/City4all-payment-page/";
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

  // ---- 360° ρυθμίσεις ------------------------------------------------------
  var PANO = {
    // Pannellum από CDN — φορτώνεται μόνο όταν ανοίξει ο πρώτος 360° χώρος.
    css: "https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.css",
    js: "https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.js",
    libTimeoutMs: 15000,
    imageTimeoutMs: 20000,
    loadTimeoutMs: 20000,
    // Ελαφρώς κάτω από το ύψος των ματιών, ώστε τα σήματα να «κάθονται» φυσικά.
    pitch: -4,
    // Ακριβής αντιστοίχιση πεδίων → κατεύθυνση → yaw (βλ. προδιαγραφή).
    signs: [
      { field: "360text1", label: "Μπροστά", yaw: 0 },
      { field: "360text2", label: "Δεξιά", yaw: 90 },
      { field: "360text3", label: "Πίσω", yaw: 180 },
      { field: "360text4", label: "Αριστερά", yaw: -90 }
    ]
  };

  // Πιθανά ονόματα του πεδίου με την πανοραμική εικόνα.
  var PANO_FIELD_CANDIDATES = [
    "360image", "field_360image", "image360", "360_image", "360photo", "pano360", "panorama"
  ];

  // ---- Επικοινωνία με τη γονική σελίδα (postMessage) -----------------------
  var EMBED = {
    source: "city4all-wall",       // τι στέλνει ο τοίχος
    parentSource: "city4all-parent", // τι περιμένει να λάβει
    // Προαιρετικό. Αν μείνει κενό, χρησιμοποιείται το origin του document.referrer,
    // αλλιώς "*" (αν η γονική σελίδα δεν στέλνει referrer).
    targetOrigin: "",
    // Προαιρετική λίστα με αποδεκτά origins για εισερχόμενα μηνύματα.
    // Αν είναι κενή, γίνεται έλεγχος με το targetOrigin.
    allowedOrigins: [],
    // Αν η γονική σελίδα ΔΕΝ υποστηρίζει το postMessage expansion (δεν απάντησε
    // "ready"), ο Τοίχος ζητά native fullscreen για το iframe του, ώστε η κάρτα
    // να πιάνει όλη την οθόνη χωρίς να φαίνεται τίποτα πίσω. Απαιτεί
    // allow="fullscreen" / allowfullscreen στο iframe.
    autoFullscreen: true,
    parentSupportsExpand: false,
    nativeFullscreen: false
  };

  var PLACEHOLDER_SVG =
    '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
    '<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 19.5h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zM8.25 9.75a1.125 1.125 0 100-2.25 1.125 1.125 0 000 2.25zM21 15l-5.16-5.16a2.25 2.25 0 00-3.18 0L3 18.75"/>' +
    "</svg>";

  // Απλό, στρογγυλό information sign ⓘ
  var INFO_SVG =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9.1" stroke="currentColor" stroke-width="1.7"/>' +
    '<circle cx="12" cy="8" r="1.15" fill="currentColor"/>' +
    '<path d="M12 11v5.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>' +
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
    var wanted = String(name).toLowerCase();
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

  /* --- Αναγνώριση πραγματικών ονομάτων πεδίων (name ή alias) -------------- */

  function normKey(value) {
    return String(value == null ? "" : value).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  // Επιστρέφει το πραγματικό όνομα πεδίου (attributes key) που αντιστοιχεί σε
  // ένα από τα ζητούμενα ονόματα, ελέγχοντας και το alias του layer.
  function resolveFieldKey(fields, candidates) {
    var cands = candidates.map(normKey).filter(Boolean);
    if (!cands.length) return null;

    var entries = (fields || [])
      .filter(function (f) { return f && f.name; })
      .map(function (f) { return { name: f.name, probes: [f.name, f.alias] }; });

    // 1) Ακριβής αντιστοίχιση σε name ή alias.
    for (var i = 0; i < entries.length; i++) {
      for (var p = 0; p < entries[i].probes.length; p++) {
        if (cands.indexOf(normKey(entries[i].probes[p])) !== -1) return entries[i].name;
      }
    }

    // 2) Το Survey123 συχνά προσθέτει prefix (π.χ. field_360text1).
    for (var j = 0; j < entries.length; j++) {
      var probes = entries[j].probes.map(normKey);
      for (var c = 0; c < cands.length; c++) {
        if (cands[c].length < 4) continue;
        for (var q = 0; q < probes.length; q++) {
          if (probes[q] && probes[q].indexOf(cands[c]) !== -1) return entries[j].name;
        }
      }
    }

    return null;
  }

  // Χάρτης πεδίων 360° για το συγκεκριμένο layer.
  function buildPanoKeyMap(fields) {
    return {
      image: resolveFieldKey(fields, PANO_FIELD_CANDIDATES),
      texts: PANO.signs.map(function (def) {
        return resolveFieldKey(fields, [def.field, "field_" + def.field, def.field + "_field"]);
      })
    };
  }

  // Διαβάζει τιμή 360° πεδίου: πρώτα με το πραγματικό όνομα, μετά με τα πιθανά.
  function readPanoField(attrs, resolvedKey, candidates) {
    if (resolvedKey) {
      var direct = getField(attrs, resolvedKey);
      if (direct != null && String(direct).trim() !== "") return String(direct).trim();
    }
    return pick(attrs, candidates);
  }

  /* --- Attachments -------------------------------------------------------- */

  // Επιστρέφει ΟΛΑ τα image attachments με metadata, ώστε να ξεχωρίζει η
  // πανοραμική εικόνα από τις κανονικές φωτογραφίες.
  async function fetchAttachments(layerUrl, objectId, signal) {
    try {
      var base = layerUrl + "/" + objectId + "/attachments";
      var data = await fetchJson(withToken(base + "?f=json"), signal);
      return (data.attachmentInfos || [])
        .filter(function (a) {
          return String(a.contentType || "").toLowerCase().indexOf("image/") === 0;
        })
        .map(function (a) {
          return {
            id: a.id,
            name: String(a.name || ""),
            size: Number(a.size) || 0,
            contentType: String(a.contentType || ""),
            // Το Survey123 σημαίνει την πανοραμική εικόνα με keyword,
            // π.χ. "_360_image". Είναι ο πιο αξιόπιστος δείκτης.
            keywords: String(a.keywords || ""),
            url: withToken(base + "/" + a.id)
          };
        });
    } catch (err) {
      if (err.name === "AbortError") throw err;
      return []; // μια αποτυχημένη αναζήτηση φωτογραφιών δεν χαλάει όλο τον τοίχο
    }
  }

  // Η τιμή του πεδίου μπορεί να είναι URL, όνομα αρχείου ή απλό κείμενο.
  function attachmentValue(raw) {
    if (raw == null) return "";
    if (typeof raw === "string") return raw.trim();
    if (typeof raw === "object") {
      return String(raw.url || raw.href || raw.name || raw.filename || "").trim();
    }
    return String(raw).trim();
  }

  // Επιλέγει ΜΟΝΟ το attachment της πανοραμικής εικόνας αυτού του record.
  function pickPanorama(attachments, rawValue) {
    var value = attachmentValue(rawValue);

    // 1) Το πεδίο περιέχει έτοιμο URL (παλιά δεδομένα / hosted layer).
    //    Δεν χρειάζεται attachment γι' αυτό.
    if (value && /^https?:\/\//i.test(value)) {
      var direct = normalizeUrl(value);
      if (direct) {
        return { id: "external", name: "360", size: 0, contentType: "image/*", url: withToken(direct) };
      }
    }

    if (!attachments || !attachments.length) return null;

    // 2) Το πεδίο περιέχει το όνομα του αρχείου που ανέβηκε.
    if (value) {
      var baseName = value.split(/[\\/]/).pop().toLowerCase();
      var byExact = attachments.find(function (a) {
        return a.name.toLowerCase() === baseName;
      });
      if (byExact) return byExact;

      var byPartial = attachments.find(function (a) {
        var n = a.name.toLowerCase();
        return n && (n.indexOf(baseName) !== -1 || (baseName.length > 4 && baseName.indexOf(n) !== -1));
      });
      if (byPartial) return byPartial;
    }

    // 3) Το Survey123 keyword ή το όνομα του attachment δηλώνει πανοράμα.
    var byKeyword = attachments.find(function (a) {
      return /(^|[^a-z0-9])(360[\s_-]?(image|photo|pano)|pano|panorama|equirect|photosphere|sphere)([^a-z0-9]|$)/i.test(
        a.keywords + " " + a.name
      );
    });
    if (byKeyword) return byKeyword;

    // 4) Το πεδίο 360image είναι συμπληρωμένο αλλά το όνομα διαφέρει:
    //    η μεγαλύτερη εικόνα είναι η πανοραμική.
    if (value) {
      return attachments.slice().sort(function (a, b) { return b.size - a.size; })[0];
    }

    return null;
  }

  async function loadFromLayer(layerUrl, signal) {
    // outSR=4326: οι συντεταγμένες επιστρέφονται ως γεωγραφικό μήκος/πλάτος.
    var data = await fetchJson(withToken(layerUrl + "/query?where=1%3D1&outFields=*&outSR=4326&f=json"), signal);

    var fields = data.fields || [];
    var oidField = data.objectIdFieldName;
    if (!oidField) {
      var oidDef = fields.find(function (f) {
        return f.type === "esriFieldTypeOID";
      });
      oidField = oidDef ? oidDef.name : "OBJECTID";
    }

    var keyMap = buildPanoKeyMap(fields);

    var records = (data.features || []).filter(function (f) {
      var a = f.attributes || {};
      return getField(a, oidField) != null && pick(a, FIELD_NAMES.name);
    });

    return Promise.all(
      records.map(async function (feature) {
        var attrs = feature.attributes;
        var objectId = getField(attrs, oidField);

        var attachments = await fetchAttachments(layerUrl, objectId, signal);
        var panoAttachment = pickPanorama(
          attachments,
          readPanoField(attrs, keyMap.image, PANO_FIELD_CANDIDATES)
        );

        // Οι κανονικές φωτογραφίες δεν περιλαμβάνουν την πανοραμική.
        var photos = attachments
          .filter(function (a) { return !panoAttachment || a.id !== panoAttachment.id; })
          .slice(0, MAX_IMAGES)
          .map(function (a) { return a.url; });

        var hotspots = PANO.signs
          .map(function (def, index) {
            var text = readPanoField(attrs, keyMap.texts[index], [def.field, "field_" + def.field]);
            if (!text) return null;
            return {
              index: index,
              label: def.label,
              yaw: def.yaw,
              pitch: PANO.pitch,
              text: text
            };
          })
          .filter(Boolean);

        var location = findLocation(attrs);
        var coords = readCoords(feature.geometry);

        // Εφεδρικός υποψήφιος, όταν το πεδίο 360image δεν υπάρχει/είναι κενό:
        // η μεγαλύτερη εικόνα. Επιβεβαιώνεται ως πανοραμική μόνο αν ο λόγος
        // διαστάσεων είναι ~2:1 (βλ. isEquirectangular).
        var panoGuess = "";
        if (!panoAttachment && attachments.length) {
          panoGuess = attachments.slice().sort(function (a, b) { return b.size - a.size; })[0].url;
        }

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
          images: photos,
          pano: panoAttachment ? { url: panoAttachment.url, hotspots: hotspots } : null,
          // Τα κείμενα ισχύουν και όταν το πανόραμα βρεθεί εφεδρικά.
          panoHotspots: hotspots,
          panoGuess: panoGuess
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
  /*  360° — ΚΕΝΤΡΙΚΟΣ PANNELLUM VIEWER                                       */
  /* ------------------------------------------------------------------------ */

  var panoHost = byId("c4a-pano-host");
  var panoStateEl = byId("c4a-pano-state");
  var panoTitleEl = byId("c4a-pano-title");
  var panoTextEl = byId("c4a-pano-text");
  var panoRetryBtn = byId("c4a-pano-retry");
  var legacyLink = byId("c4a-newtab");

  var viewer = null;        // ΜΟΝΟ ένας viewer κάθε φορά
  var viewerToken = 0;      // ακυρώνει ασύγχρονες απαντήσεις παλιών επιχειρήσεων
  var panoHotspots = [];    // hotspots του ενεργού viewer
  var activeSign = null;
  var popupEl = null;
  var popupBodyEl = null;
  var popupLabelEl = null;
  var libPromise = null;

  function showPanoState(kind, title, text, retry) {
    panoStateEl.hidden = false;
    panoStateEl.className = "pano__state pano__state--" + kind;
    panoTitleEl.textContent = title || "";
    panoTextEl.textContent = text || "";
    panoRetryBtn.hidden = !retry;
  }

  function hidePanoState() {
    panoStateEl.hidden = true;
  }

  function exitNativeFullscreen() {
    try {
      var el = document.fullscreenElement || document.webkitFullscreenElement;
      if (!el) return;
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (e) { /* αγνοείται */ }
  }

  function destroyViewer() {
    activeSign = null;
    popupEl = null;
    popupBodyEl = null;
    popupLabelEl = null;
    panoHotspots = [];

    if (viewer) {
      try { viewer.destroy(); } catch (e) { /* αγνοείται */ }
      viewer = null;
    }
    if (panoHost) panoHost.replaceChildren();
  }

  /* --- Φόρτωση Pannellum (μία φορά, on demand) ---------------------------- */

  function ensurePannellum() {
    if (window.pannellum && typeof window.pannellum.viewer === "function") {
      return Promise.resolve();
    }
    if (libPromise) return libPromise;

    libPromise = new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        fail("timeout");
      }, PANO.libTimeoutMs);

      function fail(reason) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        libPromise = null;
        var err = new Error("pannellum " + reason);
        err.code = "lib";
        reject(err);
      }

      function done() {
        if (settled) return;
        if (!window.pannellum || typeof window.pannellum.viewer !== "function") {
          fail("missing");
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve();
      }

      if (!document.querySelector('link[data-c4a-pannellum]')) {
        var link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = PANO.css;
        link.setAttribute("data-c4a-pannellum", "css");
        document.head.appendChild(link);
      }

      var existing = document.querySelector('script[data-c4a-pannellum]');
      if (existing) {
        existing.addEventListener("load", done);
        existing.addEventListener("error", function () { fail("error"); });
        return;
      }

      var script = document.createElement("script");
      script.src = PANO.js;
      script.async = true;
      script.setAttribute("data-c4a-pannellum", "js");
      script.addEventListener("load", done);
      script.addEventListener("error", function () { fail("error"); });
      document.head.appendChild(script);
    });

    return libPromise;
  }

  // Προφόρτωση της εικόνας: πιάνει 404 / δίκτυο / μη έγκυρο αρχείο πριν
  // δημιουργηθεί ο viewer, ώστε να μη μείνει ποτέ άδειο ή σπασμένο πλαίσιο.
  function preloadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        img.src = "";
        var err = new Error("image timeout");
        err.code = "image";
        reject(err);
      }, PANO.imageTimeoutMs);

      img.onload = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({
          width: img.naturalWidth || img.width || 0,
          height: img.naturalHeight || img.height || 0
        });
      };
      img.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        var err = new Error("image error");
        err.code = "image";
        reject(err);
      };
      img.src = url;
    });
  }

  /* --- Σήματα πληροφοριών ------------------------------------------------ */

  // createTooltipFunc του Pannellum: χτίζει το στρογγυλό σήμα ⓘ του hotspot.
  function createSignElement(hotspotDiv, args) {
    var sign = document.createElement("button");
    sign.type = "button";
    sign.className = "c4a-sign";
    sign.setAttribute("data-sign-index", String(args.index));
    sign.setAttribute("aria-label", "Πληροφορίες: " + args.label);
    sign.setAttribute("title", "Πληροφορίες: " + args.label);
    sign.innerHTML = INFO_SVG; // στατικό SVG, χωρίς δεδομένα χρήστη

    // Το κλικ δεν φτάνει στο hotspot div (άρα δεν υπάρχει διπλό άνοιγμα)
    // και δεν ξεκινά σύρσιμο του πανοράματος.
    sign.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleSign(args.index);
    });
    sign.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    sign.addEventListener("touchstart", function (e) { e.stopPropagation(); }, { passive: true });
    sign.addEventListener("keydown", function (e) { e.stopPropagation(); });

    hotspotDiv.appendChild(sign);
  }

  // Μια ισοδύναμη (equirectangular) πανοραμική εικόνα έχει λόγο ~2:1.
  function isEquirectangular(dim) {
    if (!dim || !dim.width || !dim.height) return true; // άγνωστες διαστάσεις: δεν μπλοκάρουμε
    var ratio = dim.width / dim.height;
    return ratio >= 1.85 && ratio <= 2.15;
  }

  function buildHotspots(pano) {
    return (pano.hotspots || []).map(function (hs) {
      return {
        id: "c4a-sign-" + hs.index,
        pitch: hs.pitch,
        yaw: hs.yaw,
        type: "info",
        cssClass: "c4a-hotspot",
        createTooltipFunc: createSignElement,
        createTooltipArgs: { index: hs.index, label: hs.label }
      };
    });
  }

  /* --- Παράθυρο πληροφοριών (μέσα στο container του Pannellum) ----------- */

  function installPopup(container) {
    var pop = make("div", "c4a-pop");
    pop.hidden = true;
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-modal", "false");
    pop.setAttribute("aria-label", "Πληροφορίες σήματος");

    var head = make("div", "c4a-pop__head");
    var label = make("span", "c4a-pop__label");
    var close = make("button", "c4a-pop__close", "\u00d7");
    close.type = "button";
    close.setAttribute("aria-label", "Κλείσιμο πληροφοριών");
    head.appendChild(label);
    head.appendChild(close);

    var body = make("div", "c4a-pop__body");
    body.id = "c4a-sign-panel-body";

    pop.appendChild(head);
    pop.appendChild(body);
    container.appendChild(pop);

    // Το παράθυρο δεν πρέπει να μετακινεί/ζουμάρει το πανόραμα.
    ["pointerdown", "mousedown", "touchstart", "touchmove", "wheel", "click", "dblclick"].forEach(function (type) {
      pop.addEventListener(type, function (e) {
        e.stopPropagation();
      }, type === "wheel" || type === "touchmove" ? { passive: true } : false);
    });

    close.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeSign();
    });

    popupEl = pop;
    popupLabelEl = label;
    popupBodyEl = body;
  }

  function markSigns() {
    if (!viewer) return;
    var container = viewer.getContainer();
    if (!container) return;
    var signs = container.querySelectorAll(".c4a-sign");
    Array.prototype.forEach.call(signs, function (el) {
      var index = Number(el.getAttribute("data-sign-index"));
      el.classList.toggle("is-active", activeSign === index);
      el.setAttribute("aria-expanded", String(activeSign === index));
    });
  }

  function toggleSign(index) {
    if (!viewer || !popupEl) return;
    var hs = panoHotspots[index];
    if (!hs) return;

    if (activeSign === index && !popupEl.hidden) {
      closeSign();
      return;
    }

    popupLabelEl.textContent = "Πληροφορίες · " + hs.label;
    popupBodyEl.textContent = hs.text;
    popupBodyEl.scrollTop = 0;
    popupEl.hidden = false;
    activeSign = index;
    markSigns();
  }

  function closeSign() {
    if (!popupEl) return;
    popupEl.hidden = true;
    popupBodyEl.textContent = "";
    activeSign = null;
    markSigns();
  }

  /* --- Δημιουργία / επαναχρήση του viewer -------------------------------- */

  function buildViewer(pano, token) {
    if (token !== viewerToken) return;

    try {
      viewer = window.pannellum.viewer(panoHost, {
        type: "equirectangular",
        panorama: pano.url,
        autoLoad: true,
        compass: false,
        showZoomCtrl: true,
        showFullscreenCtrl: true,
        mouseZoom: true,
        draggable: true,
        hfov: 100,
        minHfov: 45,
        maxHfov: 120,
        friction: 0.15,
        strings: {
          loadingLabel: "Φόρτωση 360° χώρου…",
          fullscreen: "Πλήρης οθόνη",
          zoomIn: "Μεγέθυνση",
          zoomOut: "Σμίκρυνση"
        },
        hotSpots: buildHotspots(pano)
      });
    } catch (e) {
      destroyViewer();
      showPanoState(
        "error",
        "Δεν φορτώθηκε ο 360° χώρος",
        "Η προβολή δεν μπόρεσε να ξεκινήσει. Δοκιμάστε ξανά.",
        true
      );
      return;
    }

    panoHotspots = (pano.hotspots || []).slice();

    var container = viewer.getContainer();
    if (!container) {
      destroyViewer();
      showPanoState(
        "error",
        "Δεν φορτώθηκε ο 360° χώρος",
        "Η προβολή δεν μπόρεσε να ξεκινήσει. Δοκιμάστε ξανά.",
        true
      );
      return;
    }
    installPopup(container);

    var loaded = false;
    var loadTimer = setTimeout(function () {
      if (loaded || token !== viewerToken) return;
      destroyViewer();
      showPanoState(
        "error",
        "Δεν φορτώθηκε η πανοραμική εικόνα",
        "Η εικόνα άργησε να φορτώσει. Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά.",
        true
      );
    }, PANO.loadTimeoutMs);

    viewer.on("load", function () {
      if (token !== viewerToken) return;
      loaded = true;
      clearTimeout(loadTimer);
      hidePanoState();
    });

    // Το Pannellum μπορεί να αναφέρει σφάλμα εικόνας και μόνο του.
    try {
      viewer.on("error", function () {
        if (loaded || token !== viewerToken) return;
        clearTimeout(loadTimer);
        destroyViewer();
        showPanoState(
          "error",
          "Δεν φορτώθηκε η πανοραμική εικόνα",
          "Το αρχείο δεν είναι έγκυρη πανοραμική εικόνα ή δεν είναι προσβάσιμο.",
          true
        );
      });
    } catch (e) { /* παλιές εκδόσεις Pannellum χωρίς event */ }
  }

  function openPanorama(pano, tentative) {
    var token = ++viewerToken;
    destroyViewer();

    if (!pano || !pano.url) {
      showPanoState(
        "empty",
        "Δεν υπάρχει 360° χώρος",
        "Η επιχείρηση δεν έχει ακόμα διαθέσιμη πανοραμική εικόνα 360°.",
        false
      );
      return;
    }

    showPanoState("loading", "Φόρτωση 360° χώρου…", "Η πανοραμική εικόνα φορτώνεται.", false);

    ensurePannellum()
      .then(function () {
        if (token !== viewerToken) return null;
        return preloadImage(pano.url);
      })
      .then(function (dim) {
        if (token !== viewerToken) return;
        if (tentative && !isEquirectangular(dim)) {
          // Η μεγαλύτερη εικόνα δεν είναι πανοραμική 2:1 — δεν την προβάλλουμε.
          destroyViewer();
          showPanoState(
            "empty",
            "Δεν υπάρχει 360° χώρος",
            "Η επιχείρηση δεν έχει ακόμα διαθέσιμη πανοραμική εικόνα 360°.",
            false
          );
          return;
        }
        buildViewer(pano, token);
      })
      .catch(function (err) {
        if (token !== viewerToken) return;
        if (err && err.code === "lib") {
          showPanoState(
            "error",
            "Ο 360° χώρος δεν είναι διαθέσιμος",
            "Δεν φορτώθηκε η βιβλιοθήκη προβολής. Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά.",
            true
          );
        } else if (err && err.code === "image") {
          showPanoState(
            "error",
            "Δεν φορτώθηκε η πανοραμική εικόνα",
            "Η εικόνα δεν είναι διαθέσιμη ή δεν είναι έγκυρη πανοραμική λήψη.",
            true
          );
        } else {
          showPanoState(
            "error",
            "Δεν φορτώθηκε ο 360° χώρος",
            "Κάτι πήγε στραβά κατά τη φόρτωση. Δοκιμάστε ξανά.",
            true
          );
        }
      });
  }

  /* ------------------------------------------------------------------------ */
  /*  MODAL (Επισκόπηση + 360° καρτέλα)                                       */
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
  var accessText = byId("c4a-access-text");
  var siteLink = byId("c4a-site");
  var emptyEl = byId("c4a-empty");

  var lastTrigger = null;
  var currentBusiness = null;
  var currentTab = "info";

  // Η προσβασιμότητα εμφανίζεται ως κείμενο (οι αλλαγές γραμμής διατηρούνται).
  function renderAccessibility(text) {
    var value = String(text || "").trim();
    accessText.textContent = value;
    return value ? 1 : 0;
  }

  function resizeViewerSoon() {
    if (!viewer) return;
    setTimeout(function () {
      if (!viewer) return;
      try { viewer.resize(); } catch (e) { /* αγνοείται */ }
    }, 90);
  }

  function stop3d() {
    viewerToken++; // ακυρώνει εκκρεμείς φορτώσεις
    destroyViewer();
    popupEl = null;
    hidePanoState();
  }

  function start3d(business) {
    if (!business) return;

    if (business.xrLink) {
      legacyLink.href = business.xrLink;
      legacyLink.hidden = false;
    } else {
      legacyLink.hidden = true;
      legacyLink.removeAttribute("href");
    }

    if (business.pano) {
      openPanorama(business.pano, false);
    } else if (business.panoGuess) {
      // Εφεδρικός έλεγχος: το πεδίο 360image λείπει, αλλά ίσως η πανοραμική
      // εικόνα είναι το μεγαλύτερο attachment. Επιβεβαιώνεται πριν προβληθεί.
      openPanorama({ url: business.panoGuess, hotspots: business.panoHotspots || [] }, true);
    } else {
      destroyViewer();
      showPanoState(
        "empty",
        "Δεν υπάρχει 360° χώρος",
        "Η επιχείρηση δεν έχει ακόμα διαθέσιμη πανοραμική εικόνα 360°." +
          (business.xrLink ? " Μπορείτε να ανοίξετε τον παλιό 3D χώρο από τον σύνδεσμο παρακάτω." : ""),
        false
      );
    }
  }

  function selectTab(which, moveFocus) {
    var is3d = which === "3d";
    currentTab = which;

    tabInfo.setAttribute("aria-selected", String(!is3d));
    tabInfo.tabIndex = is3d ? -1 : 0;
    tab3d.setAttribute("aria-selected", String(is3d));
    tab3d.tabIndex = is3d ? 0 : -1;
    panelInfo.hidden = is3d;
    panel3d.hidden = !is3d;

    modal.classList.toggle("modal--immersive", is3d);

    // Ο viewer υπάρχει μόνο όσο είναι ανοιχτή η καρτέλα 360°.
    if (is3d) start3d(currentBusiness);
    else stop3d();

    resizeViewerSoon();
    if (moveFocus) (is3d ? tab3d : tabInfo).focus();
  }

  tabInfo.addEventListener("click", function () {
    if (currentTab === "info") return;
    selectTab("info", false);
  });
  tab3d.addEventListener("click", function () {
    if (currentTab === "3d") return; // ίδια καρτέλα: μη ξαναδημιουργείς viewer
    selectTab("3d", false);
  });
  tabsEl.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      var go3d = e.key === "ArrowRight" || e.key === "End";
      selectTab(go3d ? "3d" : "info", true);
    }
  });

  /* --------------------- Επικοινωνία με τη γονική σελίδα ------------------ */

  function isEmbedded() {
    try {
      return window.parent && window.parent !== window;
    } catch (e) {
      return false;
    }
  }

  function parentTargetOrigin() {
    if (EMBED.targetOrigin) return EMBED.targetOrigin;
    try {
      if (document.referrer) return new URL(document.referrer).origin;
    } catch (e) { /* αγνοείται */ }
    return "*";
  }

  // Ελέγχει το origin των μηνυμάτων που έρχονται από τη γονική σελίδα.
  // Αν το origin της γονικής σελίδας δεν είναι γνωστό (π.χ. έχει κρύψει το
  // referrer), δεχόμαστε μόνο same-origin μηνύματα — ποτέ «άγνωστο» origin.
  function originAllowed(origin) {
    if (EMBED.allowedOrigins.length) return EMBED.allowedOrigins.indexOf(origin) !== -1;
    var target = parentTargetOrigin();
    if (target === "*") {
      try { return origin === window.location.origin; } catch (e) { return false; }
    }
    return origin === target;
  }

  function postToParent(type) {
    if (!isEmbedded()) return;
    try {
      window.parent.postMessage(
        { source: EMBED.source, type: type, version: 1 },
        parentTargetOrigin()
      );
    } catch (e) { /* αγνοείται */ }
  }

  // Fallback: native fullscreen του iframe, όταν η γονική σελίδα δεν έχει
  // ενσωματώσει το expansion code. Καλείται ΜΕΣΑ στο κλικ (user gesture),
  // αλλιώς ο browser απορρίπτει το αίτημα.
  function requestNativeFullscreen() {
    if (!EMBED.autoFullscreen) return;
    if (!isEmbedded() || EMBED.parentSupportsExpand) return;
    if (!document.fullscreenEnabled) return;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    var el = document.documentElement;
    try {
      var result = el.requestFullscreen ? el.requestFullscreen() : null;
      if (result && typeof result.catch === "function") result.catch(function () {});
      EMBED.nativeFullscreen = true;
    } catch (e) { /* ο browser το απέρριψε — μένει το modal μέσα στο iframe */ }
  }

  function exitNativeFullscreenIfOurs() {
    if (!EMBED.nativeFullscreen) return;
    EMBED.nativeFullscreen = false;
    try {
      if (document.fullscreenElement === document.documentElement && document.exitFullscreen) {
        var result = document.exitFullscreen();
        if (result && typeof result.catch === "function") result.catch(function () {});
      }
    } catch (e) { /* αγνοείται */ }
  }

  window.addEventListener("message", function (e) {
    if (!e.data || e.data.source !== EMBED.parentSource) return;
    if (!originAllowed(e.origin)) return;
    if (e.data.type === "ready") {
      // Η γονική σελίδα έχει το expansion code (parent-embed.html).
      EMBED.parentSupportsExpand = true;
      document.documentElement.classList.add("has-parent-expand");
    } else if (e.data.type === "expanded") {
      document.documentElement.classList.add("is-embedded-expanded");
      resizeViewerSoon();
    } else if (e.data.type === "collapsed") {
      document.documentElement.classList.remove("is-embedded-expanded");
      resizeViewerSoon();
    } else if (e.data.type === "request-close") {
      // Προαιρετικό: η γονική σελίδα ζητά κλείσιμο (π.χ. Escape στη σελίδα).
      closeModal();
    }
  });

  // Το native fullscreen αλλάζει το μέγεθος του container.
  ["fullscreenchange", "webkitfullscreenchange"].forEach(function (evt) {
    document.addEventListener(evt, function () {
      resizeViewerSoon();
      setTimeout(resizeViewerSoon, 260);
    });
  });

  /* ------------------------------- Άνοιγμα ------------------------------- */

  function openModal(business, trigger) {
    lastTrigger = trigger || null;
    currentBusiness = business;
    currentTab = "info";

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

    // Καρτέλα 360°: εμφανίζεται μόνο αν υπάρχει πανόραμα ή παλιός 3D σύνδεσμος
    tabsEl.hidden = !(business.pano || business.xrLink);

    legacyLink.hidden = !business.xrLink;
    if (business.xrLink) legacyLink.href = business.xrLink;
    else legacyLink.removeAttribute("href");

    modal.hidden = false;
    modal.classList.add("modal--expanded");
    document.body.classList.add("modal-open");

    // Ζητά από τη γονική σελίδα να μεγαλώσει το iframe σε όλο το viewport.
    // Αν δεν υπάρχει τέτοια ενσωμάτωση, ζητά native fullscreen (idle fallback).
    postToParent("expand");
    requestNativeFullscreen();

    selectTab("info", false);
    closeBtn.focus();
  }

  function closeModal() {
    if (modal.hidden) return;

    // Αν ο χρήστης είναι σε native fullscreen, βγαίνουμε πρώτα από αυτό.
    exitNativeFullscreenIfOurs();
    exitNativeFullscreen();

    stop3d();
    modal.hidden = true;
    modal.classList.remove("modal--immersive");
    modal.classList.remove("modal--expanded");
    document.body.classList.remove("modal-open");
    clearList(modalTimers);
    banner.replaceChildren();
    currentBusiness = null;

    // Ενημερώνει τη γονική σελίδα να επαναφέρει το iframe.
    postToParent("collapse");

    if (lastTrigger && typeof lastTrigger.focus === "function") lastTrigger.focus();
    lastTrigger = null;
  }

  closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeModal(); // κλικ στο σκοτεινό φόντο
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    // Στο native fullscreen το Escape κλείνει μόνο την πλήρη οθόνη.
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    closeModal();
  });

  panoRetryBtn.addEventListener("click", function () {
    if (currentBusiness) start3d(currentBusiness);
  });

  /* ------------------------------------------------------------------------ */
  /*  ΕΚΚΙΝΗΣΗ                                                                */
  /* ------------------------------------------------------------------------ */

  // Ρωτάει τη γονική σελίδα αν υποστηρίζει expansion (parent-embed.html).
  postToParent("handshake");

  ["fullscreenchange", "webkitfullscreenchange"].forEach(function (evt) {
    document.addEventListener(evt, function () {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        EMBED.nativeFullscreen = false;
      }
    });
  });

  loadWall();
})();
