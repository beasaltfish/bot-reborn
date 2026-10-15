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
//
// It used to carry links between the three instrument pages as well. There is
// one page now, so there is nowhere to link to.

/** @typedef {'go' | 'wait' | 'dim'} State */


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

  mount.append(list);

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
