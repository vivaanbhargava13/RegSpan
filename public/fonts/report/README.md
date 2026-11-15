# RegSpan report fonts

Unmodified static TrueType fonts from Adobe's Source families, licensed under the
SIL Open Font License 1.1. The copyright and license notices are included alongside
the assets. No font build, subsetting or modification was performed on these files;
React PDF subsets them when embedding each generated report.

| Family | Face | React PDF weight |
| --- | --- | --- |
| Source Serif 4 | Regular | 400 |
| Source Serif 4 | Semibold | 600 |
| Source Sans 3 | Regular | 400 |
| Source Sans 3 | Semibold | 600 |

Upstream repositories:

- https://github.com/adobe-fonts/source-serif
- https://github.com/adobe-fonts/source-sans

`sources.json` records immutable upstream URLs (commit SHA) and SHA-256 checksums
for each TTF. The matching licenses were downloaded from those same commits.

The renderer loads these files locally. `next.config.ts` traces them into standalone
output; the existing Dockerfile also copies `public/`. Export performs no network
font fetches and adds no runtime package dependency.
