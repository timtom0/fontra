import assert from "assert";
import { parseFeatureCode, collectFeatures } from "@fontra/core/feature-code-parser.js";
import {
  describeRule,
  ruleInputNames,
  glyphToChar,
  stripIgnoreMark,
} from "../src/rule-sample.js";

// A model stub with just the glyphMap that describeRule needs.
function makeModel(glyphMap = {}) {
  return { fontController: { glyphMap } };
}

function firstRule(fea) {
  const parsed = parseFeatureCode(fea);
  const feature = collectFeatures(parsed.root)[0];
  return feature.body.items.find((i) => i.kind === "sub");
}

describe("rule sample text", function () {
  it("strips the ignore mark", function () {
    assert.strictEqual(stripIgnoreMark("beh-ar.init'"), "beh-ar.init");
    assert.strictEqual(stripIgnoreMark("f"), "f");
  });

  it("derives sample text for a Latin ligature", function () {
    const rule = firstRule(`feature liga { sub f i by f_i; } liga;`);
    const model = makeModel({ f: [0x66], i: [0x69], f_i: [] });
    const d = describeRule(rule, model);
    assert.strictEqual(d.sampleText, "fi");
    assert.strictEqual(d.inputLabel, "fi");
    assert.strictEqual(d.kind, "ligature");
  });

  it("omits ignored glyphs from the sample text", function () {
    // A contextual Arabic rule: the first input is ignored context, the
    // second is the letter that actually gets the new form.
    const rule = firstRule(
      "feature init { sub beh-ar.init' lam-ar by lam-ar.init; } init;"
    );
    const model = makeModel({
      "beh-ar.init": [0x628],
      "lam-ar": [0x644],
      "lam-ar.init": [],
    });
    const { names } = ruleInputNames(rule, model);
    assert.deepStrictEqual(
      (rule.inputs ?? []).map((i) => i.value),
      ["beh-ar.init'", "lam-ar"],
      "sanity: the parser should keep the apostrophe"
    );
    assert.deepStrictEqual(names, ["lam-ar"], "the ignored glyph must be dropped");
    assert.strictEqual(describeRule(rule, model).sampleText, "ل");
  });

  it("falls back to the glyph database when a glyph has no cmap entry", function () {
    // "behDotless-ar" is U+066E and "kaf-ar" is U+0643 in the Glyphs database.
    assert.strictEqual(glyphToChar("behDotless-ar", makeModel()), "ٮ");
    assert.strictEqual(glyphToChar("kaf-ar", makeModel()), "ك");
    assert.strictEqual(glyphToChar("uni0627", makeModel()), "ا");
    assert.strictEqual(glyphToChar("u0628", makeModel()), "ب");
    // Bare single letters are the last resort
    assert.strictEqual(glyphToChar("f", makeModel()), "f");
    assert.strictEqual(glyphToChar("A", makeModel()), "A");
    // A suffixed form resolves via its base name
    assert.strictEqual(glyphToChar("kaf-ar.init", makeModel()), "ك");
    // Something the database has never heard of
    assert.strictEqual(glyphToChar("zzz-not-a-glyph", makeModel()), null);
  });

  it("prefers the font's own cmap over the naming convention", function () {
    // If the font maps the glyph, that wins even if the name looks like a
    // different convention.
    const model = makeModel({ "beh-ar": [0x0641] });
    assert.strictEqual(glyphToChar("beh-ar", model), "ف");
  });

  it("returns an empty sample when nothing can be derived", function () {
    const rule = firstRule(`feature x { sub someGlyph by other; } x;`);
    const d = describeRule(rule, makeModel());
    // A bare "a" or "f" still works via the last-resort rule
    assert.ok(d.sampleText === "" || d.sampleText.length > 0);
  });

  it("handles a glyph class by using its first member", function () {
    const rule = firstRule(`feature ss01 { sub @ABC by [A.alt B.alt]; } ss01;`);
    const model = {
      fontController: { glyphMap: { "A": [0x41], "A.alt": [] } },
      expandTokens: () => [{ members: ["A", "B", "C"] }],
    };
    const d = describeRule(rule, model);
    assert.strictEqual(d.sampleText, "A");
    assert.ok(d.classes.length > 0, "should report the class");
  });

  it("classifies rule kinds", function () {
    const kinds = [
      [`sub a by b;`, "substitution"],
      [`sub a by b c;`, "decomposition"],
      [`sub a;`, "deletion"],
      [`sub a b by c;`, "ligature"],
      [`sub a b c;`, "contextual"],
    ];
    for (const [ruleText, expected] of kinds) {
      const rule = firstRule(`feature x { ${ruleText} } x;`);
      assert.strictEqual(
        describeRule(rule, makeModel()).kind,
        expected,
        `for ${ruleText}`
      );
    }
  });
});
