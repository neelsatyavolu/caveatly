// Hides anything labelled "Sponsored" that the CSS selectors miss
// (sponsored cards inside Amazon carousels, sponsored carousels, Google ad blocks),
// on every Amazon storefront and Google search domain (see lib/sponsored-matches.js).
// Bing and DuckDuckGo label ads with a bare "Ad", which is too generic to match
// on text; sponsored.css hides their ad containers by selector instead.

// The whole visible text of a leaf element must be one of these labels, so a
// result that merely mentions the word is never hidden. English phrases come
// first; the rest are the label in each storefront/search language.
const LABELS = new Set([
  "Sponsored", "Sponsored results", "Sponsored products",
  "Gesponsert",     // German
  "Sponsorisé",     // French
  "Sponsorizzato",  // Italian
  "Patrocinado",    // Spanish, Portuguese
  "Gesponsord",     // Dutch
  "Sponsrad",       // Swedish
  "Sponsoreret",    // Danish
  "Sponset",        // Norwegian
  "Sponsoroitu",    // Finnish
  "Sponsorowane",   // Polish
  "Sponzorováno",   // Czech
  "Sponsorlu",      // Turkish
  "スポンサー",       // Japanese
]);

const IS_AMAZON = /(^|\.)amazon\./.test(location.hostname);
const IS_GOOGLE = /(^|\.)google\./.test(location.hostname);
const CONTAINER = IS_AMAZON ? "li, .s-result-item" : "#rso > div, #botstuff > div, [data-hveid]";

function hideSponsored() {
  for (const el of document.querySelectorAll("span, a, div")) {
    // Skip hidden labels, e.g. Amazon's ad-info popovers that sit outside the ad card.
    if (el.childElementCount > 0 || !el.offsetParent) continue;
    if (!LABELS.has(el.textContent.trim())) continue;
    const box = el.closest(CONTAINER);
    if (box) hide(box);
  }
  // A carousel whose cards were all sponsored is now an empty gap; hide it too.
  for (const list of document.querySelectorAll(".a-carousel")) {
    const cards = [...list.children];
    const isHiddenAd = (li) =>
      li.style.display === "none" ||
      (li.firstElementChild && getComputedStyle(li.firstElementChild).display === "none");
    const isOffscreen = (li) => li.style.visibility === "hidden";
    if (cards.some(isHiddenAd) && cards.every((li) => isHiddenAd(li) || isOffscreen(li))) {
      hide(list.closest(".s-result-item") || list);
    }
  }
}

function hide(el) {
  el.style.setProperty("display", "none", "important");
}

if (IS_AMAZON || IS_GOOGLE) {
  new MutationObserver(hideSponsored).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}
