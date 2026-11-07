import { setIconPath } from '@awesome.me/webawesome/dist/utilities/base-path.js';

// Serve Font Awesome icons from this app's own build (copied from
// @fortawesome/fontawesome-free by the angular.json assets glob) instead of
// Web Awesome's default CDN, so icons work offline. Only the solid set is
// copied; add another folder to the glob if a regular or brands icon is used.
// Must run before any Web Awesome component loads, so main.ts imports it first.
setIconPath('/fontawesome/svgs');
