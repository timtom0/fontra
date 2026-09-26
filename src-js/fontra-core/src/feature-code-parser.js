// A lossless-enough parser for the subset of FEA source that the
// OpenType Feature Code GUI needs to read and rewrite.
//
// Design goals:
//   * Round-trip: anything the parser doesn't understand is preserved verbatim,
//     so a GUI edit never destroys hand-written feature code.
//   * Comment- and whitespace-preserving at the statement level.
//   * Good enough error reporting: unparseable regions are captured as raw
//     blocks rather than throwing.

export const FEA_KEYWORDS = new Set([
  "anchor",
  "anchorDef",
  "anon",
  "anonymous",
  "by",
  "contourpoint",
  "cursive",
  "device",
  "enum",
  "enumerate",
  "exclude_dflt",
  "feature",
  "from",
  "ignore",
  "IgnoreBaseGlyphs",
  "IgnoreLigatures",
  "IgnoreMarks",
  "include",
  "include_dflt",
  "language",
  "languagesystem",
  "lookup",
  "lookupflag",
  "mark",
  "MarkAttachmentType",
  "markClass",
  "nameid",
  "NULL",
  "parameters",
  "pos",
  "position",
  "required",
  "reversesub",
  "RightToLeft",
  "rsub",
  "script",
  "sub",
  "substitute",
  "subtable",
  "table",
  "useExtension",
  "useMarkFilteringSet",
  "valueRecordDef",
  "excludeDFLT",
  "includeDFLT",
]);

// Words that are *not* statement keywords but commonly appear in the same
// position; treating them as keywords would corrupt round-tripping.
const POSITIONING_KEYWORD_LOOKALIKE = new Set(["cursive", "position", "substitute"]);

const GLYPH_NAME_RE = /\\?[A-Za-z0-9_.][A-Za-z0-9_.\-+]*/y;

const TOKEN_RE = /(?<ws>\s+)|(?<comment>\#[^\n]*)|(?<punct>[\[\]@();={}])/y;

function isGlyphNameStart(ch) {
  return /[A-Za-z0-9_\\.]/.test(ch);
}

class TokenStream {
  constructor(text, pos = 0) {
    this.text = text;
    this.pos = pos;
  }

  get eof() {
    return this.pos >= this.text.length;
  }

  peekNonSpace() {
    const savedPos = this.pos;
    try {
      while (!this.eof) {
        this.readTrivia();
        if (this.eof) {
          return null;
        }
        return this.text[this.pos];
      }
      return null;
    } finally {
      this.pos = savedPos;
    }
  }

  // Consume whitespace and comments, returning the consumed text.
  readTrivia() {
    const start = this.pos;
    TOKEN_RE.lastIndex = this.pos;
    let match;
    while ((match = TOKEN_RE.exec(this.text)) !== null) {
      if (match.groups.ws !== undefined || match.groups.comment !== undefined) {
        this.pos = TOKEN_RE.lastIndex;
        continue;
      }
      break;
    }
    return this.text.slice(start, this.pos);
  }

  // Read the next "real" token: trivia first, then either a single punctuation
  // char or a run of glyph-name characters.
  readToken() {
    const trivia = this.readTrivia();
    if (this.eof) {
      return { type: "eof", value: "", raw: trivia, pos: this.pos };
    }
    const start = this.pos;
    const ch = this.text[this.pos];
    if ("[]@(){};=,".includes(ch)) {
      this.pos += 1;
      return { type: "punct", value: ch, raw: trivia + ch, pos: start };
    }
    // A trailing "'" marks a glyph as ignored in contextual rules. Fold it
    // into the glyph-name token so `i'` stays a single token.
    if (/[A-Za-z0-9_.\\]/.test(ch)) {
      GLYPH_NAME_RE.lastIndex = this.pos;
      const match = GLYPH_NAME_RE.exec(this.text);
      if (match) {
        this.pos = GLYPH_NAME_RE.lastIndex;
        if (this.text[this.pos] === "'") {
          this.pos += 1;
        }
        const value = this.text.slice(start, this.pos);
        return {
          type: "word",
          value,
          // A token that ends in "'" is a glyph name, not a keyword like
          // "by"; the apostrophe terminator keeps the two from merging.
          isGlyphName: /'$/.test(value),
          raw: trivia + value,
          pos: start,
        };
      }
    }
    // Unknown character: consume it as a single-char token so we never spin.
    this.pos += 1;
    return { type: "unknown", value: ch, raw: trivia + ch, pos: start };
  }

  readGlyphClassLike() {
    // Reads a glyph name, or a bracketed glyph class / range, or a @name
    // reference. Returns a token describing it, with raw text preserved.
    const token = this.readToken();
    if (token.type === "punct" && token.value === "[") {
      const start = this.pos - 1;
      let depth = 1;
      let sawToken = false;
      while (!this.eof) {
        const t = this.readToken();
        if (t.type === "eof") {
          break;
        }
        if (t.type === "punct" && t.value === "[") {
          depth += 1;
        } else if (t.type === "punct" && t.value === "]") {
          depth -= 1;
          if (depth == 0) {
            break;
          }
        } else {
          sawToken = true;
        }
      }
      const end = this.pos;
      const raw = this.text.slice(start, end);
      const isRange = /^\s*\\?[A-Za-z0-9_.]+\s*-\s*\\?[A-Za-z0-9_.]+\s*$/.test(
        raw.slice(1, -1)
      );
      return {
        type: "glyphclass",
        value: raw,
        members: isRange ? null : parseGlyphClassMembers(raw.slice(1, -1)),
        isRange,
        raw: token.raw + raw,
        pos: token.pos,
        end,
      };
    }
    if (token.type === "punct" && token.value === "@") {
      const start = this.pos - 1;
      const t = this.readToken();
      const raw = this.text.slice(start, this.pos);
      return {
        type: "glyphclassref",
        value: raw,
        name: t.value,
        raw: token.raw + raw,
        pos: token.pos,
        end: this.pos,
      };
    }
    if (token.type === "word") {
      return {
        type: "glyphname",
        value: token.value,
        // Carry the ignored-glyph marker through, so `i'` is never mistaken
        // for a bare keyword such as "by".
        isGlyphName: token.isGlyphName,
        raw: token.raw,
        pos: token.pos,
        end: this.pos,
      };
    }
    return token;
  }
}

export function parseGlyphClassMembers(inner) {
  // inner is the text between [ and ]
  return inner
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length);
}

