// Dark Reader (a browser extension) darkens every page unless the page has <meta name="darkreader-lock">, and it keeps
// watching <head> for one that arrives later. The editor and the dashboard are always dark and send the tag themselves.
// Every other page follows the computer's light or dark setting, so this script, run in <head> before the page paints,
// adds the tag only while that page is dark. It never takes the tag away: Dark Reader stops watching once it has
// stepped aside, so a page switched back to light stays as the site drew it until it is reloaded.
export const DARK_READER_LOCK_WHEN_DARK = `(function () {
  var dark = matchMedia("(prefers-color-scheme: dark)");
  function lock() {
    if (!dark.matches || document.querySelector('meta[name="darkreader-lock"]')) return;
    var meta = document.createElement("meta");
    meta.name = "darkreader-lock";
    document.head.appendChild(meta);
  }
  lock();
  dark.addEventListener("change", lock);
})();`;
