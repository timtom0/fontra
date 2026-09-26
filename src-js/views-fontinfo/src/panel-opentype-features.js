import { applicationSettingsController } from "@fontra/core/application-settings.js";
import { guessDirectionFromCodePoints } from "@fontra/core/glyph-data.js";
import * as html from "@fontra/core/html-utils.js";
import { addStyleSheet } from "@fontra/core/html-utils.js";
import { ShaperController } from "@fontra/core/shaper-controller.js";
import { scheduleCalls } from "@fontra/core/utils.ts";
import { themeColorCSS } from "@fontra/web-components/theme-support.js";
import {
  serializeFeatureCode,
  resolveFeatureLookups,
  collectSubRules,
} from "@fontra/core/feature-code-parser.js";
import {
  ARABIC_JOINING_FEATURES,
  FeatureCodeModel,
  featureDocURL,
  featureTitle,
  getFeatureGroups,
  getAllFeatureTags,
} from "./feature-code-model.js";
import { describeRule, stripIgnoreMark } from "./rule-sample.js";
import { showDialogCannotEditReadOnly, BaseInfoPanel } from "./panel-base.js";

const colors = {
  "rule-card-background": ["#FFFFFF", "#3A3A3A"],
  "rule-card-border": ["#D8D8D8", "#555555"],
  "rule-kind-ligature": ["#B90063", "#FF7DE9"],
  "rule-kind-contextual": ["#198639", "#86DE74"],
  "rule-kind-substitution": ["#0B57D0", "#75BFFF"],
  "rule-kind-decomposition": ["#B95A00", "#FFBE7D"],
  "rule-kind-deletion": ["#676E78", "#A2A2A2"],
  "preview-background": ["#FAFAFA", "#2A2A2A"],
  "preview-missing": ["#C0392B", "#E74C3C"],
  "preview-glyph-fill": ["#111111", "#EEEEEE"],
  "section-header-background": ["#F0F0F0", "#444444"],
};

