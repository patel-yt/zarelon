import { useParams } from "react-router-dom";
import { CatalogLandingPage } from "@/routes/catalog/CatalogLandingPage";

export const CollectionsPage = () => {
  const { collectionSlug } = useParams();
  return <CatalogLandingPage mode="collections" selectedSlug={collectionSlug} />;
};
