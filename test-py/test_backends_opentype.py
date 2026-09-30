import asyncio
import io
import pathlib
import shutil
from contextlib import aclosing

import pytest
from fontTools.ttLib import TTFont

from fontra.backends import getFileSystemBackend, opentype
from fontra.core.classes import (
    Axes,
    CrossAxisMapping,
    FontAxis,
    FontSource,
    LineMetric,
    VariableGlyph,
)
from fontra.core.fonthandler import FontHandler
from fontra.filesystem.projectmanager import FileSystemProjectManager

opentype._USE_SOURCE_INDEX_INSTEAD_OF_UUID = True

dataDir = pathlib.Path(__file__).resolve().parent / "data"


@pytest.fixture
def testFontMutatorSans():
    return getFileSystemBackend(dataDir / "mutatorsans" / "MutatorSans.ttf")


@pytest.fixture
def testFontAvar2():
    return getFileSystemBackend(dataDir / "avar2" / "DemoAvar2.ttf")


@pytest.fixture
def testFontAvar2NLI():
    return getFileSystemBackend(dataDir / "avar2" / "DemoAvar2-NLI.ttf")


expectedAxes = Axes(
    axes=[
        FontAxis(
            name="DIAG",
            label="Diagonal",
            tag="DIAG",
            minValue=0.0,
            defaultValue=0.0,
            maxValue=100.0,
            mapping=[],
            valueLabels=[],
            hidden=False,
            customData={},
        ),
        FontAxis(
            name="HORI",
            label="Horizontal",
            tag="HORI",
            minValue=0.0,
            defaultValue=0.0,
            maxValue=100.0,
            mapping=[],
            valueLabels=[],
            hidden=True,
            customData={},
        ),
        FontAxis(
            name="VERT",
            label="Vertical",
            tag="VERT",
            minValue=0.0,
            defaultValue=0.0,
            maxValue=100.0,
            mapping=[],
            valueLabels=[],
            hidden=True,
            customData={},
        ),
    ],
    mappings=[
        CrossAxisMapping(
            description=None,
            groupDescription=None,
            inputLocation={
                "DIAG": 25.0,
            },
            outputLocation={
                "HORI": 0.0,
                "VERT": 33.001708984375,
            },
        ),
        CrossAxisMapping(
            description=None,
            groupDescription=None,
            inputLocation={
                "DIAG": 75.0,
            },
            outputLocation={
                "HORI": 100.0,
                "VERT": 67.00032552083334,
            },
        ),
        CrossAxisMapping(
            description=None,
            groupDescription=None,
            inputLocation={
                "DIAG": 100.0,
            },
            outputLocation={
                "HORI": 100.0,
                "VERT": 100.0,
            },
        ),
    ],
    elidedFallBackname=None,
    customData={},
)


async def test_readAvar2(testFontAvar2):
    axes = await testFontAvar2.getAxes()
    assert expectedAxes == axes


expectedAxesNLI = Axes(
    axes=[
        FontAxis(
            name="BEND",
            label="Bend",
            tag="BEND",
            minValue=0.0,
            defaultValue=0.0,
            maxValue=100.0,
            mapping=[],
            valueLabels=[],
            hidden=False,
            customData={},
        ),
        FontAxis(
            name="BND2",
            label="Bend-2",
            tag="BND2",
            minValue=0.0,
            defaultValue=0.0,
            maxValue=100.0,
            mapping=[],
            valueLabels=[],
            hidden=True,
            customData={},
        ),
    ],
    mappings=[
        CrossAxisMapping(
            description=None,
            groupDescription=None,
            inputLocation={"BEND": 100},
            outputLocation={"BND2": 100},
        )
    ],
    elidedFallBackname=None,
    customData={},
)


async def test_readAvar2NLI(testFontAvar2NLI):
    axes = await testFontAvar2NLI.getAxes()
    assert expectedAxesNLI == axes