addStyleSheet(`
${themeColorCSS(colors, ":root")}

#opentype-features-panel {
  display: grid;
  grid-template-rows: min-content auto;
  gap: 0.5em;
  padding: 0.5em;
  box-sizing: border-box;
}

.ot-features-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5em;
  align-items: center;
}

.ot-features-status {
  font-style: italic;
  color: var(--muted-foreground-color, #666);
  font-size: 0.9em;
}

.ot-features-message {
  font-size: 0.9em;
  padding: 0.1em 0.5em;
  border-radius: 0.3em;
}

.ot-features-message.warning {
  color: var(--fontra-red-color, #c0392b);
  font-weight: bold;
}

.ot-features-message.hidden {
  display: none;
}

/* Sections: collapsible */

.ot-group {
  margin-top: 0.6em;
}

.ot-group-title {
  font-weight: bold;
  margin: 0.4em 0 0.2em 0;
  opacity: 0.85;
}

.ot-feature-section {
  border: 0.5px solid var(--horizontal-rule-color);
  border-radius: 0.4em;
  margin-bottom: 0.3em;
  overflow: hidden;
}

.ot-section-header {
  display: flex;
  gap: 0.5em;
  align-items: center;
  flex-wrap: wrap;
  cursor: pointer;
  padding: 0.35em 0.5em;
  background-color: var(--section-header-background);
  user-select: none;
}

.ot-section-header:hover {
  filter: brightness(0.97);
}

.ot-section-chevron {
  width: 1em;
  height: 1em;
  flex: 0 0 auto;
}

.ot-feature-tag {
  font-family: monospace;
  font-weight: bold;
  background-color: var(--ui-element-background-color);
  border-radius: 0.3em;
  padding: 0.1em 0.4em;
}

.ot-feature-summary {
  font-size: 0.85em;
  opacity: 0.7;
}

.ot-feature-doc-link {
  color: inherit;
  opacity: 0.7;
  display: inline-flex;
  align-items: center;
  gap: 0.2em;
}

.ot-section-body {
  display: grid;
  gap: 0.4em;
  padding: 0.5em;
}

.ot-section-body.closed {
  display: none;
}

/* Rules */

.ot-rules-list {
  display: grid;
  gap: 0.3em;
}

.ot-rule-card {
  display: grid;
  grid-template-columns: min-content 1fr min-content;
  gap: 0.5em;
  align-items: center;
  background-color: var(--rule-card-background);
  border: 0.5px solid var(--rule-card-border);
  border-left-width: 0.3em;
  border-radius: 0.3em;
  padding: 0.3em 0.5em;
}

.ot-rule-card.k-ligature { border-left-color: var(--rule-kind-ligature); }
.ot-rule-card.k-contextual { border-left-color: var(--rule-kind-contextual); }
.ot-rule-card.k-substitution { border-left-color: var(--rule-kind-substitution); }
.ot-rule-card.k-decomposition { border-left-color: var(--rule-kind-decomposition); }
.ot-rule-card.k-deletion { border-left-color: var(--rule-kind-deletion); }
.ot-rule-card.k-unmanaged { border-left-color: var(--rule-kind-deletion); opacity: 0.7; }

.ot-rule-kind {
  font-size: 0.75em;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--muted-foreground-color, #666);
  white-space: nowrap;
}

.ot-rule-glyphs {
  font-family: monospace;
  font-size: 0.9em;
  overflow-x: auto;
  white-space: nowrap;
}

.ot-rule-glyphs .arrow {
  margin: 0 0.4em;
  opacity: 0.6;
}

.ot-rule-glyphs .missing {
  color: var(--preview-missing);
  text-decoration: underline wavy;
}

/* Per-rule sample */

.ot-rule-sample {
  display: flex;
  gap: 0.6em;
  align-items: center;
  flex-wrap: wrap;
  grid-column: 1 / -1;
}

.ot-rule-sample-canvas {
  background-color: var(--preview-background);
  border-radius: 0.25em;
  border: 0.5px solid var(--horizontal-rule-color);
  display: block;
}

.ot-rule-sample-text {
  font-size: 1.1em;
  line-height: 1.3;
}

.ot-rule-sample-label {
  font-size: 0.8em;
  color: var(--muted-foreground-color, #666);
  font-family: monospace;
}

.ot-feature-empty {
  font-style: italic;
  opacity: 0.7;
}

.ot-add-rule-row {
  display: flex;
  gap: 0.5em;
  align-items: center;
  flex-wrap: wrap;
}

.ot-add-rule-row input[type="text"] {
  font-family: monospace;
}
`);

const SAMPLE_FONT_SIZE = 34;
const SAMPLE_ASPECT = { width: 220, height: 56 };

// Collapsed/expanded state per feature tag, kept across re-renders.
const sectionOpenState = new Map();

function isSectionOpen(tag, defaultOpen = true) {
  if (sectionOpenState.has(tag)) {
    return sectionOpenState.get(tag);
  }
  return defaultOpen;
}

/**
 * Guess the indentation used by the statements in a block, so inserted rules
 * line up with the existing ones.
 */
function detectIndent(block, fallback = "  ") {
  for (const item of block?.items ?? []) {
    for (const line of (item.raw ?? "").split("\n")) {
      const match = /^[ \t]+(?=\S)/.exec(line);
      if (match) {
        return match[0];
      }
    }
  }
  return fallback;
}

/**
 * If a named lookup has no statements left, remove the lookup block itself.
 */
function removeLookupIfEmpty(lookup, model) {
  if (!lookup || !lookup.body) {
    return;
  }
  if (lookup.body.items.some((item) => (item.raw ?? "").trim())) {
    return;
  }
  const parentBodies = [
    model.root,
    ...model.features.filter((f) => f.body),
    ...model.lookups.filter((l) => l.body && l !== lookup),
  ];
  for (const body of parentBodies) {
    const index = body.items.indexOf(lookup);
    if (index >= 0) {
      body.items.splice(index, 1);
      return;
    }
  }
}

