import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseFeatureCode,
  serializeFeatureCode,
  collectFeatures,
  collectLookups,
  collectSubRules,
  resolveFeatureLookups,
} from "../src/feature-code-parser.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const SIMPLE = `languagesystem DFLT dflt;
languagesystem latn dflt;

@ABC = [A B C];

feature ss01 {
  sub @ABC by [A.alt B.alt C.alt];
} ss01;

feature liga {
  lookupflag IgnoreMarks;
  sub H H by H_H;
} liga;
`;

describe("feature code parser", function () {
  it("parses languagesystems", function () {
    const parsed = parseFeatureCode(SIMPLE);
    assert.deepStrictEqual(parsed.languageSystems, [
      { script: "DFLT", language: "dflt" },
      { script: "latn", language: "dflt" },
    ]);
  });

  it("parses glyph class definitions", function () {
    const parsed = parseFeatureCode(SIMPLE);
    const def = parsed.root.items.find((i) => i.kind === "glyphclassdef");
    assert.ok(def, "expected a glyphclassdef");
    assert.strictEqual(def.name, "@ABC");
    assert.deepStrictEqual(def.members, ["A", "B", "C"]);
  });

  it("parses feature blocks with their sub rules", function () {
    const parsed = parseFeatureCode(SIMPLE);
    const features = collectFeatures(parsed.root);
    assert.strictEqual(features.length, 2);

    const ss01 = features[0];
    assert.strictEqual(ss01.tag, "ss01");
    const rules = collectSubRules(ss01.body);
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].inputs.length, 1);
    assert.strictEqual(rules[0].inputs[0].value, "@ABC");
    assert.strictEqual(rules[0].output[0].value, "[A.alt B.alt C.alt]");
    assert.deepStrictEqual(rules[0].output[0].members, ["A.alt", "B.alt", "C.alt"]);
  });

  it("handles multi-glyph ligature rules and lookupflag", function () {
    const parsed = parseFeatureCode(SIMPLE);
    const liga = collectFeatures(parsed.root).find((f) => f.tag === "liga");
    const rules = collectSubRules(liga.body);
    assert.strictEqual(rules[0].inputs.length, 2);
    assert.deepStrictEqual(
      rules[0].inputs.map((i) => i.value),
      ["H", "H"]
    );
    assert.strictEqual(rules[0].output[0].value, "H_H");
  });

  it("round-trips exactly", function () {
    const parsed = parseFeatureCode(SIMPLE);
    assert.strictEqual(serializeFeatureCode(parsed), SIMPLE);
  });

  it("parses a real-world Arabic font (Raqq) and round-trips", function () {
    const raqqPath = path.join(here, "data", "raqq", "Raqq.fontra", "features.txt");
    const text = fs.readFileSync(raqqPath, "utf8").replaceAll("\r\n", "\n");
    const parsed = parseFeatureCode(text);
    const out = serializeFeatureCode(parsed);
    assert.strictEqual(
      out,
      text,
      "Raqq feature code did not survive a parse/serialize round-trip"
    );

    const features = collectFeatures(parsed.root);
    const tags = new Set(features.map((f) => f.tag));
    // Raqq is a real-world Arabic font; verify the joining features are there.
    // (Note: Raqq uses rclt rather than calt.)
    for (const tag of ["isol", "init", "medi", "fina", "ccmp", "rlig", "rclt"]) {
      assert.ok(tags.has(tag), `expected an Arabic feature block for ${tag}`);
    }

    // Arabic join features delegate to named lookups; follow those references
    // so we validate the rules the shaper actually runs.
    //
    // Note: Raqq's `init` lookup maps the *nominal* glyph to its initial form
    // (e.g. "sub beh-ar by beh-ar.init"), while the joining context rules live
    // in the `init_*` lookups called from `rclt`. So the contextual assertions
    // belong to rclt, not init.
    const allLookups = collectLookups(parsed.root);

    const init = features.find((f) => f.tag === "init");
    const initLookups = resolveFeatureLookups(init, allLookups);
    const initRules = initLookups.flatMap((lookup) => collectSubRules(lookup.body));
    assert.ok(initLookups.length > 0, "expected init to reference a lookup");
    assert.ok(initRules.length > 0, "expected init sub rules");
    assert.ok(
      initRules.some((r) => r.inputs.length == 1 && r.output.length >= 1),
      "expected init rules mapping a nominal glyph to its initial form"
    );

    const rclt = features.find((f) => f.tag === "rclt");
    const rcltRules = resolveFeatureLookups(rclt, allLookups).flatMap((lookup) =>
      collectSubRules(lookup.body)
    );
    assert.ok(rcltRules.length > 0, "expected rclt sub rules");
    assert.ok(
      rcltRules.some((r) => r.inputs.length >= 2),
      "expected at least one contextual rule with a joining context"
    );
  });

  it("parses the positioning-emulation test font and round-trips", function () {
    const p = path.join(
      here,
      "data",
      "positioning-emulation",
      "positioning-emulation.fontra",
      "features.txt"
    );
    const text = fs.readFileSync(p, "utf8").replaceAll("\r\n", "\n");
    const parsed = parseFeatureCode(text);
    assert.strictEqual(serializeFeatureCode(parsed), text);
  });

  it("does not treat positioning keywords as substitutions", function () {
    const text = `feature kern {
  pos H V -40;
} kern;
`;
    const parsed = parseFeatureCode(text);
    const kern = collectFeatures(parsed.root)[0];
    assert.strictEqual(kern.tag, "kern");
    const rules = collectSubRules(kern.body);
    assert.strictEqual(rules.length, 0, "pos rules must not be parsed as sub rules");
  });

  it("handles ignored glyphs (backticks)", function () {
    const text = `feature rclt {
  sub f i' by f_i;
} rclt;
`;
    const parsed = parseFeatureCode(text);
    const rule = collectSubRules(collectFeatures(parsed.root)[0].body)[0];
    assert.strictEqual(rule.inputs.length, 2);
    assert.strictEqual(serializeFeatureCode(parsed), text);
  });

  it("parses nested lookups", function () {
    const text = `feature ccmp {
  lookup inner {
    sub a by b;
  } inner;
} ccmp;
`;
    const parsed = parseFeatureCode(text);
    const lookups = collectLookups(parsed.root);
    assert.strictEqual(lookups.length, 1);
    assert.strictEqual(lookups[0].name, "inner");
    assert.strictEqual(serializeFeatureCode(parsed), text);
  });
});