function glyphClassToString(parts, leadingTrailingSpace) {
  return `[${leadingTrailingSpace}${parts.join(" ")}${leadingTrailingSpace}]`;
}

// Parse a substitution rule: a sequence of input glyphs, optional ignored
// (backtick-prefixed) glyphs, then "by" and output glyphs.
function parseSubRuleBody(stream) {
  const inputs = [];
  const output = [];
  let sawBy = false;
  let reverse = false;
  const rangeStart = stream.pos;

  while (!stream.eof) {
    const next = stream.peekNonSpace();
    if (next == null) {
      break;
    }
    if (next == ";" || next == "}") {
      break;
    }
    const token = stream.readGlyphClassLike();
    if (token.type === "eof") {
      break;
    }
    if (token.type === "punct") {
      // A stray bracket that readGlyphClassLike didn't consume: stop rather
      // than spin.
      break;
    }
    if (
      token.type === "glyphname" &&
      !sawBy &&
      !token.isGlyphName &&
      (token.value === "by" || token.value === "from")
    ) {
      // "by" separates inputs from outputs. "from" marks a reverse-chaining
      // rule: we don't surface it in the GUI, but we still consume the rest
      // of the rule so the statement round-trips intact.
      sawBy = token.value === "by";
      reverse = !sawBy;
      continue;
    }
    (sawBy || reverse ? output : inputs).push(token);
  }

  const end = stream.pos;
  return {
    kind: "sub",
    inputs,
    output,
    editable: sawBy,
    raw: stream.text.slice(rangeStart, end),
    start: rangeStart,
    end,
  };
}

