/**
 * Military ID PWA — app.js
 *
 * Core flow on top of the original rpls.rest scripts.js logic (jQuery +
 * Hammer.js bottom-sheet swipes, popup management, marquee, navigation):
 *
 *   DOMContentLoaded
 *     ↓
 *   parseShortcode  → no shortcode → showError("Карта недоступна")
 *     ↓
 *   fetch /api/u/{shortcode}
 *     ├ 404 → showError("Картка не знайдена")
 *     ├ 403 → showError("Доступ заблоковано")
 *     └ 200 → renderCard(data) into DOM (idempotent)
 *               ↓
 *           Wait for the ORIGINAL 3-second loader to finish
 *           (passpage.js owns the loader → passpage transition;
 *            here we just decide whether passpage shows at all)
 *               ↓
 *           if pin_required → leave passpage flow to passpage.js
 *           else            → app.js triggers the unlock directly
 *
 * The rest of the file is verbatim-equivalent to rpls.rest scripts.js,
 * trimmed of behaviors that depend on assets we don't own and adapted
 * to use our API for the few places the original talked to a backend.
 */
(function ($) {
  "use strict";

  // ==========================================================================
  // 1. URL parsing
  // ==========================================================================

  function parseShortcode() {
    var m = window.location.pathname.match(/^\/u\/([A-Za-z0-9_-]{1,20})/);
    return m ? m[1] : null;
  }

  // ==========================================================================
  // 2. Error overlay (replaces the original happy-path 3-sec loader fadeOut)
  // ==========================================================================

  function showError(title, text) {
    var existing = document.getElementById("err-overlay");
    if (existing) existing.remove();

    // Also kill all other screens to avoid double-render.
    $(".loader, .passpage, .container, .overlay").hide();

    var div = document.createElement("div");
    div.id = "err-overlay";
    div.style.cssText = [
      "position:fixed", "inset:0", "z-index:99999",
      "background:#dfdeca", "display:flex",
      "flex-direction:column", "align-items:center", "justify-content:center",
      "padding:40px", "text-align:center",
      "font-family:'e-Ukraine',-apple-system,system-ui,sans-serif",
      "color:#222"
    ].join(";");
    div.innerHTML =
      '<div style="font-size:48px;margin-bottom:20px;">⚠️</div>' +
      '<div style="font-size:22px;font-weight:600;margin-bottom:10px;">' +
      escapeHtml(title) + "</div>" +
      '<div style="font-size:15px;color:#666;max-width:340px;line-height:1.4;">' +
      escapeHtml(text) + "</div>";
    document.body.appendChild(div);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ==========================================================================
  // 3. Card data fetch + render
  // ==========================================================================

  function fetchCard(shortcode) {
    return fetch("/api/u/" + encodeURIComponent(shortcode), {
      method: "GET",
      headers: { "Accept": "application/json" },
      credentials: "same-origin"
    }).then(function (r) {
      if (r.status === 200) return r.json();
      if (r.status === 404) throw { code: "not_found" };
      if (r.status === 403) {
        // Distinguish admin-block (access_blocked) from unsubscribed user
        // (subscription_required, added in Этап 11.11). Body is FastAPI's
        // {"detail": "<code>"} — we inspect, then throw a typed error.
        return r.json().then(function (body) {
          var detail = (body && body.detail) || "";
          if (detail === "subscription_required") {
            throw { code: "subscription_required" };
          }
          if (detail === "access_expired") {
            throw { code: "access_expired" };
          }
          throw { code: "blocked" };
        }, function () { throw { code: "blocked" }; });
      }
      throw { code: "server", status: r.status };
    });
  }

  function renderCard(data, shortcode) {
    var nameNodes = $(".data-footer .t1.name").toArray();
    var surname = $(".data-footer .t1.surname")[0];
    if (surname) surname.textContent = data.last_name || "";
    if (nameNodes[0]) nameNodes[0].textContent = data.first_name || "";
    if (nameNodes[1]) nameNodes[1].textContent = data.patronymic || "";

    // .data-section-2 → two .data-result: [0] birth_date, [1] deferral_until
    var dataResults = $(".data-section-2 .data-result").toArray();
    if (dataResults[0]) dataResults[0].textContent = data.birth_date || "—";
    if (dataResults[1]) dataResults[1].textContent = data.deferral_until || "—";

    // Photo: matches the rpls.rest convention — .user-photo is a <div>
    // with background-image (not an <img>). Sized + positioned via
    // style.css's `.user-photo { width:150px; height:190px; margin-top:15px }`,
    // which intentionally aligns with `.data-title { padding-top:15px }`
    // so the photo's top sits flush with the first label's cap-height.
    var photoEl = document.getElementById("user-photo");
    if (photoEl && data.photo_present) {
      photoEl.style.backgroundImage =
        "url('/api/u/" + encodeURIComponent(shortcode) + "/photo')";
      photoEl.style.display = "block";
    }

    // QR: replace placeholder src. Onerror: revert.
    if (data.qr_present) {
      var qrImg = $(".data-wrap2-qr img")[0];
      if (qrImg) {
        var fallback = qrImg.getAttribute("src");
        qrImg.onerror = function () { if (fallback) qrImg.src = fallback; };
        qrImg.src = "/api/u/" + encodeURIComponent(shortcode) + "/qr";
      }
    }

    // QR-back text: "QR-код дійсний до {deferral_until}"
    if (data.deferral_until) {
      var qrText = $(".data-wrap2-text")[0];
      if (qrText) qrText.textContent = "QR-код дійсний до " + data.deferral_until;
    }

    // Этап 19 — full-card POPUP fields. These used to be hardcoded in
    // index.html, so every user's expanded card showed the same identity.
    setPopupText("pp-surname", data.last_name);
    setPopupText("pp-first", data.first_name);
    setPopupText("pp-patronymic", data.patronymic);
    setPopupText("pp-birth", data.birth_date);
    setPopupText("pp-rnokpp", data.rnokpp);
    setPopupText("pp-deferral", data.deferral_until);
    setPopupText("pp-deferral-type", data.deferral_type);
    setPopupText("pp-vlk", data.vlk_decision);
    setPopupText("pp-vlk-date", data.vlk_date);
    setPopupText("pp-tck", data.tck);
    setPopupText("pp-rank", data.rank);
    setPopupText("pp-vos", data.vos);
    setPopupText("pp-specialty", data.specialty);
    setPopupText("pp-oberig", data.oberig_number);
    setPopupText("pp-phone", data.phone);
    setPopupText("pp-address", data.address);
    setPopupText("pp-data-updated", data.data_updated);

    // Marquee — repeat the "updated at" message so it scrolls infinitely.
    updateMarquee();
  }

  // Only overwrite when the API actually returned a value, so a missing field
  // leaves the existing markup instead of blanking the card.
  function setPopupText(id, value) {
    if (value === undefined || value === null || value === "") return;
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function updateMarquee() {
    var d = new Date();
    var ts = pad2(d.getHours()) + ":" + pad2(d.getMinutes()) +
      " | " + pad2(d.getDate()) + "." +
      pad2(d.getMonth() + 1) + "." + d.getFullYear();
    var s = "Документ оновлено о " + ts;
    var $content = $(".marquee .track .content");
    if ($content.length) {
      var parts = [];
      for (var i = 0; i < 8; i++) parts.push(s);
      $content.html("&nbsp; " + parts.join(" • &nbsp;") + " • &nbsp;");
    }
  }

  // ==========================================================================
  // 4. Boot — coordinate fetch + the 3-second loader
  // ==========================================================================

  /**
   * passpage.js handles the loader→passpage transition unconditionally
   * after 3 sec. If pin_required=false, we *intercept* that transition
   * (jump straight from loader to .container) and skip the PIN screen.
   *
   * Exposed contract for passpage.js:
   *   window.__shortcode        — shortcode string
   *   window.__cardData         — fetched PublicCard (or null until ready)
   *   window.__pinRequired      — bool (true → passpage takes over)
   *   window.__onPinSuccess()   — call AFTER successful PIN-check;
   *                               passpage.js invokes it.
   *   window.__skipPin()        — called by app.js when no PIN is needed;
   *                               passpage.js looks for this on its 3-sec
   *                               timer to decide what to fade in.
   */
  var bootState = { skipPin: false, dataReady: false };
  window.__bootState = bootState;

  function boot() {
    var shortcode = parseShortcode();
    if (!shortcode) {
      showError("Карта недоступна",
                "URL не містить shortcode. Очікую /u/{ваш_код}.");
      return;
    }
    window.__shortcode = shortcode;
    window.__cardData  = null;
    window.__pinRequired = false;

    fetchCard(shortcode)
      .then(function (data) {
        window.__cardData = data;
        window.__pinRequired = !!data.pin_required;
        bootState.skipPin = !data.pin_required;
        bootState.dataReady = true;
        // Render now — card is hidden by .container display:none, so user
        // doesn't see it. When passpage.js fades container in, fields are
        // already populated → no flash of stale "Головко Сергий".
        renderCard(data, shortcode);
      })
      .catch(function (err) {
        if (err && err.code === "not_found") {
          showError("Картка не знайдена",
                    "Користувача за вказаним кодом не існує.");
        } else if (err && err.code === "subscription_required") {
          showError("🔴 Доступ призупинено",
                    "Цей користувач втратив підписку на канали. " +
                    "Картка тимчасово недоступна.");
        } else if (err && err.code === "access_expired") {
          showError("⏳ Доступ закінчився",
                    "Безкоштовний період завершився. Запроси друзів " +
                    "у боті — і картка знову запрацює.");
        } else if (err && err.code === "blocked") {
          showError("Доступ заблоковано", "Зверніться до підтримки.");
        } else {
          showError("Помилка сервера", "Спробуйте оновити сторінку.");
        }
      });
  }

  // ==========================================================================
  // 5. Replays of the original rpls.rest scripts.js behavior
  // ==========================================================================

  // 5.1 Loader 3-sec → swap body bg to beige.
  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(function () {
      document.body.style.backgroundColor = "#dfdeca";
    }, 3000);
    // NOTE: hiding .loader is done by passpage.js; we only repaint body.
  });

  // 5.2 m_Copydevice — "active" 3 sec to flash "copied" state.
  $(document).on("click", ".m_Copydevice", function () {
    var el = $(this);
    el.addClass("active");
    setTimeout(function () { el.removeClass("active"); }, 3000);
  });

  // 5.3 setWrapWidth — keep .wrap/.wrap2 = viewport - 64px on resize.
  function setWrapWidth() {
    var w = $(window).width() - 64;
    if (w < 0) w = 0;
    $(".wrap, .wrap2").css("width", w + "px");
  }
  $(document).ready(setWrapWidth);
  $(window).on("resize", setWrapWidth);

  // 5.4 flipCard — Hammer swipeleft/swiperight + click on .wrap-flipcard.
  $(document).ready(function () {
    function flipCard() {
      $(".wrap-flipcard").toggleClass("flipped");
    }
    // Expose global for the inline `onclick="flipCard()"` in HTML.
    window.flipCard = flipCard;
    var wf = $(".wrap-flipcard")[0];
    if (wf && typeof Hammer !== "undefined") {
      var hammer = new Hammer(wf);
      hammer.on("swipeleft swiperight", function () { flipCard(); });
    }
  });

  // 5.5 Bottom-nav popups + active-tab toggle.
  $(document).ready(function () {
    $(".menu").on("click", function () {
      $(".popup-menu").fadeIn(100);
      $(".popup-vac").fadeOut(100);
      $(".popup-services").fadeOut(100);
    });
    $(".services").on("click", function () {
      $(".popup-services").fadeIn(100);
      $(".popup-menu").fadeOut(100);
      $(".popup-vac").fadeOut(100);
    });
    $(".vacancies").on("click", function () {
      $(".popup-vac").fadeIn(100);
      $(".popup-menu").fadeOut(100);
      $(".popup-services").fadeOut(100);
    });
    $(".mydoc").on("click", function () {
      $(".popup-menu, .popup-services, .popup-vac").fadeOut(100);
    });
    $(".nav").on("click", function () {
      $(".nav").removeClass("active");
      $(this).addClass("active");
    });
  });

  // 5.6 popup-fullmenu swipedown to close + .link-menu (+) opens it.
  $(document).ready(function () {
    var popup = $(".popup-fullmenu")[0];
    if (popup && typeof Hammer !== "undefined") {
      var hm = new Hammer(popup);
      hm.get("swipe").set({ direction: Hammer.DIRECTION_DOWN });
      hm.on("swipedown", closeAllFullmenus);
    }
    $(".link-menu").on("click", function (e) {
      e.stopPropagation();
      $(".overlay").fadeIn();
      $(".popup-fullmenu").addClass("active");
    });
    $("#menu-1").on("click", function (e) {
      e.stopPropagation();
      $(".overlay").fadeIn();
      $(".popup-fullmenu").removeClass("active");
      $(".popup-fullmenu-1").addClass("active");
    });
    $("#menu-3").on("click", function (e) {
      e.stopPropagation();
      $(".overlay").fadeIn();
      $(".popup-fullmenu").removeClass("active");
      $(".popup-fullscreen-3").addClass("active");
    });
    $(".overlay").on("click", closeAllFullmenus);
  });

  function closeAllFullmenus() {
    $(".popup-fullmenu, .popup-fullmenu-1, .popup-fullmenu-2, " +
      ".popup-fullmenu-3, .popup-fullmenu-4, .popup-fullmenu-5, " +
      ".popup-fullmenu-6").removeClass("active");
    $(".overlay").fadeOut();
  }

  // 5.7 #qrdateto — fallback (DOM may be missing; renderCard already sets
  //                 .data-wrap2-text from API deferral_until).
  $(function () {
    var months = [
      "січня", "лютого", "березня", "квітня", "травня", "червня",
      "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"
    ];
    var d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    var formatted = d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
    $("#qrdateto").text(formatted);
  });

  // 5.8 .lock — show #topNotice toast for 2 sec.
  $(document).on("click", ".lock", function () {
    var $n = $("#topNotice");
    $n.addClass("active");
    setTimeout(function () { $n.removeClass("active"); }, 2000);
  });

  // 5.9 Notification list — random dates -1..-3 days, hh:mm random.
  $(document).ready(function () {
    var items = $(".list-notification li");
    var cur = new Date();
    items.each(function (index) {
      if (index === 0) {
        cur = new Date();
        cur.setHours(cur.getHours() - 5);
      } else {
        var minusDays = Math.floor(Math.random() * 3) + 1;
        cur.setDate(cur.getDate() - minusDays);
        cur.setHours(Math.floor(Math.random() * 24));
        cur.setMinutes(Math.floor(Math.random() * 60));
      }
      var dd = pad2(cur.getDate());
      var mm = pad2(cur.getMonth() + 1);
      var hh = pad2(cur.getHours());
      var min = pad2(cur.getMinutes());
      $(this).find(".not-time").text(
        dd + "." + mm + "." + cur.getFullYear() + " о " + hh + ":" + min
      );
    });
  });

  // 5.10 popup-fullscreen openers/closers for #menu-N + named items.
  jQuery(function ($) {
    $("#menu-3").on("click", function (e) {
      e.preventDefault();
      $(".popup-fullmenu").removeClass("active");
      $(".overlay").hide();
      $(".popup-fullscreen-3").show();
    });
    $(document).on("click", ".popup-fullscreen-3 .popup-fullscreen-close",
      function (e) { e.preventDefault(); $(".popup-fullscreen-3").hide(); });

    $("#menu-7").on("click", function (e) {
      e.preventDefault();
      $(".popup-fullmenu").removeClass("active");
      $(".overlay").hide();
      $(".popup-fullscreen-4").show();
    });
    $(document).on("click", ".popup-fullscreen-4 .popup-fullscreen-close",
      function (e) { e.preventDefault(); $(".popup-fullscreen-4").hide(); });

    $("#menu-4").on("click", function (e) {
      e.preventDefault();
      $(".popup-fullmenu").removeClass("active");
      $(".overlay").hide();
      $(".popup-fullscreen-5").show();
    });
    $(document).on("click", ".popup-fullscreen-5 .popup-fullscreen-close",
      function (e) { e.preventDefault(); $(".popup-fullscreen-5").hide(); });

    $("#menu-5").on("click", function (e) {
      e.preventDefault();
      $(".popup-fullmenu").removeClass("active");
      $(".overlay").hide();
      $(".popup-fullscreen-6").show();
    });
    $(document).on("click", ".popup-fullscreen-6 .popup-fullscreen-close",
      function (e) { e.preventDefault(); $(".popup-fullscreen-6").hide(); });

    $("#popup-fullscreen-prev").on("click", function (e) {
      e.preventDefault();
      $(".popup-fullscreen-6").hide();
    });

    // "Coming soon" generic popup for many disabled items.
    $("#menu-6, #Question, #Fix, #Session, #Settings, #Support, #Allvacancies, #Camera")
      .on("click", function (e) {
        e.preventDefault();
        $(".popup-fullmenu").removeClass("active");
        $(".overlay").hide();
        $(".popup-fullscreen-error").show();
      });
    $(document).on("click", ".popup-fullscreen-error .popup-fullscreen-close",
      function (e) { e.preventDefault(); $(".popup-fullscreen-error").hide(); });

    $("#Fines").on("click", function (e) {
      e.preventDefault();
      $(".popup-fullmenu").removeClass("active");
      $(".overlay").hide();
      $(".popup-fullscreen-fines").show();
    });
    $(document).on("click", ".popup-fullscreen-fines .popup-fullscreen-close",
      function (e) { e.preventDefault(); $(".popup-fullscreen-fines").hide(); });

    $("#go-fines-waiting").on("click", function (e) {
      e.preventDefault();
      $(".popup-fullmenu").removeClass("active");
      $(".popup-fullscreen-fines").removeClass("active");
      $(".overlay").hide();
      $(".popup-fullscreen-fines-waiting").show();
    });
    $(document).on("click",
      ".popup-fullscreen-fines-waiting .popup-fullscreen-close",
      function (e) {
        e.preventDefault();
        $(".popup-fullscreen-fines-waiting").hide();
        $(".popup-fullscreen-fines").hide();
      });
  });

  // 5.11 restartMarquee — used by code that wants to reset the scroll.
  window.restartMarquee = function () {
    var track = document.querySelector(".track");
    if (!track) return;
    track.style.animation = "none";
    void track.offsetHeight;   // force reflow
    track.style.animation = "";
  };

  // ==========================================================================
  // 6. Kick off
  // ==========================================================================

  boot();

})(jQuery);