/**
 * A graphical editor for OpenType layout features.
 *
 * Each feature is a collapsible section; each rule inside it shows a live
 * sample of the input text beside the rule's own preview, so you can see what
 * the rule does without typing into a shared preview box.
 */
export class OpenTypeFeaturesPanel extends BaseInfoPanel {
  static title = "opentype-features.title";
  static id = "opentype-features-panel";
  static fontAttributes = ["features", "glyphMap"];

  initializePanel() {
    // Set up our own state *before* calling super: BaseInfoPanel.initializePanel()
    // calls this.setupUI() synchronously, so anything assigned afterwards would
    // be missing during that first render (and would then be re-rendered by the
    // async call below, duplicating the sections).
    this.previewFeatures = {};
    this._glyphInstances = new Map();
    this._shaper = null;
    this._shaperProblem = null;
    this._statusMessage = null;
    this._sampleQueue = [];
    // Guards against two concurrent setupUI() calls both rendering.
    this._setupInProgress = null;

    this.shaperController = new ShaperController(
      this.fontController,
      applicationSettingsController
    );

    // Expose for debugging / automated checks.
    window.__otFeaturesPanel = this;

    super.initializePanel();
  }

  async setupUI() {
    // Serialize: if a render is already in flight, wait for it and then do one
    // more pass with the latest data, rather than rendering concurrently.
    if (this._setupInProgress) {
      await this._setupInProgress;
    }
    this._setupInProgress = this._doSetupUI();
    try {
      await this._setupInProgress;
    } finally {
      this._setupInProgress = null;
    }
  }

  async _doSetupUI() {
    const features = await this.fontController.getFeatures();
    this.model = new FeatureCodeModel(features.text ?? "");
    this.model.fontController = this.fontController;

    this.panelElement.id = this.constructor.id;
    this.panelElement.innerHTML = "";

    // Make sure the shaper is ready before we draw any samples.
    await this._ensureShaper();

    const panel = html.div({ id: "opentype-features-panel" }, []);

    panel.appendChild(
      html.div({ class: "ot-features-toolbar" }, [
        html.span({ class: "ot-features-status" }, [
          this.model.features.length
            ? `${this.model.features.length} feature block${
                this.model.features.length == 1 ? "" : "s"
              }`
            : "no features yet",
        ]),
        html.span(
          {
            class: `ot-features-message ${
              this._statusMessage?.level || "info"
            }${this._statusMessage ? "" : " hidden"}`,
          },
          [this._statusMessage?.text || ""]
        ),
      ])
    );

    panel.appendChild(this._makeFeatureSectionsElement());
    panel.appendChild(this._makeAddFeatureElement());

    // A datalist of all glyph names, for autocompletion in the rule inputs.
    const glyphNames = Object.keys(this.fontController.glyphMap).sort();
    panel.appendChild(
      html.createDomElement(
        "datalist",
        { id: "ot-features-glyph-names" },
        glyphNames.map((name) => html.createDomElement("option", { value: name }))
      )
    );

    this.panelElement.appendChild(panel);

    // Draw the per-rule samples after the elements are in the document.
    this._renderAllSamples();
  }

  _makeFeatureSectionsElement() {
    const container = html.div({ class: "ot-sections" }, []);

    for (const group of getFeatureGroups()) {
      const tagsInGroup = group.tags.filter((tag) => this.model.hasTag(tag));
      if (!tagsInGroup.length) {
        continue;
      }
      container.appendChild(
        html.div({ class: "ot-group" }, [
          html.div({ class: "ot-group-title" }, [group.title]),
          ...tagsInGroup.map((tag) => this._makeFeatureSection(tag)),
        ])
      );
    }

    if (!this.model.features.length) {
      container.appendChild(
        html.div({ class: "ot-feature-empty" }, [
          "This font has no OpenType feature code yet. Add a feature below, ",
          "or use the Feature code panel to write FEA by hand.",
        ])
      );
    }

    return container;
  }

