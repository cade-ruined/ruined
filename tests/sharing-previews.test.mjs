import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import sharp from "sharp";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const origin = "https://theruinedproject.com";
const legacyKeys = ["home", "store", "about", "community", "members", "work"];
const cassettePath = "sharing/ruined-cassette-v1.jpg";
const cassetteUrl = `${origin}/${cassettePath}`;
// Exact original approved artwork, recovered from git blob fcbd1acae33c4ea4f9f8be894b7cf517998c2468.
const cassetteSha256 = "63db0a24423200760a5b683d98850d19e5d43e0eb5253230b4745c1817ef4ad2";

function load(file, environment = {}, dependencies = {}) {
  const cache = new Map();
  function readModule(filename) {
    if (cache.has(filename)) return cache.get(filename);
    if (extname(filename) === ".json") {
      const value = JSON.parse(readFileSync(filename, "utf8"));
      cache.set(filename, value);
      return value;
    }
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    const output = { exports: {} };
    cache.set(filename, output.exports);
    new Function("require", "module", "exports", "process", compiled)((name) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (name === "server-only") return {};
      assert.ok(name.startsWith("@/") || name.startsWith("."), `Unexpected sharing dependency: ${name}`);
      const dependency = name.startsWith("@/")
        ? resolve(root, "src", name.slice(2))
        : resolve(dirname(filename), name);
      return readModule(extname(dependency) ? dependency : `${dependency}.ts`);
    }, output, output.exports, { env: environment });
    cache.set(filename, output.exports);
    return output.exports;
  }
  return readModule(resolve(root, file));
}

const { sharingMetadata, sharingImage, privateSharingMetadata } = load("src/lib/sharing.ts");
const previews = JSON.parse(readFileSync(resolve(root, "src/lib/sharing-previews.json"), "utf8"));
const imageUrls = (images) => images.map((image) => typeof image === "string" ? image : String(image.url));

test("every public page shares the same cassette image with matching Open Graph and Twitter content", () => {
  for (const page of legacyKeys) {
    const path = page === "home" ? "/" : `/${page}`;
    const title = page === "home" ? "Ruined" : page;
    const description = `A description for ${page}.`;
    const metadata = sharingMetadata({ title, description, path });
    assert.equal(metadata.openGraph.title, metadata.twitter.title, page);
    assert.equal(metadata.openGraph.description, description, page);
    assert.equal(metadata.twitter.description, description, page);
    assert.equal(metadata.twitter.card, "summary_large_image", page);
    assert.equal(String(metadata.openGraph.url), `${origin}${path}`, page);
    assert.deepEqual(imageUrls(metadata.openGraph.images), [cassetteUrl], page);
    assert.deepEqual(metadata.twitter.images, metadata.openGraph.images, page);
    assert.equal(metadata.openGraph.images[0].alt, previews.alt);
  }
  assert.deepEqual(sharingImage(), { url: cassetteUrl, width: 1200, height: 630, alt: previews.alt });
});

test("social titles add the brand once and preserve titles already containing the brand", () => {
  for (const [title, expected] of [
    ["Store", "Store — Ruined"],
    ["Sunday Clothes Hoodie", "Sunday Clothes Hoodie — Ruined"],
    ["Ruined", "Ruined"],
    ["About Ruined", "About Ruined"],
    ["Store — Ruined", "Store — Ruined"],
  ]) {
    const metadata = sharingMetadata({ title, description: "Description", path: "/store" });
    assert.equal(metadata.openGraph.title, expected);
    assert.equal(metadata.twitter.title, expected);
  }
});

test("page-specific and product image inputs cannot replace the approved cassette artwork", () => {
  for (const images of [undefined, [], [{ url: "https://cdn.shopify.com/product-blue.jpg", alt: "Blue product" }]]) {
    const metadata = sharingMetadata({
      title: "Sunday Clothes Hoodie", description: "Product description", path: "/store/sunday-clothes-hoodie?color=Blue",
      image: "store", images,
    });
    assert.equal(metadata.openGraph.url, `${origin}/store/sunday-clothes-hoodie?color=Blue`);
    assert.deepEqual(imageUrls(metadata.openGraph.images), [cassetteUrl]);
    assert.deepEqual(imageUrls(metadata.twitter.images), imageUrls(metadata.openGraph.images));
  }
  const metadata = sharingMetadata({ title: "Contact", description: "Contact Ruined", path: "/contact" });
  assert.deepEqual(imageUrls(metadata.openGraph.images), [cassetteUrl]);
});

