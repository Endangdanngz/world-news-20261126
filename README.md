[![news-image-20261126](https://make.fun/badge/news-image-20261126.svg)](https://make.fun/bounty/news-image-20261126)
[![rank](https://make.fun/badge/news-image-20261126/Endangdanngz/world-news-20261126/rank.svg)](https://make.fun/bounty/news-image-20261126)
[![reward](https://make.fun/badge/news-image-20261126/Endangdanngz/world-news-20261126/reward.svg)](https://make.fun/bounty/news-image-20261126)

# The World Today — Thursday, 26 November 2026

One image that sums up the world news of 26 November 2026: a front page
built around the day's biggest story, with the rest of the day's news
running down the side.

## Lead story: BepiColombo reaches Mercury after eight years

After eight years in space, a journey of roughly ten billion kilometres
and nine planetary flybys, the joint ESA–JAXA mission BepiColombo has
entered orbit around Mercury. It is the first orbiter to circle the
innermost planet since NASA's MESSENGER mission ended in 2015, and only
the third spacecraft ever to orbit Mercury.

The final engine burn came in shorter than planned, but it did the job:
the spacecraft is captured, and the mission is now in orbit. The two
orbiters it carries — ESA's Mercury Planetary Orbiter (MPO) and JAXA's
Mercury Magnetospheric Orbiter, Mio — separate on 9 December, and science
operations begin in April 2027. Eight years of travel, and the real work
starts now.

## Also on the front page

**NATO jets scramble over Poland.** Russian missiles and drones crossed
Polish airspace during a large-scale attack on Ukraine, and NATO
fighters were scrambled in response. Allied consultations followed, as
the alliance weighed how to answer an incursion that crossed from a war
zone into NATO territory.

**Colombia marks ten years of peace.** A decade after the peace accord
with the FARC was signed in Bogotá on 24 November 2016, ending more
than fifty years of war, Colombia commemorates the agreement. UN
Secretary-General António Guterres used the anniversary to press for
the deal to be implemented in full, warning that the promises made to
victims and former fighters still need finishing.

**Also today:** Australia signs a security treaty with the Solomon
Islands; Venezuela's public debt is revealed at $237.5 billion; and
Suez Canal revenues more than double.

## How the program works

`main.ts` is a segment-ledger auditor for the front-page JPEG. It does
not draw the image — the newsroom image is `entry.png`, finished before
the program runs. The program:

1. Pins the edition by size (317,129 bytes) and SHA-256 fingerprint, so
   no other file can pass itself off as this front page.
2. Walks the JPEG header segment by segment — marker, offset, declared
   length — and checks that the segments sit exactly end to end, with
   no gaps and no overlaps.
3. Requires the file to open with SOI followed by a JFIF APP0 header.
4. Requires exactly one baseline frame (SOF0), 1024×1024 pixels with
   three components, and exactly one scan (SOS) after it.
5. Requires one comment (COM) segment carrying the edition stamp
   `THE WORLD TODAY - 26 NOVEMBER 2026 - BEPICOLOMBO`.
6. Splits every quantisation (DQT) segment into whole tables — 65 bytes
   for 8-bit tables, 129 bytes for 16-bit — and requires at least two
   tables in the file.
7. Traces the entropy-coded data after SOS, honouring stuffed `FF00`
   bytes and restart markers, until the EOI marker, which must be the
   very last byte of the file.

Only when every check passes does the program write the verified bytes
to the output directory and read them back to confirm they match
byte-for-byte. Any failure stops the run before anything is published.

## Run it locally

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

The verified front page is written to `$MAKEFUN_OUTPUT_DIR/entry.png`
(`./output/entry.png` by default). Running the program twice produces
byte-identical output.

## License

MIT — see [LICENSE](LICENSE).
