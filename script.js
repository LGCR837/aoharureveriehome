(() => {
  "use strict";

  const body = document.body;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(pointer: fine)");

  requestAnimationFrame(() => {
    requestAnimationFrame(() => body.classList.add("is-ready"));
  });

  const header = document.getElementById("site-header");
  const progressBar = document.getElementById("scroll-progress-bar");
  let scrollTicking = false;

  const updateScroll = () => {
    const y = window.scrollY;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    header.classList.toggle("is-scrolled", y > 24);
    progressBar.style.transform = `scaleX(${Math.min(1, y / max)})`;
    scrollTicking = false;
  };

  window.addEventListener("scroll", () => {
    if (!scrollTicking) {
      requestAnimationFrame(updateScroll);
      scrollTicking = true;
    }
  }, { passive: true });
  window.addEventListener("resize", updateScroll, { passive: true });
  updateScroll();

  const revealItems = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reducedMotion.matches) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    revealItems.forEach((item) => revealObserver.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add("is-visible"));
  }

  const navLinks = [...document.querySelectorAll("[data-nav]")];
  const sections = navLinks.map((link) => document.getElementById(link.dataset.nav)).filter(Boolean);
  if ("IntersectionObserver" in window) {
    const navObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((link) => {
          const active = link.dataset.nav === entry.target.id;
          link.classList.toggle("is-active", active);
          if (active) link.setAttribute("aria-current", "location");
          else link.removeAttribute("aria-current");
        });
      });
    }, { rootMargin: "-25% 0px -62% 0px", threshold: 0 });
    sections.forEach((section) => navObserver.observe(section));
  }

  if (finePointer.matches) {
    document.querySelectorAll("[data-magnetic]").forEach((element) => {
      const inner = element.querySelector(".button__inner") || element;
      element.addEventListener("pointermove", (event) => {
        if (reducedMotion.matches) return;
        const rect = element.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width - 0.5) * 8;
        const y = ((event.clientY - rect.top) / rect.height - 0.5) * 8;
        inner.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      });
      element.addEventListener("pointerleave", () => {
        inner.style.transform = "translate3d(0, 0, 0)";
      });
    });
  }

  const toast = document.getElementById("toast");
  let toastTimer;
  const showToast = (message) => {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
  };

  const copyText = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const successful = document.execCommand("copy");
    textarea.remove();
    if (!successful) throw new Error("Copy command failed");
  };

  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const text = button.dataset.copy;
      const label = button.querySelector("span");
      try {
        await copyText(text);
        button.classList.add("is-copied");
        label.textContent = "已复制";
        showToast(`已复制：${text}`);
        window.setTimeout(() => {
          button.classList.remove("is-copied");
          label.textContent = "复制";
        }, 1800);
      } catch {
        showToast("复制失败，请手动选择邮箱复制");
      }
    });
  });

  const video = document.getElementById("background-video");
  const deferredSources = [...video.querySelectorAll("source[data-src]")];
  const hasVideo = deferredSources.some((source) => source.dataset.src.trim() !== "");

  if (hasVideo && !reducedMotion.matches && !navigator.connection?.saveData) {
    const loadVideo = () => {
      deferredSources.forEach((source) => {
        if (source.dataset.src.trim()) source.src = source.dataset.src.trim();
      });
      video.load();
      video.dataset.active = "true";
      video.play().catch(() => {
        video.dataset.active = "false";
      });
    };

    video.addEventListener("playing", () => video.classList.add("is-playing"));
    video.addEventListener("error", () => {
      video.classList.remove("is-playing");
      video.dataset.active = "false";
    });

    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(loadVideo, { timeout: 2200 });
    } else {
      window.setTimeout(loadVideo, 1200);
    }

    document.addEventListener("visibilitychange", () => {
      if (video.dataset.active !== "true") return;
      if (document.hidden) video.pause();
      else video.play().catch(() => {});
    });
  }
})();
