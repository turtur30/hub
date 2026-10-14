/**
 * PIN-pad — based on rpls.rest passpage.js, adapted to call our backend
 * for verification (POST /api/u/{shortcode}/pin-check).
 *
 * Loader & screen-transition coordination:
 *   - 3-sec loader (same as original) gives the splash-feel.
 *   - After 3 sec, app.js has either:
 *       (a) populated window.__cardData (data ready) + skipPin true
 *           → we fade DIRECTLY into .container, no PIN screen
 *       (b) populated window.__cardData + pinRequired true
 *           → we fade into .passpage; user types PIN, we POST to API
 *       (c) error happened → app.js showed err-overlay; we no-op here
 *
 * If the 3 sec elapse and data is NOT ready yet (slow network), we
 * fall back to showing .passpage UNLESS we already know it's not
 * needed — to keep the flow consistent we just wait for data.
 */
$(function () {

  let pin = "";
  let isScanning = false;
  let blockedUntilMs = 0;
  let blockedTimer = null;

  // ============================================================
  // Initial state: hide everything except the loader. body bg is
  // still the dark splash; app.js will paint it beige at 3 sec.
  // ============================================================
  $(".passpage").hide();
  $(".container").hide();

  // ============================================================
  // 3-second loader, then route to .container or .passpage based
  // on what app.js fetched in the meantime.
  // ============================================================
  setTimeout(function tickAfterLoader() {
    const st = window.__bootState || {};
    // If app.js threw an error overlay, just stay hidden — the
    // overlay sits on top and we shouldn't render anything else.
    if (document.getElementById("err-overlay")) {
      $(".loader").fadeOut(200);
      return;
    }
    // Data not ready yet (slow fetch): retry in 150 ms.
    if (!st.dataReady) {
      return setTimeout(tickAfterLoader, 150);
    }
    if (st.skipPin) {
      $(".loader").fadeOut(200, function () {
        $(".container").fadeIn(200);
      });
    } else {
      $(".loader").fadeOut(200, function () {
        $(".passpage").fadeIn(200);
      });
    }
  }, 3000);

  // ============================================================
  // PIN dot rendering (CSS uses `.pin-dot.filled`).
  // ============================================================
  function renderPin() {
    $(".pin-dot").removeClass("filled");
    $(".pin-dot").each(function (index) {
      if (index < pin.length) $(this).addClass("filled");
    });
  }

  // ============================================================
  // Visual feedback on wrong PIN.
  // ============================================================
  function shakePin() {
    const w = $(".pin-wrap");
    if (!w.length) return;
    const seq = ["-8px", "8px", "-6px", "6px", "-3px", "3px", "0"];
    w.css("transition", "transform 0.08s");
    seq.forEach(function (off, i) {
      setTimeout(function () { w.css("transform", "translateX(" + off + ")"); }, i * 60);
    });
    setTimeout(function () { w.css({ transition: "", transform: "" }); }, seq.length * 60 + 50);
  }

  function showHint(text, color) {
    let $hint = $("#pin-hint");
    if (!$hint.length) {
      $hint = $('<div id="pin-hint" style="margin-top:14px;text-align:center;font-size:14px;font-weight:500;"></div>');
      $(".pin-wrap").append($hint);
    }
    $hint.css("color", color || "#b00020").text(text || "");
  }
  function clearHint() { $("#pin-hint").text(""); }

  // ============================================================
  // Unlock — fade out passpage, fade in container (rendered already).
  // ============================================================
  function unlockScreen() {
    setTimeout(function () {
      $(".passpage").fadeOut(200, function () {
        $(".container").fadeIn(200);
      });
    }, 400);
  }

  // ============================================================
  // 5-min block lifecycle (server is the source of truth — JS only
  // *displays* the countdown; on resend we'll still get 429).
  // ============================================================
  function setBlocked(secondsLeft) {
    blockedUntilMs = Date.now() + secondsLeft * 1000;
    disablePad(true);
    tickBlockCountdown();
    if (blockedTimer) clearInterval(blockedTimer);
    blockedTimer = setInterval(tickBlockCountdown, 1000);
  }
  function tickBlockCountdown() {
    const left = Math.max(0, Math.ceil((blockedUntilMs - Date.now()) / 1000));
    if (left <= 0) {
      clearInterval(blockedTimer);
      blockedTimer = null;
      blockedUntilMs = 0;
      disablePad(false);
      showHint("Можна спробувати знову.", "#0a0");
      pin = ""; renderPin();
      return;
    }
    const m = Math.floor(left / 60), s = left % 60;
    showHint("Заблоковано на " + m + ":" + (s < 10 ? "0" : "") + s, "#b00020");
  }
  function disablePad(disabled) {
    $(".pin-pad .pin-btn").each(function () {
      this.disabled = !!disabled;
      this.style.opacity = disabled ? "0.4" : "";
      this.style.pointerEvents = disabled ? "none" : "";
    });
  }

  // ============================================================
  // PIN submission to our backend.
  // ============================================================
  function submitPin() {
    const sc = window.__shortcode;
    if (!sc) return;
    disablePad(true);
    fetch("/api/u/" + encodeURIComponent(sc) + "/pin-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ pin: pin })
    })
      .then(function (r) {
        return r.json().then(function (body) {
          return { status: r.status, body: body };
        });
      })
      .then(function (res) {
        if (res.status === 200 && res.body && res.body.ok) {
          clearHint();
          unlockScreen();
          disablePad(false);
          return;
        }
        if (res.status === 401) {
          const left = (res.body && typeof res.body.remaining_attempts === "number")
            ? res.body.remaining_attempts : null;
          showHint(
            left == null ? "Невірний код."
                         : "Невірний код. Залишилось спроб: " + left,
            "#b00020"
          );
          shakePin();
          pin = ""; renderPin();
          disablePad(false);
          return;
        }
        if (res.status === 429) {
          const sec = (res.body && res.body.seconds_left) || 300;
          pin = ""; renderPin();
          setBlocked(sec);
          return;
        }
        if (res.status === 400) {
          showHint("PIN не встановлено для цієї картки.", "#b00020");
          pin = ""; renderPin();
          disablePad(false);
          return;
        }
        showHint("Помилка сервера. Спробуйте ще раз.", "#b00020");
        pin = ""; renderPin();
        disablePad(false);
      })
      .catch(function () {
        showHint("Немає з'єднання з сервером.", "#b00020");
        pin = ""; renderPin();
        disablePad(false);
      });
  }

  // ============================================================
  // Input handlers (numbers, backspace, keyboard, FaceID, exit).
  // ============================================================
  $(".pin-number").on("click", function () {
    if (isScanning || pin.length >= 4) return;
    if (blockedUntilMs > Date.now()) return;
    pin += $(this).data("number");
    renderPin();
    if (pin.length === 4) {
      // Small delay so the 4th dot is visible before the round-trip.
      setTimeout(submitPin, 120);
    }
  });

  $("#deleteBtn").on("click", function () {
    if (isScanning) return;
    if (blockedUntilMs > Date.now()) return;
    pin = pin.slice(0, -1);
    renderPin();
    clearHint();
  });

  $(document).on("keydown", function (e) {
    if (blockedUntilMs > Date.now()) return;
    if (/^[0-9]$/.test(e.key)) {
      if (pin.length < 4) {
        pin += e.key;
        renderPin();
        if (pin.length === 4) setTimeout(submitPin, 120);
      }
    }
    if (e.key === "Backspace") {
      pin = pin.slice(0, -1);
      renderPin();
      clearHint();
    }
  });

  // FaceID — our backend has no biometric channel, so we show a toast
  // and explicitly do NOT auto-fill any PIN (original cheated with '1234').
  $("#faceBtn").on("click", function () {
    if (isScanning) return;
    if (blockedUntilMs > Date.now()) return;
    showHint("Face ID недоступний на цьому пристрої.", "#666");
  });

  // EXIT — re-lock back to PIN screen (UX nicety; carries no auth state).
  $("#exit").on("click", function () {
    pin = "";
    renderPin();
    clearHint();
    $(".container").fadeOut(200, function () {
      $(".passpage").fadeIn(200);
    });
  });

  // Forgot link — toast pointing the user back to the bot.
  $(document).on("click", ".forgot-link", function (e) {
    e.preventDefault();
    showHint("Зверніться до підтримки в боті — там можна скинути PIN.", "#666");
  });

});
