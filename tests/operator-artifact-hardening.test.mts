import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canTransitionArtifactShipment,
  isLiveAwardableArtifactTemplate,
  matchesArtifactAwardRequest,
} from "../src/lib/platform/artifact-invariants.ts";

async function source(relativePath: string) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("only an exact verified live published version is awardable", () => {
  const base = {
    bindingVerified: true,
    livemode: true,
    status: "active",
    versionId: "version-1",
    versionStatus: "published",
  };
  assert.equal(isLiveAwardableArtifactTemplate(base), true);
  assert.equal(isLiveAwardableArtifactTemplate({ ...base, livemode: false }), false);
  assert.equal(isLiveAwardableArtifactTemplate({ ...base, bindingVerified: false }), false);
  assert.equal(isLiveAwardableArtifactTemplate({ ...base, versionStatus: "retired" }), false);
  assert.equal(isLiveAwardableArtifactTemplate({ ...base, versionId: null }), false);
});

test("shipment transitions preserve delivered and closed records as terminal evidence", () => {
  assert.equal(canTransitionArtifactShipment("label_created", "in_transit"), true);
  assert.equal(canTransitionArtifactShipment("in_transit", "delivered"), true);
  assert.equal(canTransitionArtifactShipment("exception", "in_transit"), true);
  assert.equal(canTransitionArtifactShipment("delivered", "exception"), false);
  assert.equal(canTransitionArtifactShipment("cancelled", "in_transit"), false);
  assert.equal(canTransitionArtifactShipment("returned", "delivered"), false);
  assert.equal(canTransitionArtifactShipment("delivered", "delivered"), true);
});

test("an award retry is accepted only when its persisted request identity is unchanged", () => {
  const request = {
    acquisitionType: "earned",
    memberId: "member-1",
    reason: "Foundations completed",
    templateVersionId: "version-1",
  };
  assert.equal(matchesArtifactAwardRequest(request, { ...request }), true);
  assert.equal(matchesArtifactAwardRequest(request, { ...request, memberId: "member-2" }), false);
  assert.equal(matchesArtifactAwardRequest(request, { ...request, reason: "Different reason" }), false);
});

test("the new migration pins Shopify mode to versions and enforces award and delivery invariants", async () => {
  const [migration, runner] = await Promise.all([
    source("db/migrations/20260828_operator_artifact_hardening.sql"),
    source("scripts/migrate-platform.mjs"),
  ]);
  assert.match(migration, /add column if not exists shopify_livemode boolean/);
  assert.match(migration, /artifact_template_versions_one_published_idx/);
  assert.match(migration, /artifact_template_version_id/);
  assert.match(migration, /version_livemode is distinct from true/);
  assert.match(migration, /add column if not exists operator_request_key uuid/);
  assert.match(migration, /artifact_awards_operator_request_key_idx/);
  assert.match(migration, /artifact_awards_live_binding_guard/);
  assert.match(migration, /artifact_fulfillment_shipments_transition_guard/);
  assert.match(migration, /create constraint trigger artifact_fulfillment_shipments_delivery_consistency/);
  assert.match(migration, /deferrable initially deferred/);
  assert.match(migration, /requires its production job to be fulfilled in the same transaction/);
  assert.match(migration, /requires its award to be fulfilled in the same transaction/);
  assert.match(runner, /20260828_operator_artifact_hardening\.sql/);
});

test("operator mutations persist retry keys, block test awards, reconcile delivery, and record corrections", async () => {
  const [repository, awardRoute, shipmentRoute, controls] = await Promise.all([
    source("src/lib/platform/ops-artifact-repository.ts"),
    source("app/api/ops/artifact-awards/route.ts"),
    source("app/api/ops/artifact-shipments/[shipmentId]/route.ts"),
    source("src/components/platform/OperatorArtifactAdmin.tsx"),
  ]);
  assert.match(repository, /version\.shopify_livemode = true/);
  assert.match(repository, /binding\.metadata ->> 'artifact_template_version_id' = version\.id::text/);
  assert.match(repository, /operator_request_key/);
  assert.match(repository, /on conflict \(operator_request_key\)/);
  assert.match(repository, /replayed: true/);
  assert.match(repository, /update artifact_jobs[\s\S]*status = 'fulfilled'/);
  assert.match(repository, /update artifact_awards[\s\S]*status = 'fulfilled'/);
  assert.match(repository, /update member_lifecycle[\s\S]*artifact_state = \$\{projectedState\}/);
  assert.match(repository, /'tracking_updated'/);
  assert.match(repository, /artifact\.shipment_tracking_corrected/);
  assert.match(awardRoute, /requestKey/);
  assert.match(awardRoute, /award\.replayed \? 200 : 201/);
  assert.match(shipmentRoute, /expectedVersion/);
  assert.match(shipmentRoute, /changeReason/);
  assert.match(controls, /crypto\.randomUUID\(\)/);
  assert.match(controls, /Why this changed/);
  assert.match(controls, /isLiveAwardableArtifactTemplate/);
});
