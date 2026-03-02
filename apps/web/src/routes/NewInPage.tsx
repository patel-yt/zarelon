import { useParams } from "react-router-dom";
import { CatalogLandingPage } from "@/routes/catalog/CatalogLandingPage";

export const NewInPage = () => {
  const { categorySlug } = useParams();
  return <CatalogLandingPage mode="new-in" selectedSlug={categorySlug} />;
};
