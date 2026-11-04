(() => {
  "use strict";

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
    if (!successful) throw new Error("Copy failed");
  };

  const headings = [...document.querySelectorAll(".post-body h2[id], .post-body h3[id], .post-body h4[id]")];
  const tocLinks = [...document.querySelectorAll("[data-toc-link]")];

  const setActiveHeading = (id) => {
    tocLinks.forEach((link) => {
      const active = link.getAttribute("href") === `#${id}`;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  };

  if (headings.length && tocLinks.length) {
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
        if (visible.length) setActiveHeading(visible[0].target.id);
      }, { rootMargin: "-12% 0px -72% 0px", threshold: 0 });
      headings.forEach((heading) => observer.observe(heading));
    } else {
      let ticking = false;
      const updateActive = () => {
        const current = [...headings].reverse().find((heading) => heading.getBoundingClientRect().top <= 140);
        if (current) setActiveHeading(current.id);
        ticking = false;
      };
      window.addEventListener("scroll", () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(updateActive);
      }, { passive: true });
      updateActive();
    }
  }

  document.querySelectorAll(".post-body table").forEach((table) => {
    if (table.parentElement?.classList.contains("table-scroll")) return;
    const wrapper = document.createElement("div");
    wrapper.className = "table-scroll";
    table.parentNode.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });

  document.querySelectorAll(".post-body pre").forEach((pre) => {
    const code = pre.querySelector("code");
    if (!code) return;
    const languageClass = [...code.classList].find((name) => name.startsWith("language-"));
    const language = languageClass ? languageClass.replace("language-", "") : "code";
    pre.dataset.language = language;
    pre.classList.add("is-enhanced");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy";
    button.textContent = "复制";
    button.setAttribute("aria-label", "复制这段代码");
    button.addEventListener("click", async () => {
      try {
        await copyText(code.textContent);
        button.textContent = "已复制";
        window.setTimeout(() => {
          button.textContent = "复制";
        }, 1800);
      } catch {
        button.textContent = "复制失败";
        window.setTimeout(() => {
          button.textContent = "复制";
        }, 1800);
      }
    });
    pre.appendChild(button);
  });

  const copyPageButton = document.querySelector("[data-copy-url]");
  if (copyPageButton) {
    copyPageButton.addEventListener("click", async () => {
      try {
        await copyText(window.location.href);
        copyPageButton.textContent = "链接已复制";
        copyPageButton.classList.add("is-copied");
      } catch {
        copyPageButton.textContent = "复制失败";
      }
      window.setTimeout(() => {
        copyPageButton.textContent = "复制本文链接";
        copyPageButton.classList.remove("is-copied");
      }, 1800);
    });
  }
})();
