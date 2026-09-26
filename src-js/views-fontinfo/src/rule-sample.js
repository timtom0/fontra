import { getCodePointFromGlyphName } from "@fontra/core/glyph-data.js";

/**
 * Work out sample text for a substitution rule, so the GUI can show what the
 * rule actually does instead of only naming the glyphs.
 *
 * A rule looks like:
 *   sub f i by f_i;                 -> sample text "fi"
 *   sub beh-ar.init' lam-ar by lam-ar.init;
 *                                 -> sample text "بل" (beh + lam)
 *   sub alef-ar by alef-ar.fina;    -> sample text "ا"
 *
 * The trick with contextual rules is the apostrophe: "beh-ar.init'" is an
 * *ignored* glyph, so it must NOT appear in the sample text -- only the
 * remaining inputs do.
 */

/** Strip a trailing "'" (the "ignore this glyph" marker). */
export function stripIgnoreMark(name) {
  return name.endsWith("'") ? name.slice(0, -1) : name;
}

/** Is this a glyph class reference ("@ABC") or range? */
function isClassToken(token) {
  return token.type === "glyphclassref" || token.type === "glyphclass";
}

/**
 * Build the *input* string for a rule: the glyph names that should appear in
 * the sample text, in logical order, with ignored glyphs removed.
 *
 * @param {object} rule   a parsed sub rule
 * @param {object} model  a FeatureCodeModel, used to resolve glyph classes
 * @returns {{names: string[], classes: Array<{token: string, members: string[]}>}}
 */
export function ruleInputNames(rule, model) {
  const names = [];
  const classes = [];

  for (const token of rule.inputs ?? []) {
    // An ignored glyph (trailing "'") is context, not content: it must not
    // appear in the sample text. NB: check the mark, not emptiness --
    // stripIgnoreMark("beh-ar.init'") is a non-empty string.
    if (token.value?.endsWith?.("'")) {
      continue;
    }
    const raw = stripIgnoreMark(token.value);
    if (!raw) {
      continue;
    }
    if (isClassToken(token)) {
      const members = model?.expandTokens?.([token])?.[0]?.members ?? [];
      classes.push({ token: raw, members: members.filter(Boolean) });
      // Use the first member as the stand-in character.
      if (members.length) {
        names.push(members[0]);
      }
      continue;
    }
    names.push(raw);
  }

  return { names, classes };
}

/**
 * A short human label for a rule's input, e.g. "fi" or "beh lam".
 */
export function ruleInputLabel(rule, model) {
  const { names } = ruleInputNames(rule, model);
  if (!names.length) {
    return "";
  }
  // Prefer the actual characters when the glyphs are in the font's cmap.
  const chars = names.map((name) => glyphToChar(name, model));
  if (chars.every((c) => c)) {
    return chars.join("");
  }
  return names.join(" ");
}

/**
 * The character a glyph name represents, if any.
 *
 * Order of preference:
 *   1. The font's own cmap (authoritative for this font).
 *   2. The Glyphs glyph-data database, which knows that "behDotless-ar" is
 *      U+062E and "kaf-ar" is U+0643.
 *   3. For a suffixed form such as "beh-ar.init", the base name "beh-ar".
 *   4. Naming conventions (uniXXXX / uXXXX) and bare single letters.
 */
export function glyphToChar(glyphName, model) {
  if (!glyphName) {
    return null;
  }
  if (model?.fontController) {
    const codePoints = model.fontController.glyphMap?.[glyphName];
    if (codePoints?.length) {
      const cp = codePoints[0];
      if (cp >= 0 && cp < 0x110000) {
        return String.fromCodePoint(cp);
      }
    }
  }

  const char = glyphNameToChar(glyphName);
  if (char) {
    return char;
  }

  // "beh-ar.init" -> "beh-ar", "lam_alef-ar.fina" -> "lam_alef-ar"
  const dotIndex = glyphName.indexOf(".");
  if (dotIndex > 0) {
    return glyphNameToChar(glyphName.slice(0, dotIndex));
  }
  return null;
}

