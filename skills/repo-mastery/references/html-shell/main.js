/* ============================================================
   docs-to-course — interactive engine (original)
   Author: CZ. Powers quizzes, group chat, flow animation,
   glossary tooltips, scroll progress and reveal. No dependencies.
   ============================================================ */
(function () {
  "use strict";
  var ready = function (fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  };

  /* ---------- Quizzes ---------- */
  window.selectOption = function (btn) {
    var block = btn.closest(".quiz-question-block");
    if (!block || block.dataset.locked === "1") return;
    block.querySelectorAll(".quiz-option").forEach(function (o) { o.classList.remove("selected"); });
    btn.classList.add("selected");
  };

  window.checkQuiz = function (containerId) {
    var c = document.getElementById(containerId);
    if (!c) return;
    c.querySelectorAll(".quiz-question-block").forEach(function (block) {
      var picked = block.querySelector(".quiz-option.selected");
      var fb = block.querySelector(".quiz-feedback");
      if (!picked) {
        if (fb) { fb.textContent = "先选一个答案 👆"; fb.className = "quiz-feedback show error"; }
        return;
      }
      block.dataset.locked = "1";
      var ok = picked.dataset.value === block.dataset.correct;
      picked.classList.add(ok ? "correct" : "incorrect");
      if (!ok) {
        var right = block.querySelector('.quiz-option[data-value="' + block.dataset.correct + '"]');
        if (right) right.classList.add("correct");
      }
      if (fb) {
        fb.textContent = ok
          ? (block.dataset.explanationRight || "答对了！")
          : (block.dataset.explanationWrong || "再想想。");
        fb.className = "quiz-feedback show " + (ok ? "success" : "error");
      }
    });
    var reset = c.querySelector(".quiz-reset-btn");
    if (reset) reset.classList.add("show");
  };

  window.resetQuiz = function (containerId) {
    var c = document.getElementById(containerId);
    if (!c) return;
    c.querySelectorAll(".quiz-question-block").forEach(function (block) {
      block.dataset.locked = "";
      block.querySelectorAll(".quiz-option").forEach(function (o) {
        o.classList.remove("selected", "correct", "incorrect");
      });
      var fb = block.querySelector(".quiz-feedback");
      if (fb) fb.className = "quiz-feedback";
    });
    var reset = c.querySelector(".quiz-reset-btn");
    if (reset) reset.classList.remove("show");
  };

  /* ---------- Group chat ---------- */
  function initChat(win) {
    var msgs = Array.prototype.slice.call(win.querySelectorAll(".chat-message"));
    var typing = win.querySelector(".chat-typing");
    var prog = win.querySelector(".chat-progress");
    var nextBtn = win.querySelector(".chat-next-btn");
    var allBtn = win.querySelector(".chat-all-btn");
    var resetBtn = win.querySelector(".chat-reset-btn");
    var i = 0, busy = false;
    if (typing) typing.style.display = "none";

    function updateProgress() { if (prog) prog.textContent = i + " / " + msgs.length; }
    function done() { return i >= msgs.length; }

    function reveal() {
      if (busy || done()) return;
      busy = true;
      var m = msgs[i];
      var sender = m.getAttribute("data-sender");
      // show typing bubble briefly, mirroring the next sender's avatar colour
      if (typing) {
        var av = typing.querySelector(".chat-avatar");
        var srcAv = m.querySelector(".chat-avatar");
        if (av && srcAv) { av.textContent = srcAv.textContent; av.style.background = srcAv.style.background; }
        typing.style.display = "flex";
      }
      setTimeout(function () {
        if (typing) typing.style.display = "none";
        m.style.display = "flex";
        i++; updateProgress(); busy = false;
        if (done() && nextBtn) nextBtn.disabled = true;
      }, 520);
    }

    function playAll() {
      if (done()) return;
      reveal();
      var t = setInterval(function () {
        if (done()) { clearInterval(t); return; }
        if (!busy) reveal();
      }, 760);
    }

    function reset() {
      msgs.forEach(function (m) { m.style.display = "none"; });
      i = 0; busy = false; if (nextBtn) nextBtn.disabled = false; updateProgress();
    }

    msgs.forEach(function (m) { m.style.display = "none"; });
    updateProgress();
    if (nextBtn) nextBtn.addEventListener("click", reveal);
    if (allBtn) allBtn.addEventListener("click", playAll);
    if (resetBtn) resetBtn.addEventListener("click", reset);
  }

  /* ---------- Flow / data animation ---------- */
  function initFlow(flow) {
    var steps;
    try { steps = JSON.parse(flow.getAttribute("data-steps") || "[]"); }
    catch (e) { steps = []; }
    var label = flow.querySelector(".flow-step-label");
    var packet = flow.querySelector(".flow-packet");
    var prog = flow.querySelector(".flow-progress");
    var nextBtn = flow.querySelector(".flow-next-btn");
    var resetBtn = flow.querySelector(".flow-reset-btn");
    var i = 0;

    function actor(idSuffix) { return flow.querySelector("#flow-actor-" + idSuffix.replace(/^actor-/, "").replace(/^flow-actor-/, "")); }
    function clearActive() { flow.querySelectorAll(".flow-actor").forEach(function (a) { a.classList.remove("active"); }); }

    function center(el) {
      var cr = flow.getBoundingClientRect();
      var r = el.getBoundingClientRect();
      return { x: r.left - cr.left + r.width / 2, y: r.top - cr.top + r.height / 2 };
    }

    function movePacket(from, to) {
      if (!packet || !from || !to) return;
      var a = center(from.querySelector(".flow-actor-icon") || from);
      var b = center(to.querySelector(".flow-actor-icon") || to);
      packet.style.transition = "none";
      packet.style.transform = "translate(" + (a.x - 7) + "px," + (a.y - 7) + "px)";
      packet.classList.add("moving");
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          packet.style.transition = "";
          packet.style.transform = "translate(" + (b.x - 7) + "px," + (b.y - 7) + "px)";
        });
      });
      setTimeout(function () { packet.classList.remove("moving"); }, 650);
    }

    function render(step) {
      clearActive();
      if (step.highlight) { var h = flow.querySelector("#" + step.highlight); if (h) h.classList.add("active"); }
      if (label) label.textContent = step.label || "";
      if (step.packet && step.from && step.to) movePacket(actor(step.from), actor(step.to));
    }

    function next() {
      if (i >= steps.length) return;
      render(steps[i]); i++;
      if (prog) prog.textContent = i + " / " + steps.length;
      if (nextBtn && i >= steps.length) nextBtn.disabled = true;
    }
    function reset() {
      i = 0; clearActive();
      if (packet) packet.classList.remove("moving");
      if (label) label.textContent = "点“下一步”开始 / Click Next to begin";
      if (prog) prog.textContent = "0 / " + steps.length;
      if (nextBtn) nextBtn.disabled = false;
    }

    if (prog) prog.textContent = "0 / " + steps.length;
    if (nextBtn) nextBtn.addEventListener("click", next);
    if (resetBtn) resetBtn.addEventListener("click", reset);
  }

  /* ---------- Glossary tooltips ---------- */
  function initTooltips() {
    var active = null;
    function place(term, tip) {
      document.body.appendChild(tip);
      var r = term.getBoundingClientRect();
      var w = tip.offsetWidth, h = tip.offsetHeight;
      var left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
      var top = r.top - h - 8;
      if (top < 8) top = r.bottom + 8;
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    }
    function hide() { if (active) { active.tip.classList.remove("visible"); active.tip.remove(); active.term.classList.remove("active"); active = null; } }
    function show(term) {
      hide();
      var tip = document.createElement("span");
      tip.className = "term-tip";
      tip.textContent = term.getAttribute("data-definition");
      term.classList.add("active");
      place(term, tip);
      requestAnimationFrame(function () { tip.classList.add("visible"); });
      active = { term: term, tip: tip };
    }
    document.querySelectorAll(".term").forEach(function (term) {
      term.addEventListener("mouseenter", function () { show(term); });
      term.addEventListener("mouseleave", hide);
      term.addEventListener("click", function (e) {
        e.stopPropagation();
        if (active && active.term === term) hide(); else show(term);
      });
    });
    document.addEventListener("click", hide);
    window.addEventListener("scroll", hide, { passive: true });
  }

  /* ---------- Nav: progress bar, dots, scroll reveal ---------- */
  function initNav() {
    var bar = document.getElementById("progress-bar");
    var dots = Array.prototype.slice.call(document.querySelectorAll(".nav-dot"));
    var modules = Array.prototype.slice.call(document.querySelectorAll(".module"));

    function onScroll() {
      var st = document.documentElement.scrollTop || document.body.scrollTop;
      var h = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      if (bar) bar.style.width = (h > 0 ? (st / h) * 100 : 0) + "%";
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    dots.forEach(function (dot) {
      dot.addEventListener("click", function () {
        var t = document.getElementById(dot.getAttribute("data-target"));
        if (t) window.scrollTo({ top: t.offsetTop - 40, behavior: "smooth" });
      });
    });

    if ("IntersectionObserver" in window && modules.length) {
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            var id = en.target.id;
            dots.forEach(function (d) { d.classList.toggle("active", d.getAttribute("data-target") === id); });
          }
        });
      }, { rootMargin: "-45% 0px -45% 0px" });
      modules.forEach(function (m) { obs.observe(m); });
    }
  }

  function initReveal() {
    var els = Array.prototype.slice.call(document.querySelectorAll(".animate-in"));
    if (!("IntersectionObserver" in window)) { els.forEach(function (e) { e.classList.add("visible"); }); return; }
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("visible"); obs.unobserve(en.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    els.forEach(function (e) { obs.observe(e); });
  }

  ready(function () {
    document.querySelectorAll(".chat-window").forEach(initChat);
    document.querySelectorAll(".flow-animation").forEach(initFlow);
    initTooltips();
    initNav();
    initReveal();
  });
})();
