# Third-Party Notices

This project uses the following third-party assets and libraries.

## Lucide Icons

The functional icons in `src/ui/icons.js` (play, pause, stop, record,
chevrons, settings, mic, keyboard, database, metronome, close) are
adapted from the [Lucide](https://lucide.dev) icon set, used under
the ISC License.

Lucide is the maintained successor to Feather Icons. The convention
in this project is 24×24 viewBox, `fill="none"`, `stroke="currentColor"`,
`stroke-width="2"`, `stroke-linecap/linejoin="round"`. Consumers size
the SVG via the `size` option (default 18px) and inherit color from
the surrounding `currentColor`.

Lucide ISC License (per <https://lucide.dev/license>):

> ISC License
>
> Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022
> as part of Feather (which was changed and released under MIT by
> Cole Bemis 2013-2022). Copyright (c) for portions of Lucide are held
> by Lucide Contributors 2022.
>
> Permission to use, copy, modify, and/or distribute this software for
> any purpose with or without fee is hereby granted, provided that
> the above copyright notice and this permission notice appear in all
> copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL
> WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED
> WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
> AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL
> DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR
> PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
> TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
> PERFORMANCE OF THIS SOFTWARE.

The metronome icon has no Lucide equivalent and is a small custom
mark under the same ISC terms.

To replace the glyphs in this project, swap the SVG path data in
`src/ui/icons.js` — no component code changes are required.
