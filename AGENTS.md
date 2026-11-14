# Agent notes

## Simulator wiring

- A pin seated in a breadboard is physically under its part. A wire for that
  pin must end in a **free hole on the same strip**, using `wireEnd()` from
  `sim/snap.js`; never terminate the wire on the pin id itself.
- Checklist links keep pin ids because they describe the electrical connection.
  Only the drawn and saved wire endpoints use board holes
  (`bb1:a12`). `sim/plan.js` must generate project wire steps the same way
  `sim/recipes.js` does.
- Project plans use fixed holes for on-board parts; do not auto-arrange them at
  runtime. Off-board parts and screens (`onBoard: false`) stay on the table.

## Browser checks

- Playwright CLI (`@playwright/cli`) is installed globally on this machine as
  `playwright-cli`. Use it for browser exploration, interaction and screenshots
  when available: start the app with `npm start`, then open
  `http://localhost:8787/sim/` or `http://localhost:8787/sim/lab.html?part=<id>`.
- Do **not** add `@playwright/cli` to `package.json`; it is a local tool, not a
  project dependency.
- For repeatable acceptance suites, use `@playwright/test` as a project
  devDependency instead of relying on the global CLI.
- The browser acceptance checklist for the simulator is
  `docs/sim-first-pack-acceptance.md`.