// A glyph class definition: "@NAME = [ ... ];" or "@NAME = @OTHER;".
// `start` is the statement start, and the leading "@" has already been read.
function parseGlyphClassDef(stream, start) {
  const nameTok = stream.readToken();
  const members = [];
  const save = stream.pos;
  const t = stream.readToken();

  if (t.type === "punct" && t.value === "=") {
    const next = stream.peekNonSpace();
    if (next === "[") {
      const cls = stream.readGlyphClassLike();
      members.push(...(cls.members || []));
    } else {
      // "@A = @B;" — an alias
      const ref = stream.readGlyphClassLike();
      members.push(ref.value);
    }
    stream.readToken(); // ;
  } else {
    // Not a definition we recognize: consume to the ";" verbatim.
    stream.pos = save;
    while (stream.pos < stream.text.length && stream.text[stream.pos] !== ";") {
      if (stream.text[stream.pos] === "}") {
        break;
      }
      if (stream.readToken().type === "eof") {
        break;
      }
    }
    stream.readToken(); // ;
  }

  return {
    kind: "glyphclassdef",
    name: "@" + nameTok.value.replace(/^@/, ""),
    members,
    raw: stream.text.slice(start, stream.pos),
    start,
    end: stream.pos,
  };
}

function parseStatement(stream) {
  // The trivia preceding this statement (indentation, comments) is consumed by
  // the caller, which prepends it to `item.raw`. We only need the token
  // position here.
  const start = stream.pos;
  const first = stream.readToken();
  if (first.type === "eof") {
    return null;
  }

  // A top-level glyph class definition starts with "@", e.g.
  // "@ABC = [A B C];". It is not a keyword, so dispatch on the first char
  // *before* the "not a word" early return below.
  if (first.type === "punct" && first.value === "@") {
    return parseGlyphClassDef(stream, start);
  }

  if (first.type !== "word") {
    // Not a statement start; treat what we consumed as raw.
    return {
      kind: "raw",
      raw: stream.text.slice(start, stream.pos),
      start,
      end: stream.pos,
    };
  }

  const keyword = first.value;

  switch (keyword) {
    case "languagesystem": {
      const scriptTok = stream.readToken();
      const langTok = stream.readToken();
      stream.readToken(); // ;
      return {
        kind: "languagesystem",
        script: scriptTok.value,
        language: langTok.value,
        raw: stream.text.slice(start, stream.pos),
        start,
        end: stream.pos,
      };
    }

    case "glyphclassdef":
    case "GlyphClassDef":
    case "GC": {
      const nameTok = stream.readToken();
      const members = [];
      const next = stream.peekNonSpace();
      if (next === "[") {
        const cls = stream.readGlyphClassLike();
        members.push(...(cls.members || []));
      } else {
        // Consume up to and including the ";"
        while (!stream.eof) {
          const ch = stream.peekNonSpace();
          if (ch == null || ch == ";") {
            break;
          }
          const t = stream.readGlyphClassLike();
          if (t.type === "eof") {
            break;
          }
        }
        stream.readToken(); // ;
      }
      return {
        kind: "glyphclassdef",
        name: "@" + nameTok.value.replace(/^@/, ""),
        members,
        raw: stream.text.slice(start, stream.pos),
        start,
        end: stream.pos,
      };
    }

    case "markClass": {
      stream.readToken(); // name
      const base = stream.readGlyphClassLike();
      stream.readToken(); // ; or anchor
      return {
        kind: "markclass",
        base,
        raw: stream.text.slice(start, stream.pos),
        start,
        end: stream.pos,
      };
    }

    case "feature": {
      const tagTok = stream.readToken();
      const scriptList = [];
      const languageList = [];
      // Optional "script X language Y" prefix inside the braces
      let openBracePos = -1;
      for (;;) {
        const save = stream.pos;
        const t = stream.readToken();
        if (t.type === "punct" && t.value === "{") {
          // t.pos is the index of "{" itself (leading trivia is excluded),
          // so slicing up to t.pos + 1 yields the exact head text.
          openBracePos = t.pos;
          break;
        }
        if (t.type !== "word") {
          stream.pos = save;
          break;
        }
        if (t.value === "script" || t.value === "language") {
          const arg = stream.readToken();
          if (t.value === "script") {
            scriptList.push(arg.value);
          } else {
            languageList.push(arg.value);
          }
          continue;
        }
        stream.pos = save;
        break;
      }

      if (openBracePos < 0) {
        // "feature tag;" — an empty feature declaration
        return {
          kind: "feature-empty",
          tag: tagTok.value,
          raw: stream.text.slice(start, stream.pos),
          start,
          end: stream.pos,
        };
      }

      // Now parse the block up to the matching "} tag;"
      const headRaw = stream.text.slice(start, openBracePos + 1);
      const body = parseFeatureBlock(stream);
      const closeTok = stream.readToken(); // }
      // "} tag;" — the end tag is optional; the ";" always closes the
      // statement.
      let endTagTok = null;
      for (;;) {
        const t = stream.readToken();
        if (t.type === "eof") {
          break;
        }
        if (t.type === "punct" && t.value === ";") {
          break;
        }
        if (t.type === "word" && !endTagTok) {
          endTagTok = t;
        }
      }

      const tailRaw = stream.text.slice(closeTok.pos, stream.pos);

      return {
        kind: "feature",
        tag: tagTok.value,
        scripts: scriptList,
        languages: languageList,
        body,
        headRaw,
        tailRaw,
        endTag: endTagTok?.value ?? null,
        raw: stream.text.slice(start, stream.pos),
        start,
        end: stream.pos,
        closeBracePos: closeTok.pos,
      };
    }

    case "lookup": {
      const nameTok = stream.readToken();
      const openTok = stream.readToken();
      if (!(openTok.type === "punct" && openTok.value === "{")) {
        // "lookup foo;" — a reference to a lookup defined elsewhere. The
        // terminating ";" has already been consumed as openTok, but don't
        // consume anything more: the next "}" may close the enclosing block.
        return {
          kind: "lookup-empty",
          name: nameTok.value,
          raw: stream.text.slice(start, stream.pos),
          start,
          end: stream.pos,
        };
      }
      const body = parseFeatureBlock(stream);
      const closeTok = stream.readToken(); // }
      // "} name;" — the end tag is optional, and the semicolon always closes
      // the statement. Read tokens until we consume the ";".
      let endTagTok = null;
      for (;;) {
        const t = stream.readToken();
        if (t.type === "eof") {
          break;
        }
        if (t.type === "punct" && t.value === ";") {
          break;
        }
        if (t.type === "word" && !endTagTok) {
          endTagTok = t;
        }
      }
      const headRaw = stream.text.slice(start, openTok.pos + 1);
      const tailRaw = stream.text.slice(closeTok.pos, stream.pos);
      return {
        kind: "lookup",
        name: nameTok.value,
        body,
        headRaw,
        tailRaw,
        raw: stream.text.slice(start, stream.pos),
        start,
        end: stream.pos,
        closeBracePos: closeTok.pos,
      };
    }

    case "sub":
    case "rsub": {
      const body = parseSubRuleBody(stream);
      stream.readToken(); // ;
      return {
        kind: "substitution-rule",
        atTopLevel: true,
        ...body,
        raw: stream.text.slice(start, stream.pos),
        start,
        end: stream.pos,
      };
    }

    case "pos": {
      const bodyStart = stream.pos;
      while (!stream.eof) {
        const next = stream.peekNonSpace();
        if (next == null || next == ";") {
          break;
        }
        stream.readGlyphClassLike();
      }
      stream.readToken(); // ;
      return {
        kind: "positioning-rule",
        atTopLevel: true,
        raw: stream.text.slice(start, stream.pos),
        start,
        end: stream.pos,
        bodyStart,
      };
    }

    case "script":
    case "language": {
      while (!stream.eof) {
        const next = stream.peekNonSpace();
        if (next == null || next == ";") {
          break;
        }
        stream.readToken();
      }
      stream.readToken(); // ;
      return {
        kind: "script-language",
        raw: stream.text.slice(start, stream.pos),
        start,
        end: stream.pos,
      };
    }

    case "ignore": {
      const body = parseSubRuleBody(stream);
      stream.readToken(); // ;
      return {
        kind: "ignore",
        inputs: body.inputs,
        raw: stream.text.slice(start, stream.pos),
        start,
        end: stream.pos,
      };
    }

    case "conditionset":
    case "variation":
    case "table":
    case "anchorDef":
    case "valueRecordDef": {
      // Block-structured statements (mainly variable-font features). We don't
      // edit these in the GUI, but parsing them structurally keeps the
      // statements that *follow* from being swallowed into one big raw blob.
      const nameTok = stream.readToken();
      let openBracePos = -1;
      // The header is a run of plain words ("ccmp compact") up to the "{".
      // Anything else means this statement isn't block-structured.
      for (;;) {
        const save = stream.pos;
        if (stream.pos >= stream.text.length) {
          break;
        }
        const ch = stream.text[stream.pos];
        if (ch === "{") {
          // Read the token to get its exact position.
          const t = stream.readToken();
          openBracePos = t.pos;
          break;
        }
        if (ch === ";" || ch === "}" || /\s/.test(ch)) {
          // ";" or "}" ends the header without a block; whitespace is skipped
          // by readToken below, so rewind only for the terminators.
          if (ch === ";" || ch === "}") {
            break;
          }
          stream.readToken();
          continue;
        }
        const t = stream.readToken();
        if (t.type !== "word") {
          stream.pos = save;
          break;
        }
      }
      if (openBracePos < 0) {
        // No block: treat as a simple statement ending in ";".
        while (stream.pos < stream.text.length && stream.text[stream.pos] !== ";") {
          if (stream.text[stream.pos] === "}") {
            break;
          }
          if (stream.readToken().type === "eof") {
            break;
          }
        }
        if (stream.text[stream.pos] === ";") {
          stream.readToken();
        }
        return {
          kind: "raw",
          raw: stream.text.slice(start, stream.pos),
          start,
          end: stream.pos,
        };
      }
      const headRaw = stream.text.slice(start, openBracePos + 1);
      const body = parseFeatureBlock(stream);
      const closeTok = stream.readToken(); // }
      for (;;) {
        const t = stream.readToken();
        if (t.type === "eof") {
          break;
        }
        if (t.type === "punct" && t.value === ";") {
          break;
        }
      }
      const tailRaw = stream.text.slice(closeTok.pos, stream.pos);
      return {
        kind: "block-statement",
        name: nameTok.value,
        body,
        headRaw,
        tailRaw,
        raw: stream.text.slice(start, stream.pos),
        start,
        end: stream.pos,
      };
    }

    case "@": {
      return parseGlyphClassDef(stream, start);
    }

    default: {
      // Unknown statement. Consume tokens up to and including the ";" that
      // terminates it. If we run into a "}" first, leave it for the caller:
      // that "}" closes the enclosing feature/lookup block.
      //
      // NB: we must not use peekNonSpace() here — it rewinds pos, so the "}"
      // test would fire on every iteration without consuming anything.
      for (;;) {
        if (stream.pos >= stream.text.length) {
          break;
        }
        const ch = stream.text[stream.pos];
        if (ch === ";") {
          stream.readToken();
          break;
        }
        if (ch === "}") {
          break;
        }
        const t = stream.readToken();
        if (t.type === "eof") {
          break;
        }
        if (t.type === "punct" && (t.value === "{" || t.value === "}")) {
          // A brace inside an unknown statement: consume a balanced block so
          // we don't stop at its closing brace.
          let depth = t.value === "{" ? 1 : 0;
          while (depth > 0 && !stream.eof) {
            if (stream.text[stream.pos] === "}") {
              depth -= 1;
            } else if (stream.text[stream.pos] === "{") {
              depth += 1;
            }
            const inner = stream.readToken();
            if (inner.type === "eof") {
              break;
            }
          }
        }
      }
      return {
        kind: "raw",
        raw: stream.text.slice(start, stream.pos),
        start,
        end: stream.pos,
      };
    }
  }
}