  _makeFeatureSection(tag) {
    const entries = this.model.rulesForTag(tag);
    const open = isSectionOpen(tag, true);
    const arabicName = ARABIC_JOINING_FEATURES[tag];
    const humanName = arabicName || featureTitle(tag).split(" — ")[1] || "";

    // NB: Fontra ships chevron-up and chevron-right but no chevron-down, so we
    // use chevron-up rotated -90deg to mean "collapsed". See the CSS.
    const chevron = html.createDomElement("inline-svg", {
      class: `ot-section-chevron${open ? "" : " closed"}`,
      src: open ? "/tabler-icons/chevron-up.svg" : "/tabler-icons/chevron-right.svg",
    });

    const header = html.div(
      {
        class: "ot-section-header",
        onclick: (event) => {
          if (event.target.closest("icon-button, a")) {
            return;
          }
          this._toggleSection(tag);
        },
      },
      [
        chevron,
        html.span({ class: "ot-feature-tag" }, [tag]),
        html.span({}, [humanName]),
        html.span({ class: "ot-feature-summary" }, [
          entries.length
            ? `${entries.length} rule${entries.length == 1 ? "" : "s"}`
            : "no rules",
        ]),
        this._makeFeatureToggle(tag),
        ...(() => {
          const docURL = featureDocURL(tag);
          return docURL
            ? [
                html.a(
                  {
                    class: "ot-feature-doc-link",
                    href: docURL,
                    target: "_blank",
                    onclick: (event) => event.stopPropagation(),
                  },
                  ["docs ↗"]
                ),
              ]
            : [];
        })(),
      ]
    );

    const body = html.div({ class: `ot-section-body${open ? "" : " closed"}` }, [
      entries.length
        ? html.div(
            { class: "ot-rules-list" },
            entries.map(({ rule, lookup }) => this._makeRuleCard(tag, rule, lookup))
          )
        : html.div({ class: "ot-feature-empty" }, [`No rules in ${tag} yet.`]),
      this._makeAddRuleElement(tag),
    ]);

    return html.div({ "class": "ot-feature-section", "data-tag": tag }, [header, body]);
  }

  _toggleSection(tag) {
    const open = !isSectionOpen(tag, true);
    sectionOpenState.set(tag, open);

    // Toggle in place rather than re-rendering, so the page does not scroll
    // back to the top (which a full setupUI() does).
    const section = this.panelElement.querySelector(
      `.ot-feature-section[data-tag="${tag}"]`
    );
    if (!section) {
      return;
    }
    const body = section.querySelector(".ot-section-body");
    const chevron = section.querySelector(".ot-section-chevron");
    body?.classList.toggle("closed", !open);
    chevron?.classList.toggle("closed", !open);
  }

  _isFeatureEnabledInPreview(tag) {
    return this.previewFeatures[tag] !== false;
  }

  _makeFeatureToggle(tag) {
    const isOn = this._isFeatureEnabledInPreview(tag);
    return html.createDomElement("icon-button", {
      src: isOn ? "/tabler-icons/eye.svg" : "/tabler-icons/eye-closed.svg",
      title: `${isOn ? "Disable" : "Enable"} ${tag} in the samples`,
      onclick: async () => {
        this.previewFeatures[tag] = !isOn;
        await this.setupUI();
      },
    });
  }

