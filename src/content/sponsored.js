// Hides anything labelled "Sponsored" that the CSS selectors miss
// (sponsored cards inside Amazon carousels, sponsored carousels, Google ad blocks).
const CONTAINER = location.hostname.includes("amazon.")
  ? "li, .s-result-item"
  : "#rso > div, #botstuff > div, [data-hveid]";

function hideSponsored() {
  for (const el of document.querySelectorAll("span, a, div")) {
    // Skip hidden labels, e.g. Amazon's ad-info popovers that sit outside the ad card.
    if (el.childElementCount > 0 || !el.offsetParent) continue;
    if (!/^Sponsored( results| products)?$/.test(el.textContent.trim())) continue;
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

new MutationObserver(hideSponsored).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
