# Fontra — with a graphical OpenType feature editor

This is a fork of [Fontra](https://github.com/fontra/fontra) that adds a
graphical editor for OpenType layout features.

Everything else is unchanged: the code, the file formats, the backends. The
feature editor is an additional panel in the **Font Info** view, next to the
existing **Feature Code** panel that lets you write FEA by hand.

## What it does

The Feature Editor reads the font's existing feature code and presents it as
editable rows, grouped by what the feature is for:

- **Ligatures** — `liga`, `clig`, `dlig`, `hlig`, `rlig`, `calt`, `rclt`
- **Arabic** — `isol`, `init`, `medi`, `fina`, `fin2`, `fin3`, `med2`, plus the
  composition and mark features Arabic needs
- **Indic / other scripts**, positioning, figures, caps, stylistic sets, widths
- **Script & language**

Each substitution rule is shown as a row, colour-coded and labelled by kind:

| Label | Meaning |
| --- | --- |
| `ligature` | two or more glyphs become one (`sub f i by f_i`) |
| `contextual` | a substitution that depends on surrounding glyphs |
| `substitution` | one glyph becomes another |
| `decomposition` | one glyph becomes several |
| `deletion` | a glyph is removed |

Glyphs that are referenced but not present in the font are flagged in red, which
is the most common way to break a feature by hand. Rules that live in a named
lookup show which lookup defines them, and rules can be added or deleted per
feature.

## Live preview

Type into the preview field and the text is shaped through HarfBuzz using the
font's *actual* feature code, so you see the result of your edits immediately.
Direction is detected per input, so Arabic text shapes right-to-left with its
joining forms.

If the feature code does not compile, the preview says so rather than silently
showing unshaped text — a fallback that is easy to miss when you are editing FEA
by hand.

## Safety

The editor parses feature code into a tree and writes it back out. Anything it
does not understand — `pos` rules, `markClass`, `conditionset`, variable-font
`variation` blocks, whatever else — is preserved verbatim, so editing through the
GUI never destroys hand-written code. The parser is covered by a byte-exact
round-trip test against the real-world [Raqq](https://github.com/aliftype/raqq)
Arabic font, which exercises the full `isol`/`init`/`medi`/`fina` feature set.

Edits go through `fontController.performEdit()`, so they are undoable like any
other Fontra edit, and they work for every backend that supports feature code.

## Building Fontra Pak

This fork is wired into the [fontra-pak](https://github.com/timtom0/fontra-pak)
fork, so a Fontra Pak built from it includes the feature editor:

```sh
git clone https://github.com/timtom0/fontra-pak
cd fontra-pak
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt -r requirements-dev.txt
.venv/Scripts/python.exe -m pyinstaller FontraPak.spec -y
```

`requirements.txt` points at `timtom0/fontra@opentype-features-gui`. To build
against a different fork:

```sh
set FONTRA_PAK_FONTRA_URL=git+https://github.com/you/fontra.git@my-branch
.venv/Scripts/python.exe scripts/patch_fontra_requirement.py
```

Or to run from source:

```sh
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
npm install
npm run bundle
.venv/Scripts/python.exe -m fontra filesystem /path/to/a/folder
```

## Tests

```sh
npm test                          # JavaScript
.venv/Scripts/python.exe -m pytest   # Python
```