  _makeRuleCard(tag, rule, lookup) {
    const info = FeatureCodeModel.classifyRule(rule);
    const inputs = this.model.expandTokens(rule.inputs);
    const outputs = this.model.expandTokens(rule.output);

    const glyphElement = (entry) => {
      const rawName = entry.name;
      const isIgnored = rawName.endsWith("'");
      const bare = isIgnored ? rawName.slice(0, -1) : rawName;
      const label = isIgnored ? `${bare}'` : bare;

      const namesToCheck =
        entry.isClass && entry.members.length ? entry.members : [bare];
      const missing = namesToCheck.every((n) => !this.fontController.hasGlyph(n));

      const title = entry.isClass
        ? `${label} → ${entry.members.length || "?"} glyph(s)`
        : missing
          ? `${bare} is not in the font`
          : bare;

      return html.span({ class: missing ? "missing" : "", title }, [label]);
    };

    const side = (entries) =>
      entries.flatMap((entry, i) =>
        i ? [" ", glyphElement(entry)] : [glyphElement(entry)]
      );

    // The live sample for this rule.
    const sampleCanvas = html.createDomElement("canvas", {
      class: "ot-rule-sample-canvas",
    });
    const sample = describeRule(rule, this.model);
    sampleCanvas._rule = sample;
    sampleCanvas._tag = tag;

    const sampleRow = html.div({ class: "ot-rule-sample" }, [
      sampleCanvas,
      html.div({}, [
        html.div({ class: "ot-rule-sample-text" }, [sample.sampleText || "—"]),
        html.div({ class: "ot-rule-sample-label" }, [
          sample.outputLabel ? `→ ${sample.outputLabel}` : "→ (removed)",
        ]),
      ]),
    ]);

    const card = html.div({ class: `ot-rule-card k-${info.kind}` }, [
      html.span({ class: "ot-rule-kind" }, [info.label]),
      html.div({ class: "ot-rule-glyphs" }, [
        ...side(inputs),
        ...(outputs.length
          ? [html.span({ class: "arrow" }, ["→"]), ...side(outputs)]
          : []),
      ]),
      html.div({ style: "display: flex; gap: 0.3em; align-items: center;" }, [
        lookup
          ? html.span(
              { class: "ot-rule-kind", title: `Defined in lookup "${lookup.name}"` },
              ["↳ " + lookup.name]
            )
          : "",
        this.fontController.readOnly
          ? ""
          : html.createDomElement("icon-button", {
              src: "/tabler-icons/trash.svg",
              title: "Delete this rule",
              tabIndex: -1,
              onclick: async () => await this.deleteRule(rule, lookup),
            }),
      ]),
      sampleRow,
    ]);

    this._sampleQueue.push(sampleCanvas);
    return card;
  }

  _makeAddRuleElement(tag) {
    const inputField = this._makeGlyphNameInput("input glyph(s), e.g. f f or a a", 18);
    const outputField = this._makeGlyphNameInput("output glyph, e.g. f_f", 18);

    const addButton = html.input({
      type: "button",
      class: "fontra-button",
      value: "Add rule",
      onclick: async () => {
        const inputs = inputField.value.split(/\s+/).filter(Boolean);
        const outputs = outputField.value.split(/\s+/).filter(Boolean);
        if (!inputs.length) {
          return;
        }
        await this.addRule(tag, inputs, outputs);
      },
    });

    return html.div({ class: "ot-add-rule-row" }, [
      inputField,
      html.span({}, ["→"]),
      outputField,
      addButton,
    ]);
  }

  _makeGlyphNameInput(placeholder, size) {
    const el = html.createDomElement("input", {
      type: "text",
      placeholder,
      size,
    });
    el.setAttribute("list", "ot-features-glyph-names");
    return el;
  }

  _makeAddFeatureElement() {
    const field = html.createDomElement("input", {
      type: "text",
      placeholder: "feature tag, e.g. ss01",
      size: 8,
    });
    return html.div({ class: "ot-add-rule-row" }, [
      html.span({}, ["Add feature:"]),
      field,
      html.input({
        type: "button",
        class: "fontra-button",
        value: "Add",
        onclick: async () => {
          const tag = field.value.trim();
          if (tag.length == 4) {
            await this.addFeature(tag);
          }
        },
      }),
    ]);
  }

  /**
   * Show a transient message in the toolbar.
   */
  _setStatusMessage(text, level = "info") {
    this._statusMessage = text ? { text, level } : null;
    const el = this.panelElement.querySelector(".ot-features-message");
    if (el) {
      el.textContent = text || "";
      el.className = `ot-features-message ${level}`;
      el.classList.toggle("hidden", !text);
    }
  }

  // ---------------------------------------------------------------------
  // Per-rule samples
  // ---------------------------------------------------------------------

