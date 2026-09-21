// Which readings follow you down the page, per panel.
//
// Its own file rather than a field on each panel: main.js is an entry file and
// touches document at the top level, so a test cannot import it, and the ids
// here are exactly the kind of thing that rots silently. test/markup.test.js
// imports this and checks every id against the markup.
//
// The rule these answer: after Run is pressed, what is the ONE thing you are
// looking at? recognition has fifteen knobs between its button and its stats,
// and once it is running not one of them matters.

/**
 * A list of stat ids to mirror, or `{ mirror }` to hoist a whole element.
 * @type {Record<string, string[] | { mirror: string }>}
 */
export const HEADLINES = {
  // ⑫'s verdict is the clocks together: if the fed count stops while the wall
  // clock runs, the capture path was closed rather than the thread frozen.
  residency: ['resFed', 'resBehind', 'resTotal'],

  // The exception. This panel is script-driven and already has a display built
  // to be read at arm's length while you talk over the phone's own speaker — a
  // 24 px cue and a 40 px count. During a run that IS the readout; the stat
  // rows are what you read afterwards.
  acoustics: { mirror: 'acBar' },

  // ⑦ is a count of misses and false triggers; ⑯ is whether the head of the
  // sentence survived. Both are read while you are still shouting.
  recognition: ['rcHits', 'rcSegs', 'rcLastText'],

  // ⑨ is judged from the turn log, which cannot live in a bar. What the bar
  // owes is whether the loop is still alive.
  providers: ['pvState'],
};
