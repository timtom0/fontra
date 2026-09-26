import { applicationSettingsController } from "@fontra/core/application-settings.js";
import { guessDirectionFromCodePoints } from "@fontra/core/glyph-data.js";
import * as html from "@fontra/core/html-utils.js";
import { addStyleSheet } from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
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
  FEATURE_GROUPS,
  FeatureCodeModel,
  featureDocURL,
  featureTitle,
} from "./feature-code-model.js";
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
};

addStyleSheet(`
${themeColorCSS(colors, ":root")}

#opentype-features-panel {
  display: grid;
  grid-template-rows: min-content auto;
  gap: 0.5em;
  height: 100%;
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

/* Preview */

.ot-features-preview-container {
  display: grid;
  grid-template-columns: min-content min-content 1fr;
  gap: 0.5em;
  align-items: center;
  background-color: var(--ui-element-background-color);
  border-radius: 0.5em;
  padding: 0.5em;
}

.ot-features-preview-canvas {
  background-color: var(--preview-background);
  border-radius: 0.3em;
  border: 0.5px solid var(--horizontal-rule-color);
  display: block;
}

.ot-features-preview-info {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.2em 0.75em;
  font-size: 0.9em;
  align-content: center;
  max-height: 8em;
  overflow-y: auto;
}

.ot-features-preview-info .key {
  color: var(--muted-foreground-color, #666);
}

.ot-features-preview-info .value.missing {
  color: var(--preview-missing);
  font-weight: bold;
}

.ot-features-glyph-inputs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25em;
  align-items: center;
}

.ot-features-glyph-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  background-color: var(--ui-element-background-color);
  border: 0.5px solid var(--horizontal-rule-color);
  border-radius: 0.3em;
  padding: 0.1em 0.4em;
  font-family: monospace;
  font-size: 0.9em;
}

.ot-features-glyph-chip.missing {
  border-color: var(--preview-missing);
  color: var(--preview-missing);
}

/* Rules */

.ot-feature-section {
  display: grid;
  gap: 0.4em;
}

.ot-feature-header {
  display: flex;
  gap: 0.5em;
  align-items: center;
  flex-wrap: wrap;
}

.ot-feature-tag {
  font-family: monospace;
  font-weight: bold;
  background-color: var(--ui-element-background-color);
  border-radius: 0.3em;
  padding: 0.1em 0.4em;
}

.ot-feature-doc-link {
  color: inherit;
  opacity: 0.7;
  display: inline-flex;
  align-items: center;
  gap: 0.2em;
}

.ot-rules-list {
  display: grid;
  gap: 0.3em;
  padding-left: 1.2em;
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
  font-size: 0.8em;
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

.ot-rule-glyphs .ignored {
  opacity: 0.55;
  font-style: italic;
}

.ot-rule-glyphs .missing {
  color: var(--preview-missing);
  text-decoration: underline wavy;
}

.ot-feature-empty {
  font-style: italic;
  opacity: 0.7;
  padding-left: 1.2em;
}

.ot-add-rule-row {
  display: flex;
  gap: 0.5em;
  align-items: center;
  flex-wrap: wrap;
  padding-left: 1.2em;
}

.ot-add-rule-row input[type="text"] {
  font-family: monospace;
}
`);

const PREVIEW_FONT_SIZE = 46;

/**
 * Guess the indentation used by the statements in a block, so inserted rules
 * line up with the existing ones. Falls back to two spaces.
 *
 * NB: a statement's raw text starts with the whitespace that precedes it, and
 * that usually begins with a newline, so we measure the indentation of the
 * *first* line that has actual content.
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
 * A leftover "lookup foo { } foo;" is dead weight and feaLib will complain if
 * it is the only content left.
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
 * Instead of hand-writing FEA, the user picks a feature tag (ligatures,
 * contextual alternates, the Arabic joining features, ...) and edits the
 * substitution rules as rows. A live preview shapes sample text through
 * HarfBuzz with the actual feature code, so changes are visible immediately.
 */
export class OpenTypeFeaturesPanel extends BaseInfoPanel {
  static title = "opentype-features.title";
  static id = "opentype-features-panel";
  static fontAttributes = ["features", "glyphMap"];

  initializePanel() {
    super.initializePanel();

    this.shaperController = new ShaperController(
      this.fontController,
      applicationSettingsController
    );

    this.previewText = "";
    this.selectedTag = "liga";
    this.previewScript = null;
    this.previewLanguage = "dflt";
    this.previewFeatures = {};
    this._glyphInstances = new Map();
    this._updatePreviewScheduled = null;

    this.setupUI();
  }