  async _ensureShaper() {
    try {
      const { shaper, messages } = await this.shaperController.getShaper(true);
      this._shaper = shaper;
      this._shaperProblem = messages?.length
        ? messages[0].text
        : !Object.keys(shaper.getFeatureInfo?.("GSUB") ?? {}).length
          ? "The feature code did not compile, so no substitutions are shown."
          : null;
    } catch (e) {
      console.error(e);
      this._shaper = null;
      this._shaperProblem = e.message || String(e);
    }
  }

  _renderAllSamples() {
    const queue = this._sampleQueue;
    this._sampleQueue = [];
    if (!queue.length) {
      return;
    }
    // Draw the first few immediately, the rest on the next frame so a font
    // with many rules does not block the UI.
    const draw = async () => {
      for (const canvas of queue) {
        await this._drawSample(canvas);
      }
    };
    draw();
  }

  async _drawSample(canvas) {
    const sample = canvas._rule;
    const tag = canvas._tag;
    if (!sample) {
      return;
    }
    if (!sample.sampleText) {
      this._sizeCanvas(canvas, 0);
      return;
    }
    if (this._shaperProblem) {
      this._sizeCanvas(canvas, 0);
      return;
    }

    const glyphs = await this._shape(sample.sampleText, tag);
    this._drawGlyphs(canvas, glyphs);
  }

  async _shape(text, tag) {
    const codePoints = [...text].map((c) => c.codePointAt(0));
    if (!codePoints.length || !this._shaper) {
      return [];
    }
    const glyphObjects = {};
    for (const [name, value] of this._glyphInstances) {
      glyphObjects[name] = value;
    }

    const options = {
      variations: {},
      features: this._featureSettings(),
      direction: guessDirectionFromCodePoints(codePoints),
      script: null,
      language: "dflt",
      kerningPairFunc: null,
      trace: false,
    };

    let result = this._shaper.shape(codePoints, glyphObjects, options);
    for (let pass = 0; pass < 4; pass++) {
      const missing = result.requiredGlyphs.filter((n) => !this._glyphInstances.has(n));
      if (!missing.length) {
        break;
      }
      let loaded = false;
      for (const name of missing) {
        const instance = await this.fontController.getGlyphInstance(name, {});
        if (instance) {
          this._glyphInstances.set(name, {
            xAdvance: instance.xAdvance,
            anchors: instance.anchors,
            propagatedAnchors: instance.propagatedAnchors,
            instance,
          });
          loaded = true;
        }
      }
      if (!loaded) {
        break;
      }
      const objs = {};
      for (const [name, value] of this._glyphInstances) {
        objs[name] = value;
      }
      result = this._shaper.shape(codePoints, objs, options);
    }
    return result.glyphs;
  }

  _featureSettings() {
    // Explicitly turn off any feature the user has disabled.
    const settings = [];
    for (const [t, on] of Object.entries(this.previewFeatures)) {
      if (on === false) {
        settings.push([t, 0]);
      }
    }
    return settings;
  }

