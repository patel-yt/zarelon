import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchActiveDrops } from "@/services/drops";

export const DropsPage = () => {
  const query = useQuery({ queryKey: ["active-drops"], queryFn: fetchActiveDrops, refetchInterval: 15_000 });

  return (
    <div className="space-y-6 bg-white text-[#111111]">
      <h1 className="font-heading text-4xl text-[#111111]">Limited Drops</h1>
      <p className="text-sm text-[#444444]">Exclusive launches with countdown and access tiers.</p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(query.data ?? []).map((drop) => (
          <Link key={drop.id} to={`/drops/${drop.slug}`} className="group overflow-hidden rounded-2xl border border-black/10 bg-white">
            {drop.hero_media_type === "video" ? (
              <video src={drop.hero_media_url} className="h-52 w-full object-cover" autoPlay muted loop playsInline />
            ) : (
              <img src={drop.hero_media_url} alt={drop.name} className="h-52 w-full object-cover transition duration-300 group-hover:scale-105" />
            )}
            <div className="p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[#555555]">{drop.access_type} access</p>
              <p className="font-heading text-2xl text-[#111111]">{drop.name}</p>
            </div>
          </Link>
        ))}
      </div>
      {!query.isLoading && !(query.data ?? []).length ? (
        <div className="rounded-2xl border border-black/10 bg-[#fafafa] p-8 text-center text-[#444444]">No active drops yet.</div>
      ) : null}
    </div>
  );
};
