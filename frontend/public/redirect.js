/*
 * Translate an old path-style URL into its hash equivalent.
 *
 * The app moved from path routing to hash routing so that GitHub Pages, which
 * has no rewrite rules, stops answering deep links with a 404 status while
 * rendering them correctly (see src/App.tsx). That change alters every URL:
 * /clean-sweep/chain/abc is now /clean-sweep/#/chain/abc.
 *
 * Links shared before the change still exist, in messages and browser
 * histories, and they should not land on the home page with the round
 * silently lost. Pages serves 404.html for any unmatched path, and 404.html
 * is a copy of index.html, so this script runs on exactly those URLs and can
 * rewrite them before the app ever mounts.
 *
 * It runs on index.html too, where the path is already the site root and
 * there is nothing to translate, so it does nothing. That is why the check
 * below is on the leftover path rather than on which file is executing:
 * one script, one rule, no way for the two copies to disagree.
 *
 * `replace` rather than `assign` so the broken URL does not sit in the back
 * button waiting to be returned to.
 */
(function redirectLegacyPaths() {
  // Where the app is served from: "/clean-sweep/" on Pages, "/" elsewhere.
  // Read from this script's own src so it needs no build-time templating.
  var self = document.currentScript;
  var base = self ? self.src.replace(/redirect\.js.*$/, "") : "/";
  var root = base.replace(/^https?:\/\/[^/]+/, "");

  var path = window.location.pathname;
  if (path.indexOf(root) !== 0) return; // served from somewhere unexpected
  var rest = path.slice(root.length);

  // Nothing after the root, or already a hash route: leave it alone.
  if (!rest || rest === "index.html") return;

  window.location.replace(root + "#/" + rest + window.location.search + window.location.hash);
})();