function parseFeatureBlock(stream) {
  // stream.pos is just after "{"
  const items = [];
  const blockStart = stream.pos;
  let trailingRaw = "";

  while (true) {
    // Consume trivia up front, and remember where this statement's full span
    // begins. We must not use peekNonSpace() here, because it rewinds pos,
    // which would make the trailing slice below always empty.
    const itemStart = stream.pos;
    const trivia = stream.readTrivia();
    const peeked = stream.pos < stream.text.length ? stream.text[stream.pos] : null;

    if (peeked === null || peeked === "}") {
      // Keep the trivia between the last statement and "}" verbatim.
      trailingRaw = trivia;
      stream.pos = itemStart + trivia.length;
      break;
    }
    if (peeked === "{" || peeked === "[") {
      // These can't start a statement; consume to avoid an infinite loop.
      stream.readToken();
      continue;
    }

    const item = parseStatement(stream);
    if (!item) {
      break;
    }
    if (item.end === itemStart) {
      // No progress: bail out to avoid an infinite loop.
      break;
    }
    // parseStatement builds `raw` starting at the token, so the trivia we
    // consumed above is not part of it. Prepend it here so indentation and
    // comments survive the round-trip. (parseStatement itself does NOT get
    // the trivia, to avoid double-counting in nested blocks.)
    item.leadingRaw = trivia;
    item.raw = trivia + item.raw;
    item.start = itemStart;
    items.push(item);
  }

  const blockEnd = stream.pos;
  return { items, start: blockStart, end: blockEnd, trailingRaw };
}

