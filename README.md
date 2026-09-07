# bot-reborn

A minimal WebUSB console for driving a motor through an **FT232H** breakout in
FTDI async bitbang mode. Pins `D4` and `D5` are used as the two direction
inputs of the motor driver.

## Project layout

```
.
├── README.md
├── wrangler.jsonc      # Cloudflare Pages project config
├── docs/
│   └── hardware.md     # wiring and USB driver notes
└── web/                # Pages output directory (deployed as-is)
    ├── index.html
    ├── app.js
    └── style.css
```

## Local development

WebUSB requires a secure context, which includes `http://localhost`:

```bash
npx serve web        # or: python3 -m http.server -d web 8000
```

Then open the printed URL in Chrome or Edge.

## Deploy to Cloudflare Pages

Direct upload:

```bash
npx wrangler pages project create bot-reborn   # first time only
npx wrangler pages deploy web
```

Git integration (dashboard): leave the build command empty and set the
**build output directory** to `web`.

## Browser support

WebUSB is available in Chromium-based browsers (Chrome, Edge, Opera) only.
Firefox and Safari do not implement it.
