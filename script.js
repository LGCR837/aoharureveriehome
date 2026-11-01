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

  const EXAM_TARGET = new Date("2027-06-21T08:00:00+08:00").getTime();
  const SITE_START = new Date("2026-10-31T00:00:00+08:00").getTime();
  const DAY = 86400000;
  const examDaysElement = document.getElementById("exam-days");
  const examClockElement = document.getElementById("exam-clock");
  const siteDaysElement = document.getElementById("site-days");
  const siteClockElement = document.getElementById("site-clock");
  let statusInView = true;

  const formatUnit = (value) => String(value).padStart(2, "0");

  const updateClocks = () => {
    if (document.hidden || !statusInView) return;
    const now = Date.now();

    if (examDaysElement && examClockElement) {
      const remaining = Math.max(0, EXAM_TARGET - now);
      const days = Math.floor(remaining / DAY);
      const hours = Math.floor((remaining % DAY) / 3600000);
      const minutes = Math.floor((remaining % 3600000) / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      examDaysElement.textContent = days.toLocaleString("zh-CN");
      examClockElement.textContent = remaining > 0
        ? `${formatUnit(hours)} 时 ${formatUnit(minutes)} 分 ${formatUnit(seconds)} 秒`
        : "考试已开始";
    }

    if (siteDaysElement && siteClockElement) {
      const elapsed = Math.max(0, now - SITE_START);
      const days = Math.floor(elapsed / DAY);
      const hours = Math.floor((elapsed % DAY) / 3600000);
      const minutes = Math.floor((elapsed % 3600000) / 60000);
      const seconds = Math.floor((elapsed % 60000) / 1000);
      siteDaysElement.textContent = days.toLocaleString("zh-CN");
      siteClockElement.textContent = `${formatUnit(hours)} 时 ${formatUnit(minutes)} 分 ${formatUnit(seconds)} 秒`;
    }
  };

  updateClocks();
  window.setInterval(updateClocks, 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) updateClocks();
  });

  const statusSection = document.getElementById("status");
  if (statusSection && "IntersectionObserver" in window) {
    const statusObserver = new IntersectionObserver((entries) => {
      statusInView = entries[0]?.isIntersecting ?? true;
      if (statusInView) updateClocks();
    }, { threshold: 0 });
    statusObserver.observe(statusSection);
  }

  const fetchJson = async (url, options = {}) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      return await response.json();
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };

  const loadVisitStats = async () => {
    try {
      const data = await fetchJson("https://api.tssl.cc/api.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: window.location.href.split("#")[0],
          referrer: document.referrer
        }),
        keepalive: true
      });
      if (data.busuanzi_site_pv !== undefined) setText("busuanzi_site_pv", data.busuanzi_site_pv);
      if (data.busuanzi_today_pv !== undefined) setText("busuanzi_today_pv", data.busuanzi_today_pv);
      if (data.busuanzi_site_uv !== undefined) setText("busuanzi_site_uv", data.busuanzi_site_uv);
    } catch {
      setText("busuanzi_site_pv", "--");
      setText("busuanzi_today_pv", "--");
      setText("busuanzi_site_uv", "--");
    }
  };

  const weatherLabels = {
    0: "晴", 1: "大部晴朗", 2: "多云", 3: "阴",
    45: "有雾", 48: "雾凇",
    51: "小毛毛雨", 53: "毛毛雨", 55: "强毛毛雨",
    56: "冻毛毛雨", 57: "强冻毛毛雨",
    61: "小雨", 63: "中雨", 65: "大雨",
    66: "冻雨", 67: "强冻雨",
    71: "小雪", 73: "中雪", 75: "大雪", 77: "米雪",
    80: "小阵雨", 81: "阵雨", 82: "强阵雨",
    85: "小阵雪", 86: "强阵雪",
    95: "雷雨", 96: "雷雨伴冰雹", 99: "强雷暴伴冰雹"
  };

  const loadWeather = async () => {
    if (!document.getElementById("weather-temp")) return;
    try {
      const location = await fetchJson("https://ipwho.is/?lang=zh-CN");
      if (!location.success || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
        throw new Error("Location unavailable");
      }

      const latitude = location.latitude.toFixed(4);
      const longitude = location.longitude.toFixed(4);
      const weather = await fetchJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,weather_code&timezone=auto`
      );
      if (!weather.current) throw new Error("Weather unavailable");

      const current = weather.current;
      setText("weather-temp", `${Math.round(current.temperature_2m)}°`);
      setText("weather-feels", `${Math.round(current.apparent_temperature)}°`);
      setText("weather-desc", weatherLabels[current.weather_code] || "天气未知");
      setText("weather-city", location.city || location.region || location.country || "当前位置");
    } catch {
      setText("weather-temp", "--°");
      setText("weather-feels", "--°");
      setText("weather-desc", "天气暂不可用");
      setText("weather-city", "稍后再试");
    }
  };

  loadVisitStats();
  loadWeather();

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