function parseLookupBlock(stream) {
  return parseFeatureBlock(stream);
}

/**
 * Parse a FEA source string into a structured tree.
 *
 * @param {string} text
 * @returns {{text: string, root: {items: Array}, languageSystems: Array}}
 */
export function parseFeatureCode(text) {
  const stream = new TokenStream(text);
  const items = [];

  while (true) {
    const itemStart = stream.pos;
    const trivia = stream.readTrivia();
    if (stream.pos >= text.length) {
      // Trailing trivia at the end of the file: keep it as a raw item.
      if (trivia) {
        items.push({ kind: "raw", raw: trivia, start: itemStart, end: stream.pos });
      }
      break;
    }
    stream.lastTrivia = trivia;
    const item = parseStatement(stream);
    if (!item) {
      break;
    }
    if (stream.pos === itemStart) {
      break;
    }
    item.leadingRaw = trivia;
    item.raw = trivia + item.raw;
    item.start = itemStart;
    items.push(item);
  }

  return { text, root: { items }, languageSystems: collectLanguageSystems(items) };
}

function collectLanguageSystems(items) {
  const result = [];
  for (const item of items) {
    if (item.kind === "languagesystem") {
      result.push({ script: item.script, language: item.language });
    }
  }
  return result;
}

/**
 * Serialize a parsed feature block back to FEA text, substituting replacement
 * text for statements that have been marked with `replaceRaw`.
 */
