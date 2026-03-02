import { useParams } from "react-router-dom";
import { CatalogLandingPage } from "@/routes/catalog/CatalogLandingPage";

export const MenPage = () => {
  const { categorySlug } = useParams();
  return <CatalogLandingPage mode="men" selectedSlug={categorySlug} />;
};