async def test_externalChanges(tmpdir):
    tmpdir = pathlib.Path(tmpdir)
    sourcePath = dataDir / "mutatorsans" / "MutatorSans.subset.ttf"
    destPath = tmpdir / "testfont.ttf"
    shutil.copy(sourcePath, destPath)

    backend = getFileSystemBackend(destPath)
    handler = FontHandler(
        backend=backend,
        projectIdentifier="test",
        metaInfoProvider=FileSystemProjectManager(),
    )

    async with aclosing(handler):
        await handler.startTasks()

        glyph = await handler.getGlyph("A")
        assert glyph.layers["font-source-0"].glyph.xAdvance == 396

        ttFont = TTFont(destPath)
        assert ttFont["hmtx"]["A"] == (396, 20)
        ttFont["hmtx"]["A"] = (999, 20)
        ttFont.save(destPath)

        await asyncio.sleep(0.15)  # give the file watcher a moment to catch up

        modifiedGlyph = await handler.getGlyph("A")

        assert modifiedGlyph.layers["font-source-0"].glyph.xAdvance == 999


async def test_readTTX():
    path = dataDir / "mutatorsans" / "MutatorSans.subset.ttx"
    font = getFileSystemBackend(path)
    glyph = await font.getGlyph("A")
    assert isinstance(glyph, VariableGlyph)


async def test_getShaperFontData_ttf():
    path = dataDir / "mutatorsans" / "MutatorSans.ttf"
    font = getFileSystemBackend(path)
    shaperFontData = await font.getShaperFontData()
    assert shaperFontData is not None
    f = io.BytesIO(shaperFontData.data)
    font = TTFont(f)
    assert sorted(font.keys()) == [
        "GDEF",
        "GPOS",
        "GSUB",
        "GlyphOrder",
        "fvar",
        "head",
        "maxp",
        "name",
        "post",
    ]


async def test_getShaperFontData_ttx():
    path = dataDir / "mutatorsans" / "MutatorSans.subset.ttx"
    font = getFileSystemBackend(path)
    shaperFontData = await font.getShaperFontData()
    assert shaperFontData is not None
    f = io.BytesIO(shaperFontData.data)
    font = TTFont(f)
    assert sorted(font.keys()) == [
        "GDEF",
        "GPOS",
        "GSUB",
        "GlyphOrder",
        "fvar",
        "head",
        "maxp",
        "name",
        "post",
    ]


async def test_getShaperFontData_woff2():
    path = dataDir / "mutatorsans" / "MutatorSans.subset.woff2"
    font = getFileSystemBackend(path)
    shaperFontData = await font.getShaperFontData()
    assert shaperFontData is not None
    f = io.BytesIO(shaperFontData.data)
    font = TTFont(f)
    assert font.flavor is None
    assert sorted(font.keys()) == [
        "GDEF",
        "GPOS",
        "GSUB",
        "GlyphOrder",
        "fvar",
        "head",
        "maxp",
        "name",
        "post",
    ]


async def test_getSources(testFontMutatorSans):
    sources = await testFontMutatorSans.getSources()
    assert len(sources) == 4

    expectedSourceValues = [
        FontSource(
            name="LightCondensed",
            lineMetricsHorizontalLayout={
                "ascender": LineMetric(value=700),
                "baseline": LineMetric(value=0),
                "capHeight": LineMetric(value=700),
                "descender": LineMetric(value=-200),
                "xHeight": LineMetric(value=500),
            },
        ),
        FontSource(
            name="wdth=1000",
            location={"wdth": 1000.0},
            lineMetricsHorizontalLayout={
                "ascender": LineMetric(value=700),
                "baseline": LineMetric(value=0),
                "capHeight": LineMetric(value=700),
                "descender": LineMetric(value=-200),
                "xHeight": LineMetric(value=500),
            },
        ),
        FontSource(
            name="wdth=1000,wght=900",
            location={"wdth": 1000.0, "wght": 900.0},
            lineMetricsHorizontalLayout={
                "ascender": LineMetric(value=800),
                "baseline": LineMetric(value=0),
                "capHeight": LineMetric(value=800),
                "descender": LineMetric(value=-200),
                "xHeight": LineMetric(value=500),
            },
        ),
        FontSource(
            name="wght=900",
            location={"wght": 900.0},
            lineMetricsHorizontalLayout={
                "ascender": LineMetric(value=800),
                "baseline": LineMetric(value=0),
                "capHeight": LineMetric(value=800),
                "descender": LineMetric(value=-200),
                "xHeight": LineMetric(value=500),
            },
        ),
    ]
    assert list(sources.values()) == expectedSourceValues