export function serializeFeatureCode(parsed) {
  const parts = [];
  for (const item of parsed.root.items) {
    parts.push(serializeItem(item));
  }
  return parts.join("");
}

function serializeItem(item) {
  if (item.replaceRaw !== undefined) {
    // An explicit replacement replaces the whole statement, including the
    // trivia that preceded it.
    return item.replaceRaw;
  }
  if (
    item.kind === "feature" ||
    item.kind === "lookup" ||
    item.kind === "block-statement"
  ) {
    // Rebuild from parts so nested edits are picked up. Keep the original
    // head/tail text verbatim so whitespace and naming style are preserved.
    // `headRaw` starts at the keyword, so the leading trivia (indentation,
    // comments) has to be prepended explicitly.
    const head = (item.leadingRaw || "") + (item.headRaw ?? "");
    const bodyText = item.body ? serializeBlock(item.body) : "";
    const tail = item.tailRaw ?? (item.endTag ? `} ${item.endTag};\n` : "};\n");
    return `${head}${bodyText}${tail}`;
  }
  return item.raw;
}

function serializeBlock(body) {
  return (
    (body.items.map((item) => serializeItem(item)).join("") || "") +
    (body.trailingRaw || "")
  );
}

// ---------------------------------------------------------------------------
// Replacement helpers used by the GUI
// ---------------------------------------------------------------------------

/**
 * Replace a single `sub` rule statement with new text, keeping the statement's
 * original indentation and trailing newline.
 */
export function replaceSubRuleText(item, newRuleText) {
  const raw = item.raw;
  const indentMatch = /^[ \t]*/.exec(raw);
  const indent = indentMatch ? indentMatch[0] : "";
  const trailingNewline = /\n$/.test(raw) ? "\n" : "";
  return `${indent}${newRuleText}${trailingNewline}`;
}

/**
 * Build a FEA `sub` rule string from glyph names.
 */
export function buildSubRule(inputNames, outputNames, options = {}) {
  const format = (name) => (name.startsWith("@") ? name : name);
  const left = inputNames.map(format).join(" ");
  const right = outputNames.length ? outputNames.map(format).join(" ") : "";
  const ignorePrefix = options.ignorePrefix || "";
  return right
    ? `sub ${ignorePrefix}${left} by ${right};`
    : `sub ${ignorePrefix}${left};`;
}

