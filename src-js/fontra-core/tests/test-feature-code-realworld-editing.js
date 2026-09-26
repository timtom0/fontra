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
const RAQQ = fs
  .readFileSync(path.join(here, "data", "raqq", "Raqq.fontra", "features.txt"), "utf8")
  .replaceAll("\r\n", "\n");

// Mirrors what the GUI does when a user deletes a rule from a feature that
// delegates to a named lookup.
describe("editing a real-world font", function () {
  it("deletes a rule from Raqq's isol feature and keeps the rest intact", function () {
    const parsed = parseFeatureCode(RAQQ);
    const allLookups = collectLookups(parsed.root);
    const isol = collectFeatures(parsed.root).find((f) => f.tag === "isol");
    const lookups = resolveFeatureLookups(isol, allLookups);
    const isolLookup = lookups.find((l) => l.name === "isol");
    assert.ok(isolLookup, "expected the isol lookup");

    const rules = collectSubRules(isolLookup.body);
    assert.ok(rules.length > 1, "expected several isol rules");
    const victim = rules[0];
    const victimText = victim.raw.trim();

    isolLookup.body.items.splice(isolLookup.body.items.indexOf(victim), 1);

    const out = serializeFeatureCode(parsed);
    assert.ok(!out.includes(victimText), "the deleted rule is still present");

    // Everything else in the file must be untouched, and the edited file must
    // still round-trip stably.
    const reparsed = parseFeatureCode(out);
    const isol2 = collectFeatures(reparsed.root).find((f) => f.tag === "isol");
    const isolLookup2 = resolveFeatureLookups(
      isol2,
      collectLookups(reparsed.root)
    ).find((l) => l.name === "isol");
    assert.ok(isolLookup2, "expected the isol lookup after the edit");
    assert.strictEqual(
      collectSubRules(isolLookup2.body).length,
      rules.length - 1,
      "the wrong number of rules remain"
    );
    assert.strictEqual(
      serializeFeatureCode(reparsed),
      out,
      "re-parsing the edited Raqq is not stable"
    );
  });

  it("adds a rule to Raqq's rlig feature without breaking the file", function () {
    const parsed = parseFeatureCode(RAQQ);
    // NB: Raqq has no "liga"; the ligature features it does have are "rlig"
    // and "rclt".
    const rlig = collectFeatures(parsed.root).find((f) => f.tag === "rlig");
    assert.ok(rlig, "expected an rlig feature in Raqq");
    const lookups = resolveFeatureLookups(rlig, collectLookups(parsed.root));
    const target = lookups[0].body;

    const before = collectSubRules(target).length;
    target.items.push({
      kind: "raw",
      raw: "\n    sub lam-ar' alef-ar by lam_alef-ar.fina;\n",
      start: -1,
      end: -1,
    });

    const out = serializeFeatureCode(parsed);
    assert.ok(
      out.includes("sub lam-ar' alef-ar by lam_alef-ar.fina;"),
      "rule not added"
    );

    // The rest of the file must still parse, and round-trip stably
    const reparsed = parseFeatureCode(out);
    assert.strictEqual(
      collectFeatures(reparsed.root).length,
      collectFeatures(parsed.root).length
    );
    assert.strictEqual(
      serializeFeatureCode(reparsed),
      out,
      "edited Raqq does not round-trip"
    );

    const rlig2 = collectFeatures(reparsed.root).find((f) => f.tag === "rlig");
    const target2 = resolveFeatureLookups(rlig2, collectLookups(reparsed.root))[0].body;
    assert.strictEqual(collectSubRules(target2).length, before + 1);
  });
});
