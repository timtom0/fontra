import assert from "assert";
import {
  parseFeatureCode,
  serializeFeatureCode,
  collectFeatures,
  collectLookups,
  collectSubRules,
  resolveFeatureLookups,
} from "../src/feature-code-parser.js";

const RAQQ = `languagesystem DFLT dflt;
languagesystem arab dflt;

@isol = [alef-ar beh-ar hah-ar];

feature isol {
    sub alef-ar by alef-ar.isol;
} isol;

feature liga {
    lookup flag_1 {
        sub f i by f_i;
    } flag_1;
} liga;
`;

describe("feature code editing", function () {
  // Mirrors detectIndent() in the panel: find the indentation of the first
  // line in a statement that has content after the whitespace.
  function detectIndentForTest(block, fallback = "  ") {
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

  it("adds a rule to an existing feature", function () {
    const parsed = parseFeatureCode(RAQQ);
    const feature = collectFeatures(parsed.root).find((f) => f.tag === "liga");
    // Append a rule to the *lookup* the feature calls, which is where a
    // type designer would actually add a ligature.
    const lookup = feature.body.items.find((i) => i.kind === "lookup");
    lookup.body.items.push({
      kind: "raw",
      raw: "        sub f l by fl;\n",
      start: -1,
      end: -1,
    });

    const out = serializeFeatureCode(parsed);
    assert.ok(out.includes("sub f l by fl;"), "new rule missing");

    const reparsed = parseFeatureCode(out);
    const liga2 = collectFeatures(reparsed.root).find((f) => f.tag === "liga");
    const rules = resolveFeatureLookups(liga2, collectLookups(reparsed.root)).flatMap(
      (l) => collectSubRules(l.body)
    );
    assert.strictEqual(rules.length, 2, "expected 2 rules in liga after the edit");
  });

  it("creates a new feature block", function () {
    const parsed = parseFeatureCode(RAQQ);
    parsed.root.items.push({
      kind: "raw",
      raw: "\nfeature ss01 {\n  sub a by a.alt;\n} ss01;\n",
      start: -1,
      end: -1,
    });
    const out = serializeFeatureCode(parsed);
    const reparsed = parseFeatureCode(out);
    const ss01 = collectFeatures(reparsed.root).find((f) => f.tag === "ss01");
    assert.ok(ss01, "ss01 feature was not created");
    const rules = collectSubRules(ss01.body);
    assert.strictEqual(rules.length, 1);
    assert.deepStrictEqual(
      rules[0].inputs.map((i) => i.value),
      ["a"]
    );
  });

  it("deletes a rule", function () {
    const parsed = parseFeatureCode(RAQQ);
    const feature = collectFeatures(parsed.root).find((f) => f.tag === "liga");
    const lookup = feature.body.items.find((i) => i.kind === "lookup");
    const rules = collectSubRules(lookup.body);
    assert.strictEqual(rules.length, 1);
    lookup.body.items.splice(lookup.body.items.indexOf(rules[0]), 1);

    const out = serializeFeatureCode(parsed);
    assert.ok(!out.includes("sub f i by f_i;"), "rule should be gone");
    const reparsed = parseFeatureCode(out);
    const feature2 = collectFeatures(reparsed.root).find((f) => f.tag === "liga");
    const lookup2 = resolveFeatureLookups(feature2, collectLookups(reparsed.root))[0];
    assert.strictEqual(collectSubRules(lookup2.body).length, 0);
  });

  it("keeps other rules intact when one is deleted", function () {
    const text = `feature test {
  sub a by a.alt;
  sub b by b.alt;
  sub c by c.alt;
} test;
`;
    const parsed = parseFeatureCode(text);
    const feature = collectFeatures(parsed.root)[0];
    const rules = collectSubRules(feature.body);
    feature.body.items.splice(feature.body.items.indexOf(rules[1]), 1);

    const out = serializeFeatureCode(parsed);
    assert.ok(out.includes("sub a by a.alt;"));
    assert.ok(!out.includes("sub b by b.alt;"));
    assert.ok(out.includes("sub c by c.alt;"));
  });

  it("appends a rule on its own line, matching the block's indentation", function () {
    // This is the exact shape the GUI produces when a user adds a rule: the
    // previous statement's raw text does NOT include the newline that precedes
    // "}" (that lives in trailingRaw), so a naive append runs onto one line.
    const text = `feature ss01 {
    sub a by a.smcp;
    sub z by z.smcp;
} ss01;
`;
    const parsed = parseFeatureCode(text);
    const feature = collectFeatures(parsed.root)[0];
    const lastItem = feature.body.items[feature.body.items.length - 1];
    const needsLeadingNewline = !lastItem || !lastItem.raw?.endsWith("\n");
    assert.ok(needsLeadingNewline, "expected the last item to lack a newline");

    const indent = detectIndentForTest(feature.body);
    feature.body.items.push({
      kind: "raw",
      raw: `${needsLeadingNewline ? "\n" : ""}${indent}sub A by A.alt;\n`,
      start: -1,
      end: -1,
    });

    const out = serializeFeatureCode(parsed);
    assert.ok(
      out.includes("    sub z by z.smcp;\n    sub A by A.alt;\n"),
      `rule was not appended on its own line:\n${out}`
    );

    // And the result must still parse back to three rules
    const reparsed = parseFeatureCode(out);
    const feature2 = collectFeatures(reparsed.root).find((f) => f.tag === "ss01");
    assert.strictEqual(collectSubRules(feature2.body).length, 3);
  });
});