/**
 * Build a FEA `feature` block string.
 */
export function buildFeatureBlock(tag, bodyLines, options = {}) {
  const { scripts = [], languages = [], name = null } = options;
  let header = `feature ${tag} `;
  if (scripts.length) {
    header += `script ${scripts.join(" ")} `;
  }
  if (languages.length) {
    header += `language ${languages.join(" ")} `;
  }
  const suffix = name ? ` ${name}` : tag;
  const body = bodyLines.length ? `\n${bodyLines.join("\n")}\n` : "\n";
  return `${header}{${body}}${suffix};`;
}

/**
 * Build a FEA `lookup` block string.
 */
export function buildLookupBlock(name, bodyLines) {
  const body = bodyLines.length ? `\n${bodyLines.join("\n")}\n` : "\n";
  return `lookup ${name} {${body}} ${name};`;
}

/**
 * Find all feature blocks in a parsed tree, including nested ones.
 *
 * Accepts either a container (with `.items`) or a single feature/lookup node.
 */
export function collectFeatures(node, out = []) {
  if (!node) {
    return out;
  }
  if (!Array.isArray(node.items)) {
    // A single feature/lookup node was passed in: collect it, then whatever
    // features are nested inside it.
    if (node.kind === "feature" || node.kind === "lookup") {
      out.push(node);
    }
    if (node.body) {
      collectFeatures(node.body, out);
    }
    return out;
  }
  for (const item of node.items) {
    if (item.kind === "feature") {
      out.push(item);
    }
    if (item.body) {
      collectFeatures(item.body, out);
    }
  }
  return out;
}

/**
 * Find all lookup blocks in a parsed tree, including nested ones.
 *
 * Accepts either a container (with `.items`) or a single feature/lookup node.
 */
export function collectLookups(node, out = []) {
  if (!node) {
    return out;
  }
  if (!Array.isArray(node.items)) {
    // A single feature/lookup node was passed in.
    if (node.kind === "lookup") {
      out.push(node);
    }
    if (node.body) {
      collectLookups(node.body, out);
    }
    return out;
  }
  for (const item of node.items) {
    if (item.kind === "lookup") {
      out.push(item);
    }
    if (item.body) {
      collectLookups(item.body, out);
    }
  }
  return out;
}

/**
 * Resolve a feature's `lookup NAME;` references to the actual lookup blocks.
 *
 * Feature code commonly factors rules into top-level lookups and then calls
 * them, e.g.
 *
 *     lookup init { sub behDotless-ar.init beh-ar by behDotless-ar.init.beh; } init;
 *     feature init { lookup init; } init;
 *
 * To edit a feature's rules, we have to follow those references. Lookups
 * defined *inside* the feature body are returned as-is.
 */
export function resolveFeatureLookups(featureNode, allLookups) {
  const byName = new Map();
  for (const lookup of allLookups) {
    if (!byName.has(lookup.name)) {
      byName.set(lookup.name, lookup);
    }
  }

  const resolved = [];
  const seen = new Set();

  const addLookup = (lookup) => {
    if (!lookup || seen.has(lookup)) {
      return;
    }
    seen.add(lookup);
    resolved.push(lookup);
  };

  for (const item of featureNode.body?.items ?? []) {
    if (item.kind === "lookup") {
      // A lookup defined inline in the feature body.
      addLookup(item);
    } else if (item.kind === "lookup-empty") {
      // A reference to a lookup defined elsewhere.
      addLookup(byName.get(item.name));
    }
  }

  return resolved;
}

/**
 * Collect sub rules from a block.
 *
 * Accepts a block ({ items }), or a parsed tree / feature / lookup node, so
 * callers do not have to know which level they are holding.
 */
export function collectSubRules(node) {
  const out = [];
  for (const item of iterateItems(node)) {
    if (item.kind === "sub" || item.kind === "substitution-rule") {
      out.push(item);
    } else if (item.kind === "ignore") {
      out.push(item);
    }
  }
  return out;
}

// Yield the statements in a block, or in the body of a feature/lookup node.
function* iterateItems(node) {
  if (!node) {
    return;
  }
  if (Array.isArray(node.items)) {
    yield* node.items;
    return;
  }
  if (node.body) {
    yield* iterateItems(node.body);
  }
}

export { glyphClassToString };