  _sizeCanvas(canvas, width) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(width, 0);
    canvas.width = Math.max(Math.round(w * dpr), 1);
    canvas.height = Math.round(SAMPLE_ASPECT.height * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${SAMPLE_ASPECT.height}px`;
  }

  _drawGlyphs(canvas, glyphs) {
    if (!canvas.isConnected) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const unitsPerEm = this.fontController.unitsPerEm || 1000;
    const scale = (SAMPLE_FONT_SIZE / unitsPerEm) * dpr;

    let width = 0;
    for (const g of glyphs) {
      width += (g.xAdvance + (g.xOffset || 0)) * scale;
    }
    const padX = 6 * dpr;
    this._sizeCanvas(canvas, Math.min(width + padX * 2, 400));

    const context = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    context.clearRect(0, 0, w, h);
    if (!glyphs.length) {
      return;
    }

    const fill = getComputedStyle(canvas)
      .getPropertyValue("--preview-glyph-fill")
      .trim();
    context.fillStyle = fill || "#111";

    let x = padX;
    const baseline = h - 8 * dpr;
    for (const glyph of glyphs) {
      const obj = this._glyphInstances.get(glyph.glyphname);
      const path2d = obj?.instance?.flattenedPath2d;
      if (path2d) {
        context.save();
        context.translate(
          x + (glyph.xOffset || 0) * scale,
          baseline - (glyph.yOffset || 0) * scale
        );
        context.scale(scale, -scale);
        context.fill(path2d);
        context.restore();
      }
      x += glyph.xAdvance * scale;
    }
  }

  // ---------------------------------------------------------------------
  // Editing
  // ---------------------------------------------------------------------

  async addRule(tag, inputs, outputs) {
    if (this.fontController.readOnly) {
      showDialogCannotEditReadOnly();
      return;
    }
    await this._editFeatureCode((model) => {
      const statement = `sub ${inputs.join(" ")}${
        outputs.length ? ` by ${outputs.join(" ")}` : ""
      };\n`;

      const feature = model.features.find((f) => f.tag === tag);

      if (feature) {
        const wanted = `${inputs.join(" ")} by ${outputs.join(" ")}`;
        const existing = resolveFeatureLookups(feature, model.lookups).flatMap(
          (lookup) => collectSubRules(lookup.body)
        );
        const alreadyThere = existing.some((rule) => {
          const have = `${rule.inputs
            .map((i) => i.value)
            .join(" ")} by ${rule.output.map((o) => o.value).join(" ")}`;
          return have === wanted;
        });
        if (alreadyThere) {
          this._setStatusMessage(`${tag} already has a rule for ${wanted}.`, "warning");
          return false;
        }

        const lookups = resolveFeatureLookups(feature, model.lookups);
        const target =
          lookups.length >= 1 ? lookups[lookups.length - 1].body : feature.body;

        const indent = detectIndent(target);
        const lastItem = target.items[target.items.length - 1];
        const needsLeadingNewline = !lastItem || !lastItem.raw?.endsWith("\n");

        target.items.push({
          kind: "raw",
          raw: `${needsLeadingNewline ? "\n" : ""}${indent}${statement}`,
          start: -1,
          end: -1,
        });
      } else {
        model.root.items.push({
          kind: "raw",
          raw: `\nfeature ${tag} {\n  ${statement}} ${tag};\n`,
          start: -1,
          end: -1,
        });
      }
    }, `add ${tag} rule`);
  }

  async deleteRule(rule, lookup) {
    if (this.fontController.readOnly) {
      showDialogCannotEditReadOnly();
      return;
    }
    await this._editFeatureCode((model) => {
      const bodies = [];
      if (lookup && lookup.body) {
        bodies.push(lookup.body);
      }
      if (rule.parentBody) {
        bodies.push(rule.parentBody);
      }
      for (const node of [...model.features, ...model.lookups]) {
        if (node.body) {
          bodies.push(node.body);
        }
      }
      for (const body of bodies) {
        const index = body.items.indexOf(rule);
        if (index >= 0) {
          body.items.splice(index, 1);
          removeLookupIfEmpty(lookup, model);
          return;
        }
      }
    }, "delete rule");
  }

  async addFeature(tag) {
    if (this.fontController.readOnly) {
      showDialogCannotEditReadOnly();
      return;
    }
    await this._editFeatureCode((model) => {
      model.root.items.push({
        kind: "raw",
        raw: `\nfeature ${tag} {\n} ${tag};\n`,
        start: -1,
        end: -1,
      });
    }, `add feature ${tag}`);
  }

  async _editFeatureCode(editFunc, undoLabel) {
    const model = this.model;
    const result = editFunc(model);
    if (result === false) {
      await this.setupUI();
      return;
    }
    const newText = serializeFeatureCode(model.parsed);
    if (newText === model.text) {
      await this.setupUI();
      return;
    }
    await this._writeFeatureText(newText, undoLabel);
  }

  async _writeFeatureText(newText, undoLabel) {
    await this.fontController.performEdit(undoLabel, "features", (root) => {
      root.features.text = newText;
    });
    this._statusMessage = null;
    await this.setupUI();
  }
}
