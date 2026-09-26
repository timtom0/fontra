import assert from "assert";
import {
  getFeatureGroups,
  getAllFeatureTags,
  FEATURE_GROUPS,
} from "../src/feature-code-model.js";

describe("feature groups", function () {
  it("assigns every tag to exactly one group", function () {
    // The panel renders one section per (group, tag) pair. A tag in two groups
    // produced a duplicated section -- e.g. "calt" under both Ligatures and
    // Arabic.
    const seen = new Map();
    for (const group of getFeatureGroups()) {
      for (const tag of group.tags) {
        assert.ok(
          !seen.has(tag),
          `tag "${tag}" is in both "${seen.get(tag)}" and "${group.id}"`
        );
        seen.set(tag, group.id);
      }
    }
    assert.ok(seen.size > 50, `expected many tags, got ${seen.size}`);
  });

  it("has no duplicate tags in getAllFeatureTags()", function () {
    const tags = getAllFeatureTags();
    assert.strictEqual(tags.length, new Set(tags).size);
  });

  it("groups are non-empty and have unique ids", function () {
    const groups = getFeatureGroups();
    const ids = groups.map((g) => g.id);
    assert.strictEqual(ids.length, new Set(ids).size, "duplicate group id");
    for (const group of groups) {
      assert.ok(group.title, `group ${group.id} has no title`);
    }
  });

  it("keeps the ligature and Arabic groups separate", function () {
    const byId = Object.fromEntries(getFeatureGroups().map((g) => [g.id, g]));
    assert.ok(byId.ligatures, "expected a ligatures group");
    assert.ok(byId.arabic, "expected an arabic group");
    // liga belongs to ligatures, isol to arabic
    assert.ok(byId.ligatures.tags.includes("liga"));
    assert.ok(!byId.arabic.tags.includes("liga"));
    assert.ok(byId.arabic.tags.includes("isol"));
    // calt and rlig serve both worlds but may only be listed once
    assert.ok(byId.arabic.tags.includes("calt"));
    assert.ok(!byId.ligatures.tags.includes("calt"));
  });

  it("the raw FEATURE_GROUPS list itself has no duplicates", function () {
    const seen = new Set();
    for (const group of FEATURE_GROUPS) {
      for (const tag of group.tags) {
        assert.ok(!seen.has(tag), `duplicate tag "${tag}" in FEATURE_GROUPS`);
        seen.add(tag);
      }
    }
  });
});