function productMetadataFixture(overrides = {}) {
  const photo = (color, view) => ({
    url: `https://cdn.shopify.com/s/files/1/1001/4077/7793/files/SundayClothes-${color}Hoodie${view}.png?v=1789413276&width=1600`,
    alt: `${color} hoodie, ${view.toLowerCase()}`,
  });
  const black = [photo("Black", "Front"), photo("Black", "Back")];
  const blue = [photo("Blue", "Front"), photo("Blue", "Back")];
  const product = {
    id: "sunday-clothes-hoodie", name: "Sunday Clothes Hoodie", description: "Cotton hoodie.",
    image: black[0], images: [black[0], blue[1], black[1], blue[0]],
    options: [{ name: "Color", values: ["Black", "Blue"] }],
    variants: ["Black", "Blue"].map((color) => ({ selectedOptions: [{ name: "Color", value: color }] })),
    ...overrides,
  };
  const component = { __esModule: true, default: () => null };
  const route = load("app/store/[handle]/page.tsx", {}, {
    "react/jsx-runtime": {},
    "next/link": component,
    "next/navigation": { notFound: () => { throw new Error("Unexpected page rendering in metadata test"); } },
    "@/components/store/ProductDetail": component,
    "@/components/store/ProductDescription": component,
    "@/lib/shopify": { getProducts: async () => [product] },
  });
  return {
    black, blue,
    metadata: (color, handle = product.id) => route.generateMetadata({
      params: Promise.resolve({ handle }), searchParams: Promise.resolve({ color }),
    }),
  };
}

test("the actual product metadata route preserves the selected color URL but always shares the cassette image", async () => {
  const fixture = productMetadataFixture();
  for (const [requested, expectedColor] of [["Blue", "Blue"], ["Black", "Black"], [undefined, "Black"], ["Chartreuse", "Black"], [["Blue"], "Black"]]) {
    const metadata = await fixture.metadata(requested);
    assert.equal(metadata.title, "Sunday Clothes Hoodie");
    assert.equal(metadata.openGraph.title, "Sunday Clothes Hoodie — Ruined");
    assert.equal(metadata.twitter.title, metadata.openGraph.title);
    assert.equal(metadata.openGraph.url, `${origin}/store/sunday-clothes-hoodie?color=${expectedColor}`);
    assert.equal(metadata.alternates.canonical, "/store/sunday-clothes-hoodie");
    assert.deepEqual(imageUrls(metadata.openGraph.images), [cassetteUrl]);
    assert.deepEqual(metadata.twitter.images, metadata.openGraph.images);
    assert.equal(metadata.openGraph.images[0].alt, previews.alt);
  }
});

test("products without any photography still share the same cassette image", async () => {
  const fixture = productMetadataFixture({ image: undefined, images: [] });
  const metadata = await fixture.metadata("Blue");
  assert.equal(metadata.openGraph.url, `${origin}/store/sunday-clothes-hoodie?color=Blue`);
  assert.deepEqual(imageUrls(metadata.openGraph.images), [cassetteUrl]);
  assert.deepEqual(imageUrls(metadata.twitter.images), imageUrls(metadata.openGraph.images));
});

test("an unknown product clears inherited marketing metadata before the page returns not found", async () => {
  const metadata = await productMetadataFixture().metadata("Blue", "missing-product");
  assert.equal(metadata.openGraph, null);
  assert.equal(metadata.twitter, null);
  assert.equal(metadata.alternates.canonical, null);
});

test("social copy strips markup and the rejected apparel terminology in both channels", () => {
  const metadata = sharingMetadata({
    title: "<b>Garments</b>", description: " Discover <em>garments</em>  and objects. ", path: "/store",
  });
  assert.equal(metadata.openGraph.title, "Apparel — Ruined");
  assert.equal(metadata.openGraph.description, "Discover apparel and objects.");
  assert.equal(metadata.openGraph.images[0].alt, previews.alt);
  assert.deepEqual(metadata.twitter.images, metadata.openGraph.images);
  assert.equal(metadata.twitter.title, metadata.openGraph.title);
  assert.equal(metadata.twitter.description, metadata.openGraph.description);
});

test("private routes explicitly clear inherited social cards and the public home canonical", () => {
  assert.equal(privateSharingMetadata.openGraph, null);
  assert.equal(privateSharingMetadata.twitter, null);
  assert.equal(privateSharingMetadata.alternates.canonical, null);
});

test("preview and member deployment environment values cannot redirect public card assets", () => {
  for (const NEXT_PUBLIC_SITE_URL of ["http://localhost:3001", "https://preview.vercel.app", "https://members.theruinedproject.com"]) {
    const helper = load("src/lib/sharing.ts", { NEXT_PUBLIC_SITE_URL });
    const metadata = helper.sharingMetadata({ title: "Store", description: "Store description", path: "/store" });
    assert.equal(String(metadata.openGraph.url), `${origin}/store`);
    for (const url of [...imageUrls(metadata.openGraph.images), ...imageUrls(metadata.twitter.images)]) {
      assert.equal(new URL(url).protocol, "https:");
      assert.equal(new URL(url).origin, origin);
    }
  }
});

test("the shared source is the exact approved original 1200 by 630 cassette JPEG", async () => {
  assert.equal(previews.source, cassettePath);
  assert.ok(previews.alt.trim(), "The cassette artwork needs descriptive alt text");
  assert.equal(previews.width, 1200);
  assert.equal(previews.height, 630);
  const source = resolve(root, "public", previews.source);
  assert.ok(statSync(source).size < 400_000, "The approved artwork must remain under 400 KB");
  assert.equal(createHash("sha256").update(readFileSync(source)).digest("hex"), cassetteSha256);
  const image = await sharp(source).metadata();
  assert.equal(image.format, "jpeg");
  assert.equal(image.width, previews.width);
  assert.equal(image.height, previews.height);
});

