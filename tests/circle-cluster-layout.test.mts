import assert from "node:assert/strict";
import test from "node:test";

import { circleClusterPositions } from "../src/lib/membership/circle-cluster-layout.ts";

test("the viewer stays centered regardless of roster order and Circle size", () => {
  for (let count = 1; count <= 24; count++) {
    for (let viewer = 0; viewer < count; viewer++) {
      const positions = circleClusterPositions(count, viewer);
      assert.equal(positions.length, count);
      assert.equal(positions[viewer].left, 50);
      assert.equal(positions[viewer].top, 50);
      assert.equal(positions.filter((position) => position.left === 50 && position.top === 50).length, 1);
      assert.equal(new Set(positions.map(({ left, top }) => `${left},${top}`)).size, count);
      for (const { left, top, size } of positions) {
        assert.ok(size > 0);
        assert.ok(left - size / 2 >= 0 && left + size / 2 <= 100);
        assert.ok(top - size / 2 >= 0 && top + size / 2 <= 100);
      }
    }
  }
});

test("larger Circles retain usable portrait sizes on a narrow phone", () => {
  for (const count of [5, 8, 10, 12, 14, 20]) {
    for (const { size } of circleClusterPositions(count, count - 1)) {
      assert.ok(size / 100 * 272 >= 44, `${count} members: portrait smaller than 44px`);
    }
  }
});

test("empty and viewer-free rosters remain displayable", () => {
  assert.deepEqual(circleClusterPositions(0, -1), []);
  assert.deepEqual(circleClusterPositions(5, -1), circleClusterPositions(5, 0));
});
