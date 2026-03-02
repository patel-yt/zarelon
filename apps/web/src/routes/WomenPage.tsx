import { useParams } from "react-router-dom";
import { CatalogLandingPage } from "@/routes/catalog/CatalogLandingPage";

export const WomenPage = () => {
  const { categorySlug } = useParams();
  return <CatalogLandingPage mode="women" selectedSlug={categorySlug} />;
};
