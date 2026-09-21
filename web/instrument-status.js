// The one line at the top of every instrument: what is on, and where else you
// can go.
//
// Every fact it shows was already known somewhere in the code — the microphone
// is open, the FT232H is connected, the keep-alive is playing, this panel is
// running — and none of it was ever shown in one place. "I do not know what
// state it is in" is not a missing feature; it is four facts with no home.
//
// A dot plus a label, using the four meanings docs/ui.md fixes. Red is not
// among them: red is the emergency stop's alone, and a status strip is never an
// emergency — it is what is true right now.

/** @typedef {'go' | 'wait' | 'dim'} State */

/**
 * The three instruments. One list, used both for the links and by the test that
 * checks the links go somewhere.
 *
 * Labels are short because they share a line with up to five readings on a
 * phone. English-only, like everything else on these pages.
 */
export const PAGES = [
  { href: 'bench.html', label: 'pin' },
  { href: 'setup.html', label: 'setup' },
  { href: 'audio-bench.html', label: 'audio' },
];

/**
 * @param {HTMLElement} mount the <div id="instrumentStatus"> in the page
 * @param {string[]} items ids of the readings this page has, in display order
 */
export function createStatus(mount, items) {
  /** @type {Map<string, HTMLElement>} */
  const dots = new Map();

  const list = document.createElement('div');
  list.className = 'status-items';
  for (const id of items) {
    const el = document.createElement('span');
    el.className = 'status-item';
    el.dataset.state = 'dim';
    // The dot is a character rather than a styled box so it sits on the text
    // baseline with no alignment fuss at three different font sizes.
    el.textContent = `● ${id}`;
    dots.set(id, el);
    list.append(el);
  }

  const nav = document.createElement('nav');
  nav.className = 'status-nav';
  // Which page this is, read from the document rather than passed in: a page
  // that had to name itself could name itself wrongly, and the only symptom
  // would be a link that looks available and goes nowhere new.
  const here = location.pathname.split('/').pop() || 'index.html';
  for (const page of PAGES) {
    if (page.href === here) {
      const self = document.createElement('span');
      self.textContent = page.label;
      nav.append(self);
    } else {
      const a = document.createElement('a');
      a.href = page.href;
      a.textContent = page.label;
      nav.append(a);
    }
  }

  mount.append(list, nav);

  return {
    /**
     * @param {string} id one of the items this strip was built with
     * @param {State} state
     * @param {string} label
     */
    set(id, state, label) {
      const el = dots.get(id);
      if (!el) return;
      el.dataset.state = state;
      el.textContent = `● ${label}`;
    },
  };
}