fontSourceNamesTestData = [
    (
        dataDir / "sourcesans" / "SourceSans3VF-Upright.subset.otf",
        ["ExtraLight", "Semibold", "Black"],
    )
]


@pytest.mark.parametrize("fontPath, expectedNames", fontSourceNamesTestData)
async def test_font_sources_names(fontPath, expectedNames):
    font = getFileSystemBackend(fontPath)
    sources = await font.getSources()
    sourceNames = [s.name for s in sources.values()]
    assert sourceNames == expectedNames


async def test_os2_version1():
    # https://github.com/fontra/fontra/issues/2548
    fontPath = dataDir / "noto" / "NotoSans-Regular.subset.os2-version1.otf"
    font = getFileSystemBackend(fontPath)
    sources = await font.getSources()
    assert len(sources) == 1
    [source] = sources.values()
    assert source.lineMetricsHorizontalLayout == {
        "ascender": LineMetric(value=1069),
        "baseline": LineMetric(value=0),
        "descender": LineMetric(value=-293),
    }


async def test_getFeatures_ttf_recovers_layout_features():
    """A .ttf's compiled GSUB/GPOS must show up as feature code.

    Regression test: the TTF backend used to return an empty OpenTypeFeatures,
    so opening a .ttf showed no features at all.
    """
    path = dataDir / "mutatorsans" / "MutatorSans.ttf"
    font = getFileSystemBackend(path)
    features = await font.getFeatures()

    assert features.language == "fea"
    assert features.text, "no feature code was recovered"

    # The recovered text must be valid feature code that Fontra's own shaper
    # (feaLib) can parse: every recovered feature block has to parse.
    from fontTools.feaLib.parser import Parser

    feaPath = path.parent / "recovered-features.fea"
    feaPath.write_text(features.text, encoding="utf-8")
    ttFont = TTFont(path)
    Parser(
        str(feaPath), glyphNames=ttFont.getGlyphOrder(), includeDir=str(path.parent)
    ).parse()
    feaPath.unlink()


async def test_getFeatures_ttf_warns_features_are_not_writable():
    """Recovered feature code carries a warning: a .ttf can't be written back."""
    path = dataDir / "mutatorsans" / "MutatorSans.ttf"
    font = getFileSystemBackend(path)
    features = await font.getFeatures()
    assert "FONTRA WARNING" in features.text
    assert ".ttf" in features.text


async def test_getFeatures_ttf_recovers_kern(testFontMutatorSans):
    """A .ttf's compiled features must come back as feature code.

    Note the GSUB feature 'rvrn' has no lookups (it is generated by fvar), so it
    produces no feature block and is legitimately absent from the recovered text.
    """
    import re

    tagPattern = re.compile(r"^\s*feature\s+(\w+)\s*\{", re.M)
    ttfBackend = getFileSystemBackend(dataDir / "mutatorsans" / "MutatorSans.ttf")

    tagsTTF = set(tagPattern.findall((await ttfBackend.getFeatures()).text))

    assert "kern" in tagsTTF, tagsTTF


async def test_getFeatures_unreadable_table_does_not_lose_the_other():
    """One unreadable layout table must not cost us the readable one.

    fontFeatures raises on this font's .ttx GPOS (a fully qualified pair value
    record with no Value2). GSUB must still come through, and the warning must
    say the features are incomplete.
    """
    backend = getFileSystemBackend(dataDir / "mutatorsans" / "MutatorSans.subset.ttx")
    features = await backend.getFeatures()

    assert features.text, "expected the readable table to survive"
    assert "GPOS" in features.text
    assert "could not be read" in features.text


async def test_getFeatures_font_without_layout_tables():
    """A font with no GSUB/GPOS yields no feature code, and does not crash."""
    font = getFileSystemBackend(dataDir / "mutatorsans" / "MutatorSans.subset.ttf")
    # Strip the layout tables to simulate a plain font.
    for tableTag in ("GSUB", "GPOS"):
        if tableTag in font.font:
            del font.font[tableTag]

    features = await font.getFeatures()
    assert features.text == ""
