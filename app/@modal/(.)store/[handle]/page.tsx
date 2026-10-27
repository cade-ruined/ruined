import { notFound } from "next/navigation";
import ProductModal from "@/components/store/ProductModal";
import ProductDetail from "@/components/store/ProductDetail";
import ProductDescription from "@/components/store/ProductDescription";
import { getProducts } from "@/lib/shopify";

export const dynamic = "force-dynamic";

export default async function ProductModalPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const product = (await getProducts()).find((item) => item.id === handle);
  if (!product) notFound();

  return (
    <ProductModal handle={product.id} name={product.name}>
      <ProductDetail product={product} modal>
        <ProductDescription description={product.description} descriptionHtml={product.descriptionHtml} expectedShipDate={product.expectedShipDate} />
      </ProductDetail>
    </ProductModal>
  );
}