  async setupUI() {
    const features = await this.fontController.getFeatures();
    this.model = new FeatureCodeModel(features.text ?? "");

    this.panelElement.id = this.constructor.id;
    this.panelElement.innerHTML = "";

    const panel = html.div({ id: "opentype-features-panel" }, []);

    // --- Toolbar ---------------------------------------------------------
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
        ...this._makeFeatureTagSelector(),
      ])
    );

    // --- Preview ---------------------------------------------------------
    panel.appendChild(this._makePreviewElement());

    // --- Feature sections ------------------------------------------------
    panel.appendChild(this._makeFeatureSectionsElement());

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
    this.panelElement.focus?.();

    await this.updatePreview();
  }

  _makeFeatureTagSelector() {
    // Collect the tags that actually exist, grouped for a readable menu.
    const existingTags = new Set(this.model.features.map((f) => f.tag));
    const allTagsInGroups = new Set();
    for (const group of FEATURE_GROUPS) {
      for (const tag of group.tags) {
        allTagsInGroups.add(tag);
      }
    }

    const makeOption = (tag) => {
      const el = html.button(
        {
          class: "fontra-button",
          onclick: () => this._selectTag(tag),
          title: featureDocURL(tag) || featureTitle(tag),
        },
        [tag]
      );
      el.dataset.tag = tag;
      el.classList.toggle("selected", tag === this.selectedTag);
      return el;
    };

    const elements = [];
    for (const group of FEATURE_GROUPS) {
      // Only show groups that have at least one relevant tag
      const relevant = group.tags.filter(
        (t) => existingTags.has(t) || allTagsInGroups.has(t)
      );
      if (!relevant.length) {
        continue;
      }
      const header = html.div(
        { style: "font-weight: bold; opacity: 0.8; margin-top: 0.4em;" },
        [group.title]
      );
      const buttons = html.div(
        { style: "display: flex; flex-wrap: wrap; gap: 0.3em;" },
        relevant.map(makeOption)
      );
      elements.push(header, buttons);
    }

    return [
      html.div({ style: "flex-basis: 100%;" }, [
        html.span({ style: "font-weight: bold; margin-right: 0.5em;" }, ["Feature:"]),
        ...elements,
      ]),
    ];
  }

  _selectTag(tag) {
    this.selectedTag = tag;
    this.setupUI();
  }

  /**
   * Show a transient message in the toolbar (used for "nothing to do" cases
   * like adding a duplicate rule).
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

  _makePreviewElement() {
    this.previewCanvas = html.createDomElement("canvas", {
      class: "ot-features-preview-canvas",
    });
    this.previewInfoElement = html.div({
      class: "ot-features-preview-info",
    });

    // Debounce: shaping on every keystroke is wasteful.
    this._scheduleUpdatePreview = scheduleCalls(() => this.updatePreview(), 150);

    const textInput = html.createDomElement("input", {
      type: "text",
      id: "ot-features-preview-text",
      value: this.previewText,
      placeholder: "type text to preview, e.g. office or بسم",
      size: 30,
    });
    textInput.addEventListener("input", () => {
      this.previewText = textInput.value;
      this._scheduleUpdatePreview();
    });

    return html.div({ class: "ot-features-preview-container" }, [
      html.div({ style: "display: grid; gap: 0.3em;" }, [
        html.label({ for: "ot-features-preview-text" }, ["Preview text:"]),
        textInput,
      ]),
      this.previewCanvas,
      this.previewInfoElement,
    ]);
  }

  _makeFeatureSectionsElement() {
    const container = html.div({ style: "display: grid; gap: 1em;" }, []);

    for (const group of FEATURE_GROUPS) {
      // Show the Arabic group first when an Arabic feature is selected
      const tagsInGroup = group.tags.filter((tag) => this.model.hasTag(tag));
      if (!tagsInGroup.length) {
        continue;
      }
      container.appendChild(
        html.div({ class: "ot-feature-section" }, [
          html.div({ style: "font-weight: bold;" }, [group.title]),
          ...tagsInGroup.map((tag) => this._makeFeatureSection(tag)),
        ])
      );
    }

    if (!this.model.features.length) {
      container.appendChild(
        html.div({ class: "ot-feature-empty" }, [
          "This font has no OpenType feature code yet. Use the ",
          html.a({ href: "#opentype-feature-code-panel" }, ["Feature code"]),
          " panel to add some, or add a feature below.",
        ])
      );
      container.appendChild(this._makeAddFeatureElement());
    }

    return container;
  }

  _makeFeatureSection(tag) {
    const selected = tag === this.selectedTag;
    const entries = this.model.rulesForTag(tag);
    const arabicName = ARABIC_JOINING_FEATURES[tag];

    const header = html.div({ class: "ot-feature-header" }, [
      html.span({ class: "ot-feature-tag" }, [tag]),
      html.span({}, [arabicName || featureTitle(tag).split(" — ")[1] || ""]),
      this._makeFeatureToggle(tag, selected),
    ]);

    const docURL = featureDocURL(tag);
    if (docURL) {
      header.appendChild(
        html.a({ class: "ot-feature-doc-link", href: docURL, target: "_blank" }, [
          "docs ↗",
        ])
      );
    }

    const bodyItems = [];
    if (entries.length) {
      bodyItems.push(
        html.div(
          { class: "ot-rules-list" },
          entries.map(({ rule, lookup }) => this._makeRuleCard(tag, rule, lookup))
        )
      );
    } else {
      bodyItems.push(html.div({ class: "ot-feature-empty" }, [`No rules in ${tag}.`]));
    }

    if (selected && !this.fontController.readOnly) {
      bodyItems.push(this._makeAddRuleElement(tag));
    }

    return html.div(
      {
        class: "ot-feature-section",
        style: selected
          ? "outline: 1px solid var(--horizontal-rule-color); outline-offset: 4px; border-radius: 0.3em;"
          : "",
      },
      [header, ...bodyItems]
    );
  }

  _makeFeatureToggle(tag, selected) {
    const isOn = this.previewFeatures[tag];
    return html.createDomElement("icon-button", {
      src: isOn ? "/tabler-icons/eye.svg" : "/tabler-icons/eye-closed.svg",
      title: `${isOn ? "Disable" : "Enable"} ${tag} in the preview`,
      onclick: async () => {
        this.previewFeatures[tag] = !isOn;
        await this.updatePreview();
        this.setupUI();
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

      // A glyph class is only "missing" if none of its members exist.
      const namesToCheck =
        entry.isClass && entry.members.length ? entry.members : [bare];
      const missing = namesToCheck.every((n) => !this.fontController.hasGlyph(n));

      const title = entry.isClass
        ? `${label} → ${entry.members.length || "?"} glyph(s)`
        : missing
          ? `${bare} is not in the font`
          : bare;

      return html.span(
        {
          class: missing ? "missing" : "",
          title,
        },
        [label]
      );
    };

    const side = (entries) =>
      entries.flatMap((entry, i) =>
        i ? [" ", glyphElement(entry)] : [glyphElement(entry)]
      );

    return html.div({ class: `ot-rule-card k-${info.kind}` }, [
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
          : null,
        // Every rule can be deleted, including rules that live in a named
        // lookup — deleteRule() removes it from wherever it is defined.
        this.fontController.readOnly
          ? null
          : html.createDomElement("icon-button", {
              src: "/tabler-icons/trash.svg",
              title: "Delete this rule",
              tabIndex: -1,
              onclick: async () => await this.deleteRule(rule, lookup),
            }),
      ]),
    ]);
  }

  _makeGlyphNameInput(placeholder, size) {
    const el = html.createDomElement("input", {
      type: "text",
      placeholder,
      size,
    });
    // "list" is a read-only DOM property, so it must be set with
    // setAttribute(), not via createDomElement's attribute assignment.
    el.setAttribute("list", "ot-features-glyph-names");
    return el;
  }

  _makeAddRuleElement(tag) {
    const inputField = this._makeGlyphNameInput("input glyph(s), e.g. f f or a a", 18);
    const outputField = this._makeGlyphNameInput("output glyph, e.g. f_f", 18);

    const addButton = html.input({
      type: "button",
      class: "fontra-button",
      value: "Add rule",
      onclick: async () => {
        const inputs = inputField.value.split(/\s+/).filter((s) => s);
        const outputs = outputField.value.split(/\s+/).filter((s) => s);
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
        // Refuse a rule that duplicates one already in this feature: feaLib
        // rejects it ("Already defined substitution"), and the user would
        // rather hear that here than see the feature silently fail to build.
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

        // Prefer appending to a lookup the feature already calls: that's where
        // a type designer would add the rule, and it keeps the feature block
        // itself as a clean list of references.
        const lookups = resolveFeatureLookups(feature, model.lookups);
        const target =
          lookups.length >= 1 ? lookups[lookups.length - 1].body : feature.body;

        // Match the indentation of the rules already in this block, and start
        // on a fresh line: the previous statement's text does not include the
        // newline that precedes "}" (that lives in trailingRaw).
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
        // Create a new feature block at the end of the file.
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
      // The rule always lives in a body: either the lookup that defines it or
      // the feature block itself.
      const bodies = [];
      if (lookup && lookup.body) {
        bodies.push(lookup.body);
      }
      if (rule.parentBody) {
        bodies.push(rule.parentBody);
      }
      // As a fallback, search every feature and lookup body.
      for (const node of [...model.features, ...model.lookups]) {
        if (node.body) {
          bodies.push(node.body);
        }
      }
      for (const body of bodies) {
        const index = body.items.indexOf(rule);
        if (index >= 0) {
          body.items.splice(index, 1);
          // If that emptied a named lookup, drop the lookup block too, so we
          // don't leave a stray "lookup foo { } foo;" behind.
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

  /**
   * Apply an edit to the parsed model and write the result back to the font.
   *
   * `editFunc` may return `false` to abort without writing (e.g. the user asked
   * for a rule that already exists).
   */
  async _editFeatureCode(editFunc, undoLabel) {
    const model = this.model;
    const result = editFunc(model);
    if (result === false) {
      // The edit was rejected; just refresh so the UI matches the font again.
      await this.setupUI();
      return;
    }
    const newText = serializeFeatureCode(model.parsed);
    if (newText === model.text) {
      // Nothing actually changed (e.g. deleting the only remaining rule).
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

  // ---------------------------------------------------------------------
  // Live preview
  // ---------------------------------------------------------------------

  async updatePreview() {
    if (!this.previewCanvas) {
      return;
    }
    // Expose for debugging / automated checks.
    window.__otFeaturesPanel = this;

    const codePoints = [...this.previewText].map((c) => c.codePointAt(0));

    if (!codePoints.length) {
      this._drawPreview([]);
      this._updatePreviewInfo([], []);
      return;
    }

    let shapedGlyphs = [];
    let glyphObjects = {};
    let requiredGlyphs = new Set();

    try {
      const { shaper, messages } = await this.shaperController.getShaper(true);

      // If the feature code did not compile, the shaper silently falls back to
      // the dumb shaper (no substitutions at all). Say so, rather than leaving
      // the user staring at a preview that ignores their features.
      //
      // NB: don't test the class name: the bundle is minified, so names like
      // "HBShaper" don't survive. getFeatureInfo() only returns real GSUB data
      // for the HarfBuzz shaper.
      if (messages?.length) {
        this._shaperProblem = messages[0].text;
      } else {
        this._shaperProblem = null;
      }
      if (!Object.keys(shaper.getFeatureInfo?.("GSUB") ?? {}).length) {
        this._shaperProblem =
          "No compiled features: the feature code did not build a shaper " +
          "font, so substitutions are not applied. Check the Feature Code panel.";
      }
      const shaperOptions = {
        variations: {},
        features: this._previewFeatureSettings(),
        direction: this._previewDirectionFor(codePoints),
        script: this._previewScriptFor(codePoints),
        language: this.previewLanguage,
        kerningPairFunc: null,
        trace: false,
      };

      let result = shaper.shape(codePoints, glyphObjects, shaperOptions);

      // Load the glyph instances the shaper asks for, then re-shape. Iterate
      // until the shaper stops asking for new glyphs: a first pass may only
      // reveal the substitutions it can make before it knows the advances of
      // the substituted glyphs (this is what the glyph editor does too).
      for (let pass = 0; pass < 4; pass++) {
        const missing = result.requiredGlyphs.filter(
          (glyphName) => !this._glyphInstances.has(glyphName)
        );
        if (!missing.length) {
          break;
        }

        let loadedAny = false;
        for (const glyphName of missing) {
          const instance = await this.fontController.getGlyphInstance(glyphName, {});
          if (instance) {
            this._glyphInstances.set(glyphName, {
              xAdvance: instance.xAdvance,
              anchors: instance.anchors,
              propagatedAnchors: instance.propagatedAnchors,
              instance,
            });
            loadedAny = true;
          }
        }

        for (const glyphName of result.requiredGlyphs) {
          requiredGlyphs.add(glyphName);
        }

        if (!loadedAny) {
          break;
        }

        const glyphObjects2 = {};
        for (const [name, value] of this._glyphInstances) {
          glyphObjects2[name] = value;
        }
        result = shaper.shape(codePoints, glyphObjects2, shaperOptions);
      }

      shapedGlyphs = result.glyphs;
    } catch (e) {
      console.error(e);
      this._updatePreviewInfo([], [{ text: e.message || String(e), level: "error" }]);
      this._drawPreview([]);
      return;
    }

    this._drawPreview(shapedGlyphs);
    this._updatePreviewInfo(shapedGlyphs, []);
  }

  _previewFeatureSettings() {
    // Ask HarfBuzz to apply the features the user toggled on, plus keep the
    // default-on set. Features toggled *off* are explicitly disabled.
    const settings = [];
    for (const [tag, onOff] of Object.entries(this.previewFeatures)) {
      settings.push([tag, onOff ? 1 : 0]);
    }
    return settings;
  }

  _previewScriptFor(codePoints) {
    // Let HarfBuzz guess the script unless the user pinned one.
    return this.previewScript || null;
  }

  /**
   * Direction for shaping. HarfBuzz's guessSegmentProperties() handles this
   * when the buffer is unset, but being explicit makes Arabic previews
   * reliable: without "rtl" the joining features are never applied.
   */
  _previewDirectionFor(codePoints) {
    if (this.previewDirection) {
      return this.previewDirection;
    }
    if (!codePoints.length) {
      return null;
    }
    // Use Fontra's own heuristic (same one the glyph editor's text tool uses).
    return guessDirectionFromCodePoints(codePoints);
  }

  _drawPreview(glyphs) {
    const canvas = this.previewCanvas;
    if (!canvas) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const unitsPerEm = this.fontController.unitsPerEm || 1000;
    const scale = (PREVIEW_FONT_SIZE / unitsPerEm) * dpr;

    // Measure
    let width = 0;
    let maxHeight = 0;
    for (const glyph of glyphs) {
      width += (glyph.xAdvance + (glyph.xOffset || 0)) * scale;
      maxHeight = Math.max(maxHeight, Math.abs(glyph.yOffset || 0) * scale);
    }
    width = Math.max(width + 20 * dpr, 100 * dpr);
    const height = (PREVIEW_FONT_SIZE + 20) * dpr;

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width / dpr}px`;
    canvas.style.height = `${height / dpr}px`;

    const context = canvas.getContext("2d");
    context.clearRect(0, 0, width, height);
    if (!glyphs.length) {
      return;
    }

    // canvas.fillStyle does not understand CSS custom properties, so resolve
    // the theme colour through getComputedStyle.
    const fillColor = getComputedStyle(this.panelElement)
      .getPropertyValue("--preview-glyph-fill")
      .trim();
    context.fillStyle = fillColor || "#111111";

    let x = 10 * dpr;
    const baseline = height - 10 * dpr;

    for (const glyph of glyphs) {
      const glyphObject = this._glyphInstances.get(glyph.glyphname);
      const path2d = glyphObject?.instance?.flattenedPath2d;
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

  _updatePreviewInfo(glyphs, messages) {
    const el = this.previewInfoElement;
    if (!el) {
      return;
    }
    el.innerHTML = "";

    if (messages.length) {
      for (const message of messages) {
        el.appendChild(html.div({ class: "value missing" }, [message.text]));
      }
      return;
    }

    if (!glyphs.length) {
      el.appendChild(html.div({ class: "key" }, ["Enter some text above."]));
      return;
    }

    if (this._shaperProblem) {
      el.appendChild(html.div({ class: "value missing" }, [this._shaperProblem]));
    }

    el.appendChild(html.div({ class: "key" }, [`${glyphs.length} glyph(s):`]));
    el.appendChild(
      html.div({ class: "value" }, [
        glyphs
          .map((g) => {
            const missing = !this.fontController.hasGlyph(g.glyphname);
            return html.span(
              {
                class: missing ? "missing" : "",
                title: missing ? "not in font" : g.glyphname,
              },
              [g.glyphname]
            );
          })
          .flatMap((el, i) => (i ? [" ", el] : [el])),
      ])
    );
  }
}
