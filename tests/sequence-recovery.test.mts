import assert from "node:assert/strict";
import test from "node:test";
import {
  desktopJourneyRetryDelay,
  frameLoadReady,
  nextFrameLoadFailure,
  sequenceFallbackForFrame,
  sequenceFallbackSpans,
  withSequenceLoadDeadline,
} from "../src/utils/sequenceRecovery.ts";

test("failed frames become retryable after cooldown even after many failures", () => {
  let now = 1_000;
  let failure;
  for (let index = 0; index < 30; index++) {
    failure = nextFrameLoadFailure(failure, now);
    assert.equal(frameLoadReady(failure, now), false);
    assert.equal(frameLoadReady(failure, failure.retryAt - 1), false);
    assert.ok(failure.retryAt - now <= 30_000, "retry delay remains bounded");
    now = failure.retryAt;
    assert.equal(frameLoadReady(failure, now), true, "no permanent three-failure exclusion");
  }
  assert.equal(frameLoadReady(undefined, now), true, "clearing failures permits immediate reconnect recovery");
});

const frames = ["lobby", "store", "records", "lounge"].flatMap((room) =>
  [1, 2, 3, 4].map((frame) => `/sequences/${room}/frame-${String(frame).padStart(4, "0")}.webp?v=approved`),
);

test("fallbacks preserve versioned shared room endpoints in both scroll directions", () => {
  const spans = sequenceFallbackSpans(frames);
  const expected = [frames[0], frames[0], frames[4], frames[4], frames[4], frames[4], frames[8], frames[8], frames[8], frames[8], frames[12], frames[12], frames[12], frames[12], frames[15], frames[15]];
  assert.deepEqual(frames.map((_, index) => sequenceFallbackForFrame(spans, index)), expected);
  assert.deepEqual(frames.map((_, index) => sequenceFallbackForFrame(spans, frames.length - index - 1)), expected.toReversed());
  assert.equal(sequenceFallbackForFrame(spans, 3), frames[4], "direct Store arrival uses Store's canonical first frame, not the Lobby entrance");
  assert.equal(sequenceFallbackForFrame(spans, 11), frames[12], "Members arrival uses the Lounge's canonical still");
  assert.equal(sequenceFallbackForFrame([], 0), undefined);
  assert.equal(sequenceFallbackForFrame(spans, -1), undefined);
});

test("bootstrap permits two automatic retries then yields to static navigation", () => {
  assert.deepEqual([0, 1, 2, 3, 100].map(desktopJourneyRetryDelay), [400, 800, null, null, null]);
  assert.equal(desktopJourneyRetryDelay(0), 400, "explicit retry/reconnect starts a fresh bounded attempt set");
});

test("a stalled bootstrap is bounded and a late result cannot replace the failed attempt", async () => {
  let resolve!: (value: string) => void;
  const stalled = new Promise<string>((complete) => { resolve = complete; });
  const attempt = withSequenceLoadDeadline(stalled, new AbortController().signal, 5);
  await assert.rejects(attempt, /timed out/);
  resolve("late module");
  await assert.rejects(attempt, /timed out/);
});

test("bootstrap deadlines preserve valid results, errors, and cancellation", async () => {
  assert.equal(await withSequenceLoadDeadline(Promise.resolve("ready"), new AbortController().signal), "ready");
  await assert.rejects(withSequenceLoadDeadline(Promise.reject(new Error("bad manifest")), new AbortController().signal), /bad manifest/);
  const controller = new AbortController();
  const pending = withSequenceLoadDeadline(new Promise(() => {}), controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await assert.rejects(withSequenceLoadDeadline(Promise.resolve("already aborted"), controller.signal), { name: "AbortError" });
});
