// The button that turns the tab into the app.
//
// Installed from the home screen the page opens full screen and sideways (see
// manifest.webmanifest); in a tab it does neither, and "Add to home screen" is
// three taps into a menu nobody goes looking in. Chrome says when the page can
// be installed by firing `beforeinstallprompt`, and only then: not in the
// installed app, not once installed, not in a browser that cannot. So the
// button exists exactly when pressing it would do something, and there is no
// other condition to get wrong.

/**
 * @param {HTMLElement} button hidden until the browser makes an offer
 * @param {Window} [win]
 */
export function offerInstall(button, win = globalThis.window) {
  /** @type {(Event & { prompt(): Promise<unknown> }) | null} */
  let offer = null;
  const withdraw = () => { offer = null; button.hidden = true; };

  win.addEventListener('beforeinstallprompt', (e) => {
    // Chrome's own mini-bar otherwise, which comes and goes on its own
    // schedule. One way in, and it is this one.
    e.preventDefault();
    offer = /** @type {any} */ (e);
    button.hidden = false;
  });
  button.addEventListener('click', () => {
    // An offer can be shown once. Whatever the user answers, it is spent.
    const spent = offer;
    withdraw();
    void spent?.prompt();
  });
  win.addEventListener('appinstalled', withdraw);
}