const UNI_RE = /^uni([0-9A-Fa-f]{4,6})$/;
const U_RE = /^u([0-9A-Fa-f]{4,6})$/;

function glyphNameToChar(glyphName) {
  const match = UNI_RE.exec(glyphName) ?? U_RE.exec(glyphName);
  if (match) {
    const cp = parseInt(match[1], 16);
    if (cp < 0x110000) {
      return String.fromCodePoint(cp);
    }
    return null;
  }

  // Single letter names, e.g. "f" or "A"
  if (glyphName.length === 1 && /[a-zA-Z]/.test(glyphName)) {
    return glyphName;
  }

  // The Glyphs glyph database: try the name, then progressively shorter
  // prefixes ("behDotless-ar" -> "behDotless" -> "beh").
  try {
    const cp = getCodePointFromGlyphName(glyphName);
    if (cp != null && cp >= 0 && cp < 0x110000) {
      return String.fromCodePoint(cp);
    }
  } catch {
    // The database is loaded lazily; a miss is fine.
  }
  return null;
}

/**
 * A label for what the rule produces, e.g. "f_i" or "lam-alef".
 */
export function ruleOutputLabel(rule, model) {
  const outputs = rule.output ?? [];
  if (!outputs.length) {
    return "";
  }
  const parts = outputs.map((token) => {
    const raw = stripIgnoreMark(token.value);
    if (isClassToken(token)) {
      return `${raw} (class)`;
    }
    return raw;
  });
  if (parts.length === 1) {
    // Show the character too, when we can, e.g. "f_i → fi"
    const char = glyphToChar(stripIgnoreMark(outputs[0].value), model);
    return char ? `${parts[0]} (${char})` : parts[0];
  }
  return parts.join(" ");
}

/**
 * Everything the panel needs to render a rule's preview line.
 *
 * Returns:
 *   sampleText  the characters to shape ("" if we can't work it out)
 *   inputLabel  e.g. "fi"
 *   outputLabel e.g. "f_i (fi)"
 *   isContextual whether the rule depends on surrounding glyphs
 */
export function describeRule(rule, model) {
  const info = FeatureCodeModelShim.classify(rule);
  const { names, classes } = ruleInputNames(rule, model);

  // For a contextual rule the first input is the glyph being replaced, so we
  // show it *last* to mirror the reading order, which is what a shaper does.
  let sampleText = "";
  if (names.length) {
    const chars = names.map((name) => glyphToChar(name, model));
    if (chars.every((c) => c)) {
      sampleText = chars.join("");
    }
  }

  return {
    sampleText,
    inputLabel: ruleInputLabel(rule, model),
    outputLabel: ruleOutputLabel(rule, model),
    // The output glyph names, with class references expanded, so the panel can
    // draw each one on its own.
    outputGlyphs: (rule.output ?? []).flatMap((token) => {
      const raw = stripIgnoreMark(token.value);
      if (!raw) {
        return [];
      }
      if (isClassToken(token)) {
        return model?.expandTokens?.([token])?.[0]?.members?.filter(Boolean) ?? [];
      }
      return [raw];
    }),
    isContextual: info.kind === "contextual" || info.kind === "ligature",
    kind: info.kind,
    kindLabel: info.label,
    classes,
  };
}

// Local copy of the classification, so this module does not depend on the
// model (keeps it usable in isolation and in tests).
const FeatureCodeModelShim = {
  classify(rule) {
    const inputCount = (rule.inputs ?? []).length;
    const outputCount = (rule.output ?? []).length;
    if (inputCount === 0) {
      return { kind: "unmanaged", label: "not editable here" };
    }
    if (inputCount === 1) {
      if (outputCount === 1) {
        return { kind: "substitution", label: "substitution" };
      }
      if (outputCount > 1) {
        return { kind: "decomposition", label: "decomposition" };
      }
      return { kind: "deletion", label: "deletion" };
    }
    return {
      kind: outputCount === 1 ? "ligature" : "contextual",
      label: outputCount === 1 ? "ligature" : "contextual",
    };
  },
};

export { getCodePointFromGlyphName };
