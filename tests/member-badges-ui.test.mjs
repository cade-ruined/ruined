import assert from "node:assert/strict";
import test from "node:test";
import { badgeUIFixture, nodes, text } from "./helpers/member-badge-ui-fixture.mjs";
const award = { key: "early-supporter", label: "I Was Here", description: "Joined the waitlist, then activated a Founders or Originals membership.", earnedAt: "2026-09-28T23:30:00-07:00" };
const fixture = (initial = {}) => badgeUIFixture({ badges: [award], ...initial });

test("members without awards have no badge row or locked placeholders", () => {
  const ui = fixture({ badges: [] });
  assert.equal(ui.draw(), null);
  assert.equal(ui.dialog.opens, 0);
  assert.equal(ui.document.activeElement, ui.original);
});

const sampleBadges = Array.from({ length: 6 }, (_, index) => ({
  key: `sample-${index}`, label: `Sample ${index + 1}`, description: `Earned sample ${index + 1} through an example event.`,
  earnedAt: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00Z`, stamp: String(index + 1).padStart(2, "0"),
}));
const badgeButtons = tree => nodes(tree).filter(node => node.type === "button" && node.props["aria-haspopup"] === "dialog");
const activeBadge = ui => badgeButtons(ui.draw()).find(node => node.props["data-active"]);
function key(ui, index, key) {
  let prevented = false;
  badgeButtons(ui.draw())[index].props.onKeyDown({ key, preventDefault() { prevented = true; } });
  ui.draw(); return prevented;
}
function scroll(ui, position) {
  ui.elements.get("row").scrollLeft = position;
  nodes(ui.draw()).find(node => node.type === "ul").props.onScroll();
  ui.draw();
}

test("the dock shows only stamps and one active focus target; hover and focus enlarge without opening details", () => {
  const ui = fixture({ badges: sampleBadges });
  let buttons = badgeButtons(ui.draw());
  assert.deepEqual(buttons.map(node => text(node)), ["01", "02", "03", "04", "05", "06"]);
  assert.deepEqual(buttons.map(node => node.props.tabIndex), [0, -1, -1, -1, -1, -1]);
  assert.equal(buttons[0].props["data-active"], true);
  assert.equal(buttons[1].props["data-neighbor"], true);
  assert.equal(buttons[2].props["data-neighbor"], undefined);
  buttons[2].props.onPointerEnter({ pointerType: "touch" });
  assert.equal(activeBadge(ui).props["aria-label"], "Sample 1 badge. View details", "A finger entering an icon while swiping must not select it");
  buttons[2].props.onPointerEnter({ pointerType: "mouse" });
  buttons = badgeButtons(ui.draw());
  assert.deepEqual(buttons.map(node => node.props.tabIndex), [-1, -1, 0, -1, -1, -1]);
  assert.equal(buttons[1].props["data-neighbor"], true);
  assert.equal(buttons[3].props["data-neighbor"], true);
  buttons[4].props.onFocus();
  assert.equal(activeBadge(ui).props["aria-label"], "Sample 5 badge. View details");
  assert.equal(ui.dialog.opens, 0);
  ui.unmount();
});

test("keyboard arrows, Home and End move the roving focus and reveal icons without opening details", () => {
  const ui = fixture({ badges: sampleBadges }), row = ui.layout();
  assert.equal(key(ui, 0, "ArrowRight"), true);
  assert.equal(activeBadge(ui).props["aria-label"], "Sample 2 badge. View details");
  assert.equal(ui.document.activeElement, ui.buttons.get("Sample 2 badge. View details"));
  assert.deepEqual(ui.document.activeElement.focusOptions, { preventScroll: true });
  assert.equal(key(ui, 1, "End"), true);
  assert.equal(activeBadge(ui).props["aria-label"], "Sample 6 badge. View details");
  assert.ok(row.scrollLeft > 0, "An offscreen keyboard target is revealed in the dock");
  scroll(ui, 60);
  assert.equal(activeBadge(ui).props["aria-label"], "Sample 6 badge. View details", "The scroll caused by keyboard movement must not replace keyboard selection");
  assert.equal(key(ui, 5, "Home"), true);
  assert.equal(activeBadge(ui).props["aria-label"], "Sample 1 badge. View details");
  assert.equal(key(ui, 0, "ArrowLeft"), true);
  assert.equal(activeBadge(ui).props["aria-label"], "Sample 1 badge. View details", "Arrow keys stop at the dock boundary");
  assert.equal(key(ui, 0, "Tab"), false, "Tab retains normal page navigation");
  assert.equal(key(ui, 0, "Enter"), false, "Native button Enter activates the detail dialog");
  assert.equal(ui.dialog.opens, 0);
  ui.unmount();
});

test("native scrolling selects the nearest center badge and reaches both end badges", () => {
  const ui = fixture({ badges: sampleBadges }), row = ui.layout();
  scroll(ui, 40);
  assert.equal(activeBadge(ui).props["aria-label"], "Sample 3 badge. View details");
  scroll(ui, row.scrollWidth - row.clientWidth);
  assert.equal(activeBadge(ui).props["aria-label"], "Sample 6 badge. View details");
  scroll(ui, 0);
  assert.equal(activeBadge(ui).props["aria-label"], "Sample 1 badge. View details");
  key(ui, 0, "ArrowRight");
  nodes(ui.draw()).find(node => node.type === "ul").props.onPointerDown();
  scroll(ui, 90);
  assert.equal(activeBadge(ui).props["aria-label"], "Sample 4 badge. View details", "A new touch gesture restores selection from scrolling");
  assert.equal(ui.dialog.opens, 0);
  ui.unmount();
});

test("wheel gestures move only an overflowing dock and release page scrolling at its boundaries", () => {
  const ui = fixture({ badges: sampleBadges }), row = ui.layout();
  function wheel(change = {}) {
    let prevented = false;
    row.dispatch("wheel", { deltaX: 0, deltaY: 48, deltaMode: 0, cancelable: true, ...change, preventDefault() { prevented = true; } });
    return prevented;
  }
  assert.equal(wheel({ deltaY: -48 }), false);
  assert.equal(row.scrollLeft, 0);
  assert.equal(wheel(), true); assert.equal(row.scrollLeft, 48);
  assert.equal(wheel({ deltaY: 2, deltaMode: 1 }), true); assert.equal(row.scrollLeft, 80);
  assert.equal(wheel({ deltaX: -60, deltaY: 1 }), true); assert.equal(row.scrollLeft, 20);
  assert.equal(wheel({ deltaY: 1, deltaMode: 2 }), true); assert.equal(row.scrollLeft, row.scrollWidth - row.clientWidth);
  assert.equal(wheel(), false);
  row.scrollLeft = 60;
  for (const change of [{ ctrlKey: true }, { metaKey: true }, { cancelable: false }, { deltaY: 0 }]) {
    assert.equal(wheel(change), false); assert.equal(row.scrollLeft, 60);
  }
  row.scrollWidth = row.clientWidth;
  assert.equal(wheel(), false, "The one-badge or fully visible dock never traps page scrolling");
  ui.unmount();
  assert.equal(row.listeners.get("wheel").size, 0, "The native listener is removed on unmount");
});

test("clicking any dock stamp opens that badge's name, earning reason and date, with focus returned to that stamp", () => {
  const ui = fixture({ badges: sampleBadges });
  const tree = ui.click("Sample 4 badge. View details"), dialog = nodes(tree).find(node => node.type === "dialog");
  assert.equal(text(nodes(tree).find(node => node.props.id === dialog.props["aria-labelledby"])), "Sample 4");
  assert.equal(text(nodes(tree).find(node => node.props.id === dialog.props["aria-describedby"])), sampleBadges[3].description);
  assert.equal(text(nodes(tree).find(node => node.type === "time")), "Sep 4, 2026");
  ui.click("Close badge details"); ui.flushFrames();
  assert.equal(ui.document.activeElement, ui.buttons.get("Sample 4 badge. View details"));
  assert.equal(activeBadge(ui).props["aria-label"], "Sample 4 badge. View details");
  ui.unmount();
});

test("removing the active stamp leaves exactly one keyboard entry point among the remaining awards", () => {
  const ui = fixture({ badges: sampleBadges });
  badgeButtons(ui.draw())[3].props.onFocus();
  const buttons = badgeButtons(ui.draw({ badges: sampleBadges.slice(0, 2) }));
  assert.deepEqual(buttons.map(node => node.props.tabIndex), [0, -1]);
  assert.equal(buttons[0].props["data-active"], true);
  ui.unmount();
});

test("a compact earned badge opens an accessible native detail modal with its UTC award date", () => {
  const ui = fixture();
  const trigger = ui.button("I Was Here badge. View details");
  assert.equal(trigger.props["aria-haspopup"], "dialog");
  assert.equal(trigger.props.type, "button");
  assert.equal(ui.dialog.opens, 0);
  const tree = ui.click("I Was Here badge. View details");
  const dialog = nodes(tree).find(node => node.type === "dialog");
  assert.equal(ui.dialog.opens, 1, "Native showModal traps focus and makes the rest of the page inert");
  assert.equal(ui.document.body.style.overflow, "scroll", "CSS locks the open modal without replacing another owner's inline scroll state");
  assert.equal(ui.document.activeElement.name, "Close badge details");
  assert.equal(dialog.props.id, trigger.props["aria-controls"]);
  assert.equal(text(nodes(tree).find(node => node.props.id === dialog.props["aria-labelledby"])), award.label);
  assert.equal(text(nodes(tree).find(node => node.props.id === dialog.props["aria-describedby"])), award.description);
  assert.equal(text(nodes(tree).find(node => node.type === "time")), "Sep 29, 2026");
  assert.equal(nodes(tree).find(node => node.type === "time").props.dateTime, award.earnedAt);
  assert.doesNotMatch(text(tree), /no payment was taken/);
  ui.draw(); assert.equal(ui.dialog.opens, 1, "A parent render does not steal focus or reopen details");
  ui.unmount();
});

test("an earned badge downloads its original transparent PNG through a named native link", () => {
  const ui = fixture();
  assert.equal(nodes(ui.draw()).some(node => node.type === "a" && node.props.download), false);
  const tree = ui.click("I Was Here badge. View details");
  const downloads = nodes(tree).filter(node => node.type === "a" && node.props.download);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].props.href, "/membership/badges/i-was-here-red-dashes-v2.png");
  assert.equal(downloads[0].props.download, "ruined-i-was-here-badge.png");
  assert.equal(downloads[0].props["aria-label"], "Save I Was Here badge as a transparent PNG");
  assert.equal(text(downloads[0]), "Save badge");
  assert.ok(nodes(tree).some(node => node.props.role === "img" && node.props["aria-label"] === "Ruined"));
  ui.unmount();
});

test("placeholder badge details do not retain another badge's artwork download", () => {
  const ui = fixture({ badges: [award, ...sampleBadges] });
  ui.click("I Was Here badge. View details");
  ui.click("Close badge details");
  const tree = ui.click("Sample 1 badge. View details");
  assert.equal(nodes(tree).some(node => node.type === "a" && node.props.download), false);
  assert.doesNotMatch(text(tree), /Save badge/);
  ui.unmount();
});

test("Escape and Close restore focus to the badge and restore prior page scrolling", () => {
  for (const method of ["escape", "close"]) {
    const ui = fixture();
    const tree = ui.click("I Was Here badge. View details");
    if (method === "escape") {
      let prevented = false;
      nodes(tree).find(node => node.type === "dialog").props.onCancel({ preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
      ui.draw();
    } else ui.click("Close badge details");
    ui.flushFrames();
    assert.equal(ui.dialog.closes, 1);
    assert.equal(ui.document.body.style.overflow, "scroll");
    assert.equal(ui.document.activeElement, ui.buttons.get("I Was Here badge. View details"));
    assert.deepEqual(ui.document.activeElement.focusOptions, { preventScroll: true });
  }
});

test("removing an award closes its detail modal and restores page scrolling", () => {
  const ui = fixture();
  ui.click("I Was Here badge. View details");
  assert.equal(ui.draw({ badges: [] }), null);
  assert.equal(ui.dialog.closes, 1);
  assert.equal(ui.document.body.style.overflow, "scroll");
});
