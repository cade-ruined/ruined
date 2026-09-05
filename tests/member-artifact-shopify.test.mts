import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  resolveMemberArtifactProducts,
  shopifyArtifactProductFromSpecification,
} from "../src/lib/membership/artifact-products.ts";
import type { Product } from "../src/data/products.ts";
import type { MemberArtifactsSnapshot } from "../src/lib/membership/model.ts";

async function source(relativePath: string) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    available: true,
    care: "Keep dry",
    code: "RU—001",
    description: "A hand-forged artifact.",
    id: "the-first-coin",
    image: {
      alt: "The First Coin on a workbench",
      url: "https://cdn.shopify.com/the-first-coin.jpg",
    },
    images: [],
    material: "Hand-forged metal",
    name: "The First Coin",
    options: [],
    origin: "Ruined Studio",
    price: "$ 100",
    shopifyProductGid: "gid://shopify/Product/123456789",
    subtitle: "A hand-forged artifact",
    tone: "shadow",
    variants: [],
    ...overrides,
  };
}

const access: MemberArtifactsSnapshot["access"] = {
  accessEndsAt: null,
  capabilities: ["artifacts.read"],
  mode: "full",
  reason: null,
};

function snapshot(): MemberArtifactsSnapshot {
  return {
    access,
    awards: [
      {
        acquisitionType: "earned",
        artifactState: "fulfilled",
        awardId: "award-1",
        description: "A hand-forged artifact.",
        earnedAt: "2026-08-25T16:00:00.000Z",
        earnedReason: "Foundations completed",
        fulfilledAt: "2026-08-26T16:00:00.000Z",
        imageUrl: null,
        inputRequired: false,
        name: "The First Coin",
        product: {
          href: null,
          imageAlt: null,
          imageUrl: null,
          name: null,
          productGid: "gid://shopify/Product/123456789",
          productHandle: "first-coin-old-handle",
          provider: "shopify",
        },
        trackingUrl: null,
      },
    ],
  };
}

test("artifact template specifications require a canonical Shopify product GID and safe handle", () => {
  const binding = shopifyArtifactProductFromSpecification({
    shopify: {
      product_gid: "gid://shopify/Product/123456789",
      product_handle: "the-first-coin",
    },
  });
  assert.equal(binding?.productGid, "gid://shopify/Product/123456789");
  assert.equal(binding?.productHandle, "the-first-coin");
  assert.equal(binding?.href, null);
  assert.equal(
    shopifyArtifactProductFromSpecification({
      shopify: {
        product_gid: "gid://shopify/ProductVariant/123456789",
        product_handle: "the-first-coin",
      },
    }),
    null,
  );
  assert.equal(
    shopifyArtifactProductFromSpecification({
      shopify: {
        product_gid: "gid://shopify/Product/123456789",
        product_handle: "../../checkout",
      },
    }),
    null,
  );
});

test("an artifact links only when its canonical GID resolves in the live Shopify catalogue", () => {
  const unresolved = resolveMemberArtifactProducts(snapshot(), []);
  assert.equal(unresolved.awards[0].product?.href, null);
  assert.equal(unresolved.awards[0].imageUrl, null);

  const resolved = resolveMemberArtifactProducts(snapshot(), [product()]);
  assert.equal(resolved.awards[0].product?.href, "/store/the-first-coin");
  assert.equal(resolved.awards[0].product?.productHandle, "the-first-coin");
  assert.equal(resolved.awards[0].product?.name, "The First Coin");
  assert.equal(
    resolved.awards[0].imageUrl,
    "https://cdn.shopify.com/the-first-coin.jpg",
  );

  const wrongGid = resolveMemberArtifactProducts(snapshot(), [
    product({ shopifyProductGid: "gid://shopify/Product/987654321" }),
  ]);
  assert.equal(wrongGid.awards[0].product?.href, null);
});

test("membership keeps Shopify authoritative and previews The First Coin without a fake storefront", async () => {
  const [shopify, products, repository, preview, homePage, artifactsPage, archive] =
    await Promise.all([
      source("src/lib/shopify.ts"),
      source("src/data/products.ts"),
      source("src/lib/membership/repository.ts"),
      source("src/lib/membership/preview.ts"),
      source("app/my/page.tsx"),
      source("app/my/artifacts/page.tsx"),
      source("src/components/membership/MemberArtifactArchive.tsx"),
    ]);

  assert.match(products, /shopifyProductGid\?: string/);
  assert.match(shopify, /shopifyProductGid: node\.id/);
  assert.match(repository, /left join artifact_template_versions template_version/);
  assert.match(repository, /left join artifact_templates template/);
  assert.match(repository, /shopifyArtifactProductFromSpecification\(row\.production_specification\)/);
  assert.match(repository, /where award\.member_id = \$\{identity\.memberId\}::uuid/);
  assert.match(repository, /and award\.person_id = \$\{identity\.personId\}::uuid/);
  assert.match(repository, /and award\.status <> 'revoked'/);
  assert.match(preview, /name: "The First Coin"/);
  assert.match(preview, /description: "A hand-forged artifact\."/);
  assert.match(preview, /product: null/);
  assert.match(preview, /PREVIEW_MEMBER_ARTIFACTS:[\s\S]*awards: \[previewArtifact\]/);
  assert.match(homePage, /resolveMemberHomeArtifactProducts\(context\.data, await getProducts\(\)\)/);
  assert.match(artifactsPage, /resolveMemberArtifactProducts\(context\.data, await getProducts\(\)\)/);
  assert.match(archive, /artifact\.product\?\.href/);
  assert.match(archive, /artifact\.imageUrl/);
});

test("The First Coin Artifact template v1 pins the real Shopify product identity", async () => {
  const [migration, migrationRunner] = await Promise.all([
    source("db/migrations/20260828_first_coin_artifact_template.sql"),
    source("scripts/migrate-platform.mjs"),
  ]);

  assert.match(migration, /^begin;[\s\S]*commit;\s*$/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('ruined-first-coin-artifact-template-v1'\)\)/);
  assert.match(migration, /'21935b51-7cbf-4cad-9564-380662b75c1b'/);
  assert.match(migration, /'2a1df4c5-7e44-4d50-a832-ec78c21de0ab'/);
  assert.match(migration, /'The First Coin'/);
  assert.match(migration, /'A hand-forged artifact\.'/);
  assert.match(migration, /'product_gid', 'gid:\/\/shopify\/Product\/10356658274625'/);
  assert.match(migration, /'product_handle', 'the-first-coin'/);
  assert.match(migration, /'published',[\s\S]*statement_timestamp\(\)/);
  assert.match(migration, /on conflict \(template_slug\) do nothing/);
  assert.match(migration, /on conflict \(artifact_template_id, version\) do nothing/);
  assert.match(migration, /conflicts with the approved Shopify binding/);
  assert.doesNotMatch(migration, /update public\.artifact_template_versions/);
  assert.ok(
    migrationRunner.indexOf("20260826_membership_operating_spine_05_content_operations.sql")
      < migrationRunner.indexOf("20260828_first_coin_artifact_template.sql"),
  );
});
