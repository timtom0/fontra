import {
  parseFeatureCode,
  collectFeatures,
  collectLookups,
  collectSubRules,
  resolveFeatureLookups,
} from "@fontra/core/feature-code-parser.js";
import { features as otFeatures } from "@fontra/core/opentype-tags.js";

/**
 * Feature-model helpers shared by the OpenType feature GUI.
 *
 * The GUI edits `features.text` (FEA source) through the parser, so this
 * module only *reads* a convenient view of the parsed tree. All mutation goes
 * through FeatureCodeModel, which re-serializes the whole file.
 */

// Feature tags grouped for the GUI. Order matters: it drives the section order.
//
// A tag must appear in exactly ONE group. The panel renders one section per
// (group, tag) pair, so a tag listed in two groups produced a duplicate
// section (e.g. "calt" showing up under both Ligatures and Arabic).
//
// Where a tag serves more than one script, it is filed under the script that
// uses it most, and `FEATURE_GROUPS_OTHER` below collects the rest so every
// tag still gets a home.
export const FEATURE_GROUPS = [
  {
    id: "ligatures",
    title: "Ligatures",
    tags: ["liga", "clig", "dlig", "hlig"],
  },
  {
    id: "arabic",
    title: "Arabic",
    tags: [
      "isol",
      "init",
      "medi",
      "fina",
      "fin2",
      "fin3",
      "med2",
      "rlig",
      "calt",
      "rclt",
      "ccmp",
      "mark",
      "mkmk",
      "curs",
      "nukt",
      "stch",
      "mset",
      "vatu",
      "akhn",
      "rkrf",
      "half",
      "pres",
      "abvs",
      "blws",
      "psts",
      "haln",
      "abvf",
      "blwf",
      "pstf",
      "dist",
      "cjct",
      "rphf",
      "pref",
      "abvm",
      "blwm",
    ],
  },
  {
    id: "positioning",
    title: "Positioning",
    tags: ["kern"],
  },
  {
    id: "figures",
    title: "Figures & fractions",
    tags: [
      "lnum",
      "onum",
      "pnum",
      "tnum",
      "zero",
      "frac",
      "numr",
      "dnom",
      "sups",
      "subs",
      "sinf",
    ],
  },
  {
    id: "caps",
    title: "Caps & case",
    tags: ["smcp", "c2sc", "pcap", "c2pc", "unic", "case"],
  },
  {
    id: "stylistic",
    title: "Stylistic sets & alternates",
    tags: [
      "salt",
      "ss01",
      "ss02",
      "ss03",
      "ss04",
      "ss05",
      "ss06",
      "ss07",
      "ss08",
      "ss09",
      "ss10",
      "ss11",
      "ss12",
      "ss13",
      "ss14",
      "ss15",
      "ss16",
      "ss17",
      "ss18",
      "ss19",
      "ss20",
      "titl",
      "hist",
      "swsh",
      "cswh",
      "nalt",
      "ornm",
    ],
  },
  {
    id: "width",
    title: "Widths & vertical",
    tags: [
      "fwid",
      "hwid",
      "pwid",
      "twid",
      "qwid",
      "vert",
      "vrt2",
      "vrtr",
      "vhal",
      "vpal",
      "vkrn",
    ],
  },
  {
    id: "script",
    title: "Script & language",
    tags: ["locl", "ltra", "ltrm", "rtla", "rtlm", "rand"],
  },
];

// Groups whose tags are split across scripts: a feature in these families shows
// up under whichever script group already claims it, so they are not repeated.
export const FEATURE_GROUPS_OTHER = [
  {
    id: "indic",
    title: "Indic / other scripts",
    tags: [],
  },
];

/**
 * The groups the panel renders, with every known tag assigned to exactly one
 * group. Tags in a "split" family (Indic, Arabic, ...) that are not claimed by
 * a primary group fall into the shared bucket for that family, so no tag is
 * ever rendered in two sections.
 */
export function getFeatureGroups() {
  const groups = FEATURE_GROUPS.map((g) => ({ ...g, tags: [...g.tags] }));

  // Anything a "split" family would have claimed, minus what a primary group
  // already lists.
  const claimed = new Set(groups.flatMap((g) => g.tags));
  for (const other of FEATURE_GROUPS_OTHER) {
    const remaining = other.tags.filter((t) => !claimed.has(t));
    if (remaining.length) {
      groups.push({ ...other, tags: remaining });
    }
  }
  return groups;
}

/** Every tag that has a section, in render order, with no duplicates. */
export function getAllFeatureTags() {
  return getFeatureGroups().flatMap((g) => g.tags);
}