test("all legacy image URLs serve byte-identical cassette artwork without Next metadata file overrides", () => {
  const cassette = readFileSync(resolve(root, "public", cassettePath));
  for (const file of ["opengraph-image.jpg", "twitter-image.jpg"]) {
    assert.deepEqual(readFileSync(resolve(root, "public", file)), cassette);
    assert.equal(existsSync(resolve(root, "app", file)), false, `${file} in app would override explicit metadata`);
  }
  for (const key of legacyKeys) {
    assert.deepEqual(readFileSync(resolve(root, "public/sharing", `${key}-v2.jpg`)), cassette, `${key} compatibility image must not retain the rejected room artwork`);
  }
  for (const route of ["store", "about", "work"]) {
    assert.equal(existsSync(resolve(root, "app", route, "opengraph-image.tsx")), false, `${route} must use the shared preview metadata`);
  }
});

test("the sharing generator copies artwork without re-rendering, typography overlays, or new image composition", () => {
  const generator = readFileSync(resolve(root, "scripts/gen-sharing-previews.mjs"), "utf8");
  assert.match(generator, /copyFile\(source,/);
  assert.doesNotMatch(generator, /ImageResponse|\.(?:resize|composite|jpeg|png|toBuffer)\(|IvyOra|ruined-wordmark/);
  assert.doesNotMatch(generator, /GARMENTS|CURRENT PIECES|AFTER THE FEAR|STUDIO NO\. 17|MATERIAL RECORDS|Georgia|Arial/);
  assert.doesNotMatch(generator, /<(?:text|span)[^>]*>\s*RUINED\s*<\//i);
});

function syntaxNodes(filename) {
  const source = readFileSync(resolve(root, filename), "utf8");
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes = [];
  function visit(node) {
    nodes.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return nodes;
}

test("public route families share the same Open Graph and Twitter helper", () => {
  const routes = [
    "app/layout.tsx", "app/about/page.tsx", "app/store/page.tsx", "app/store/[handle]/page.tsx",
    "app/community/page.tsx", "app/community/byob-02/register/page.tsx", "app/community/byob-03/register/page.tsx",
    "app/work/page.tsx", "app/work/[slug]/page.tsx", "app/contact/page.tsx",
    "app/privacy/page.tsx", "app/terms/page.tsx", "app/shipping-returns/page.tsx",
  ];
  for (const route of routes) {
    const nodes = syntaxNodes(route);
    assert.ok(nodes.some((node) => ts.isSpreadAssignment(node)
      && ts.isCallExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === "sharingMetadata"), `${route} must spread both social channels together`);
    assert.equal(nodes.some((node) => ts.isPropertyAssignment(node)
      && ["openGraph", "twitter"].includes(node.name.getText())), false, `${route} must not replace one social channel independently`);
    for (const node of nodes.filter((entry) => ts.isCallExpression(entry)
      && ts.isIdentifier(entry.expression) && entry.expression.text === "sharingMetadata")) {
      const options = node.arguments[0];
      assert.ok(options && ts.isObjectLiteralExpression(options), `${route} needs explicit sharing metadata`);
      assert.equal(options.properties.some((property) => property.name
        && ["image", "images"].includes(property.name.getText())), false, `${route} must not select its own artwork`);
    }
  }
});

test("private route families use the metadata reset so public marketing cards do not leak into account links", () => {
  for (const route of [
    "app/my/layout.tsx", "app/ops/layout.tsx", "app/dive/layout.tsx", "app/bag/page.tsx",
    "app/foundations/page.tsx", "app/communications/confirm/page.tsx",
    "app/my/join/complete/page.tsx",
  ]) {
    assert.ok(syntaxNodes(route).some((node) => ts.isSpreadAssignment(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "privateSharingMetadata"), `${route} must clear inherited social metadata`);
  }
});

test("the general brand asset command delegates sharing output to the approved renderer", () => {
  const script = readFileSync(resolve(root, "scripts/gen-brand-assets.mjs"), "utf8");
  const nodes = syntaxNodes("scripts/gen-brand-assets.mjs");
  assert.ok(nodes.some((node) => ts.isImportDeclaration(node)
    && ts.isStringLiteral(node.moduleSpecifier)
    && node.moduleSpecifier.text === "./gen-sharing-previews.mjs"
    && node.importClause?.namedBindings
    && ts.isNamedImports(node.importClause.namedBindings)
    && node.importClause.namedBindings.elements.some((binding) => binding.name.text === "generateSharingPreviews")));
  assert.ok(nodes.some((node) => ts.isCallExpression(node)
    && ts.isIdentifier(node.expression) && node.expression.text === "generateSharingPreviews"));
  assert.doesNotMatch(script, /opengraph-image|twitter-image|ImageResponse|overlaySvg|ogSvg|GARMENTS|CURRENT PIECES|AFTER THE FEAR|STUDIO NO\. 17/);
});
