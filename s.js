
(() => {
  "use strict";

  if (window.__BAHJA_PROTECTION__) return;
  Object.defineProperty(window, "__BAHJA_PROTECTION__", {
    value: true,
    writable: false,
    configurable: false
  });

  const CONFIG = Object.freeze({
    blockContextMenu: true,
    blockImageDragging: true,
    blockImageSavingShortcuts: true,
    blockDeveloperShortcuts: true,
    blockTextSelection: false,
    blockCopy: false,
    blockIframeEmbedding: true,
    monitorDOM: true,
    monitorScripts: true,
    monitorLinks: true,
    monitorImages: true,
    monitorVisibility: true,
    logEvents: true,
    maxLogs: 100,
    protectionName: "BAHJA PROTECTION"
  });

  const STATE = {
    started: Date.now(),
    events: [],
    violations: 0,
    observers: [],
    initialized: false
  };

  const INTERNAL = {
    trustedScripts: new Set(),
    trustedLinks: new WeakMap(),
    trustedImages: new WeakMap(),
    originalAttributes: new WeakMap(),
    eventHandlers: new WeakSet(),
    blockedCount: 0
  };

  const SAFE = {
    isElement(element) {
      return element instanceof Element;
    },

    isEditable(element) {
      if (!this.isElement(element)) return false;

      return Boolean(
        element.closest(
          "input, textarea, select, [contenteditable='true'], [role='textbox']"
        )
      );
    },

    isInteractive(element) {
      if (!this.isElement(element)) return false;

      return Boolean(
        element.closest(
          "a, button, input, textarea, select, summary, label, [role='button']"
        )
      );
    },

    isProtectedElement(element) {
      if (!this.isElement(element)) return false;

      return Boolean(
        element.closest("[data-bahja-allow]")
      );
    },

    isExternalLink(link) {
      try {
        return new URL(link.href, location.href).origin !== location.origin;
      } catch {
        return false;
      }
    }
  };

  const LOGGER = {
    add(type, detail = "") {
      if (!CONFIG.logEvents) return;

      const entry = Object.freeze({
        type,
        detail: String(detail).slice(0, 180),
        time: new Date().toISOString()
      });

      STATE.events.push(entry);
      STATE.violations++;

      if (STATE.events.length > CONFIG.maxLogs) {
        STATE.events.shift();
      }
    },

    get() {
      return STATE.events.map(event => ({ ...event }));
    },

    clear() {
      STATE.events.length = 0;
    }
  };

  const BLOCKER = {
    stop(event, reason) {
      if (!event || event.defaultPrevented) return;

      event.preventDefault();
      event.stopPropagation();

      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }

      INTERNAL.blockedCount++;
      LOGGER.add("BLOCKED", reason);
    },

    keydown(event) {
      if (!CONFIG.blockDeveloperShortcuts) return;

      const key = String(event.key || "").toLowerCase();
      const control = event.ctrlKey || event.metaKey;
      const shift = event.shiftKey;

      const forbidden =
        key === "f12" ||
        (control && key === "u") ||
        (control && shift && ["i", "j", "c", "k"].includes(key)) ||
        (control && key === "s" && !SAFE.isEditable(event.target));

      if (forbidden) {
        this.stop(event, "Developer shortcut: " + key);
        return;
      }

      if (
        CONFIG.blockImageSavingShortcuts &&
        control &&
        shift &&
        key === "s"
      ) {
        this.stop(event, "Image save shortcut");
      }
    },

    contextmenu(event) {
      if (!CONFIG.blockContextMenu) return;
      if (SAFE.isProtectedElement(event.target)) return;

      this.stop(event, "Context menu");
    },

    dragstart(event) {
      if (!CONFIG.blockImageDragging) return;

      const target = event.target;

      if (
        SAFE.isElement(target) &&
        target.closest("img, picture, svg")
      ) {
        this.stop(event, "Image dragging");
      }
    },

    selectstart(event) {
      if (CONFIG.blockTextSelection) {
        if (SAFE.isEditable(event.target)) return;
        if (SAFE.isInteractive(event.target)) return;

        this.stop(event, "Text selection");
      }
    },

    copy(event) {
      if (!CONFIG.blockCopy) return;
      if (SAFE.isEditable(event.target)) return;

      this.stop(event, "Copy");
    },

    cut(event) {
      if (!CONFIG.blockCopy) return;
      if (SAFE.isEditable(event.target)) return;

      this.stop(event, "Cut");
    }
  };

  const KEYBOARD = {
    initialize() {
      document.addEventListener(
        "keydown",
        event => BLOCKER.keydown(event),
        true
      );

      document.addEventListener(
        "keyup",
        event => {
          if (
            event.key === "F12" &&
            CONFIG.blockDeveloperShortcuts
          ) {
            event.preventDefault();
          }
        },
        true
      );

      document.addEventListener(
        "contextmenu",
        event => BLOCKER.contextmenu(event),
        true
      );

      document.addEventListener(
        "dragstart",
        event => BLOCKER.dragstart(event),
        true
      );

      document.addEventListener(
        "selectstart",
        event => BLOCKER.selectstart(event),
        true
      );

      document.addEventListener(
        "copy",
        event => BLOCKER.copy(event),
        true
      );

      document.addEventListener(
        "cut",
        event => BLOCKER.cut(event),
        true
      );
    }
  };

  const IMAGES = {
    inspect(image) {
      if (!(image instanceof HTMLImageElement)) return;

      if (!INTERNAL.trustedImages.has(image)) {
        INTERNAL.trustedImages.set(image, {
          src: image.getAttribute("src"),
          srcset: image.getAttribute("srcset"),
          draggable: image.draggable
        });
      }

      image.draggable = false;
      image.setAttribute("decoding", "async");
      image.setAttribute("data-bahja-image", "1");
    },

    initialize() {
      document.querySelectorAll("img").forEach(image => {
        this.inspect(image);
      });

      if (!CONFIG.monitorImages) return;

      const observer = new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;

            if (node.matches("img")) {
              this.inspect(node);
            }

            node.querySelectorAll?.("img").forEach(image => {
              this.inspect(image);
            });
          }
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });

      STATE.observers.push(observer);
    }
  };

  const LINKS = {
    inspect(link) {
      if (!(link instanceof HTMLAnchorElement)) return;

      if (!INTERNAL.trustedLinks.has(link)) {
        INTERNAL.trustedLinks.set(link, {
          href: link.getAttribute("href"),
          target: link.getAttribute("target")
        });
      }

      const target = link.getAttribute("target");

      if (target === "_blank") {
        const rel = new Set(
          (link.getAttribute("rel") || "").split(/\s+/).filter(Boolean)
        );

        rel.add("noopener");
        rel.add("noreferrer");

        link.setAttribute("rel", [...rel].join(" "));
      }
    },

    initialize() {
      document.querySelectorAll("a").forEach(link => {
        this.inspect(link);
      });

      if (!CONFIG.monitorLinks) return;

      const observer = new MutationObserver(records => {
        for (const record of records) {
          if (record.type === "attributes") {
            if (record.target instanceof HTMLAnchorElement) {
              this.inspect(record.target);
            }
          }

          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;

            if (node.matches("a")) this.inspect(node);

            node.querySelectorAll?.("a").forEach(link => {
              this.inspect(link);
            });
          }
        }
      });

      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["href", "target"]
      });

      STATE.observers.push(observer);
    }
  };

  const SCRIPTS = {
    inspect() {
      document.querySelectorAll("script[src]").forEach(script => {
        INTERNAL.trustedScripts.add(script.src);
      });
    },

    initialize() {
      this.inspect();

      if (!CONFIG.monitorScripts) return;

      const observer = new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof HTMLScriptElement)) continue;

            if (
              node.src &&
              !INTERNAL.trustedScripts.has(node.src)
            ) {
              LOGGER.add("NEW_SCRIPT", node.src);
            }
          }
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });

      STATE.observers.push(observer);
    }
  };

  const FRAME = {
    initialize() {
      if (!CONFIG.blockIframeEmbedding) return;

      if (window.self !== window.top) {
        try {
          window.top.location = window.self.location;
        } catch {
          document.documentElement.style.display = "none";
        }
      }
    }
  };

  const DOM = {
    initialize() {
      if (!CONFIG.monitorDOM) return;

      const observer = new MutationObserver(records => {
        for (const record of records) {
          if (record.type === "childList") {
            for (const node of record.removedNodes) {
              if (
                node instanceof HTMLScriptElement &&
                node.src &&
                INTERNAL.trustedScripts.has(node.src)
              ) {
                LOGGER.add("SCRIPT_REMOVED", node.src);
              }
            }
          }
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });

      STATE.observers.push(observer);
    }
  };

  const VISIBILITY = {
    initialize() {
      if (!CONFIG.monitorVisibility) return;

      document.addEventListener("visibilitychange", () => {
        LOGGER.add(
          "VISIBILITY",
          document.visibilityState
        );
      });
    }
  };

  const INTERACTION = {
    initialize() {
      document.addEventListener("click", event => {
        const target = event.target;

        if (!SAFE.isElement(target)) return;

        const link = target.closest("a");

        if (!link) return;

        if (!link.href) {
          LOGGER.add("EMPTY_LINK", link.textContent);
        }
      }, true);

      document.addEventListener("submit", event => {
        if (!(event.target instanceof HTMLFormElement)) return;

        LOGGER.add("FORM_SUBMIT", event.target.action);
      }, true);
    }
  };

  const STYLE = {
    initialize() {
      if (document.getElementById("bahja-protection-style")) return;

      const style = document.createElement("style");

      style.id = "bahja-protection-style";
      style.textContent = `
        img[data-bahja-image="1"] {
          -webkit-user-drag: none;
          user-drag: none;
        }
      `;

      (document.head || document.documentElement).appendChild(style);
    }
  };

  const API = Object.freeze({
    version: "2.0.0",

    status() {
      return Object.freeze({
        active: STATE.initialized,
        started: STATE.started,
        violations: STATE.violations,
        blocked: INTERNAL.blockedCount,
        logs: STATE.events.length
      });
    },

    logs() {
      return LOGGER.get();
    },

    clearLogs() {
      LOGGER.clear();
    },

    config() {
      return { ...CONFIG };
    }
  });

  function initialize() {
    if (STATE.initialized) return;

    STATE.initialized = true;

    FRAME.initialize();
    KEYBOARD.initialize();
    STYLE.initialize();
    IMAGES.initialize();
    LINKS.initialize();
    SCRIPTS.initialize();
    DOM.initialize();
    VISIBILITY.initialize();
    INTERACTION.initialize();

    LOGGER.add("SYSTEM_STARTED", CONFIG.protectionName);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, {
      once: true
    });
  } else {
    initialize();
  }

  Object.defineProperty(window, "BAHJA_SECURITY", {
    value: API,
    writable: false,
    configurable: false,
    enumerable: false
  });

})();