// Tags that take part in Arabic joining. Used to label rule kinds.
export const ARABIC_JOINING_FEATURES = {
  isol: "Isolated",
  init: "Initial",
  medi: "Medial",
  fina: "Final",
  fin2: "Final alt. 2",
  fin3: "Final alt. 3",
  med2: "Medial alt. 2",
  rlig: "Required ligature",
  calt: "Contextual alternates",
  rclt: "Required contextual",
  ccmp: "Composition / decomposition",
};

/**
 * A parsed view of the feature code, with indices into the tree.
 */
export class FeatureCodeModel {
  constructor(text) {
    this.text = text;
    this.parsed = parseFeatureCode(text);
    this.reparse();
  }

  reparse() {
    const parsed = this.parsed;
    this.features = collectFeatures(parsed.root);
    this.lookups = collectLookups(parsed.root);
    this.languageSystems = parsed.languageSystems;
  }

  get text() {
    return this._text;
  }

  set text(value) {
    this._text = value;
  }

  /**
   * All rules that a given feature tag actually applies, following
   * `lookup NAME;` references. Returns [{ rule, lookup }].
   */
  rulesForTag(tag) {
    const out = [];
    for (const feature of this.features) {
      if (feature.tag !== tag) {
        continue;
      }
      // Rules written directly in the feature body
      for (const rule of collectSubRules(feature.body)) {
        // Remember where the rule lives so the GUI can delete it.
        rule.parentBody = feature.body;
        out.push({ rule, feature, lookup: null });
      }
      // Rules in lookups the feature calls
      for (const lookup of resolveFeatureLookups(feature, this.lookups)) {
        for (const rule of collectSubRules(lookup.body)) {
          rule.parentBody = lookup.body;
          out.push({ rule, feature, lookup });
        }
      }
    }
    return out;
  }

  hasTag(tag) {
    return this.features.some((f) => f.tag === tag);
  }

  /**
   * All glyph class definitions, as a name -> members map.
   */
  get glyphClasses() {
    if (!this._glyphClasses) {
      this._glyphClasses = new Map();
      for (const item of this.parsed.root.items) {
        if (item.kind === "glyphclassdef" && item.members.length) {
          this._glyphClasses.set(item.name, item.members);
        }
      }
    }
    return this._glyphClasses;
  }

  /**
   * Expand a rule side into concrete glyph names, resolving glyph classes
   * ("@FIGURES") into their members so the GUI can show and validate them.
   *
   * Returns a list of { name, isClass, members }.
   */
  expandTokens(tokens) {
    return tokens.map((token) => {
      const isClassRef = token.type === "glyphclassref";
      if (isClassRef) {
        return {
          name: token.name,
          isClass: true,
          members: this.glyphClasses.get(token.value) || [],
        };
      }
      if (token.type === "glyphclass") {
        return {
          name: token.value,
          isClass: !token.isRange,
          isRange: !!token.isRange,
          members: token.members || [],
        };
      }
      return { name: token.value, isClass: false, members: [] };
    });
  }

  /**
   * Human-readable glyph list for a rule side (inputs or outputs).
   */
  static glyphNames(tokens) {
    return tokens.map((t) => t.value);
  }

  /**
   * Classify a sub rule for display purposes.
   */
  static classifyRule(rule) {
    if (!rule.editable) {
      return { kind: "unmanaged", label: "not editable here" };
    }
    const inputCount = rule.inputs.length;
    if (inputCount == 0) {
      return { kind: "unmanaged", label: "no input" };
    }
    if (inputCount == 1) {
      const outputCount = rule.output.length;
      if (outputCount == 1) {
        return { kind: "substitution", label: "substitution" };
      }
      if (outputCount > 1) {
        return { kind: "decomposition", label: "decomposition" };
      }
      return { kind: "deletion", label: "deletion" };
    }
    return {
      kind: rule.output.length == 1 ? "ligature" : "contextual",
      label: rule.output.length == 1 ? "ligature" : "contextual",
    };
  }

  /**
   * Does this rule look like an Arabic joining-context rule?
   * i.e. an ignored joining glyph followed by a base, mapping to a
   * positioned form.
   */
  static isArabicContextRule(rule) {
    if (rule.inputs.length < 2 || rule.output.length != 1) {
      return false;
    }
    // At least one ignored (') input, which is how Arabic joining contexts
    // are written: "sub behDotless-ar.init beh-ar' by behDotless-ar.init.beh"
    return rule.inputs.some((t) => t.value.endsWith("'"));
  }
}

export function featureTitle(tag) {
  const entry = otFeatures[tag];
  return entry ? `${tag} — ${entry[0]}` : tag;
}

export function featureDocURL(tag) {
  const entry = otFeatures[tag];
  return entry ? entry[1] : null;
}
