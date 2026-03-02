import type { ReactNode } from "react";

export type LayoutTemplatePreview =
  | "home-mixed"
  | "men-performance"
  | "women-editorial"
  | "collection-premium"
  | "collection-minimal"
  | "collection-story";

const fallbackTemplate: LayoutTemplatePreview = "home-mixed";

const previewProducts = [
  { id: "1", name: "Velocity Runner", category: "Shoes", price: "Rs 8,499", image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1100&q=80" },
  { id: "2", name: "Astra Jacket", category: "Outerwear", price: "Rs 6,999", image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1100&q=80" },
  { id: "3", name: "Noir Chrono", category: "Watches", price: "Rs 12,999", image: "https://images.unsplash.com/photo-1524592094714-0f0654e20314?auto=format&fit=crop&w=1100&q=80" },
  { id: "4", name: "Silk Line Dress", category: "Apparel", price: "Rs 5,299", image: "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1100&q=80" },
];

const previewCategories = [
  { id: "c1", name: "Watches", image: "https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?auto=format&fit=crop&w=900&q=80" },
  { id: "c2", name: "Shoes", image: "https://images.unsplash.com/photo-1491553895911-0055eca6402d?auto=format&fit=crop&w=900&q=80" },
  { id: "c3", name: "Apparel", image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80" },
];

const ProductMockCard = ({ item }: { item: (typeof previewProducts)[number] }) => (
  <article className="overflow-hidden rounded-xl border border-black/10 bg-white">
    <img src={item.image} alt={item.name} className="h-40 w-full object-cover" loading="lazy" decoding="async" />
    <div className="p-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-black/60">{item.category}</p>
      <p className="font-heading text-lg text-[#101010]">{item.name}</p>
      <p className="text-sm text-black/80">{item.price}</p>
    </div>
  </article>
);

const Tile = ({ title, image }: { title: string; image: string }) => (
  <article className="relative overflow-hidden rounded-xl border border-black/10">
    <img src={image} alt={title} className="h-36 w-full object-cover transition duration-300 hover:scale-105" loading="lazy" decoding="async" />
    <div className="absolute inset-0 bg-gradient-to-t from-black/65 to-transparent" />
    <p className="absolute bottom-2 left-3 font-heading text-xl uppercase text-white">{title}</p>
  </article>
);

const sectionFrame = (children: ReactNode) => (
  <div className="space-y-4 rounded-2xl border border-black/10 bg-[#F8F7F5] p-4">{children}</div>
);

export const LayoutPreview = ({ template }: { template: string | null | undefined }) => {
  const resolved = (
    [
      "home-mixed",
      "men-performance",
      "women-editorial",
      "collection-premium",
      "collection-minimal",
      "collection-story",
    ] as const
  ).includes((template ?? "") as LayoutTemplatePreview)
    ? (template as LayoutTemplatePreview)
    : fallbackTemplate;

  if (resolved === "men-performance") {
    return (
      <div key={resolved} className="space-y-4 text-[#111111] transition-all duration-300">
        {sectionFrame(
          <>
            <div className="rounded-xl bg-[linear-gradient(115deg,#0F172A,#111827,#1F2937)] p-6 text-white">
              <p className="text-[11px] uppercase tracking-[0.2em] text-blue-200">Men Performance</p>
              <h3 className="mt-2 font-heading text-4xl uppercase">Built for Velocity</h3>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {previewProducts.slice(0, 3).map((item) => (
                <ProductMockCard key={item.id} item={item} />
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  if (resolved === "women-editorial") {
    return (
      <div key={resolved} className="space-y-4 text-[#111111] transition-all duration-300">
        {sectionFrame(
          <>
            <div className="rounded-xl bg-[linear-gradient(120deg,#111111,#3C2D3E,#5A415D)] p-6 text-white">
              <p className="text-[11px] uppercase tracking-[0.2em] text-pink-100">Women Editorial</p>
              <h3 className="mt-2 font-heading text-4xl uppercase">Fashion Narrative</h3>
            </div>
            <div className="grid gap-3 md:grid-cols-12">
              <div className="md:col-span-7">
                <ProductMockCard item={previewProducts[3]} />
              </div>
              <div className="grid gap-3 md:col-span-5">
                <ProductMockCard item={previewProducts[1]} />
                <ProductMockCard item={previewProducts[2]} />
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  if (resolved === "collection-premium") {
    return (
      <div key={resolved} className="space-y-4 text-[#111111] transition-all duration-300">
        {sectionFrame(
          <>
            <div className="rounded-xl bg-[linear-gradient(130deg,#111111,#2A2A2A,#4C3C1F)] p-6 text-white">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#EAD5A0]">Collection Premium</p>
              <h3 className="mt-2 font-heading text-4xl uppercase">Curated Gold Edit</h3>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <Tile title="Premium Drop" image={previewCategories[0].image} />
              <div className="grid gap-3">
                <Tile title="Signature Essentials" image={previewCategories[1].image} />
                <Tile title="Occasion Luxe" image={previewCategories[2].image} />
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  if (resolved === "collection-minimal") {
    return (
      <div key={resolved} className="space-y-4 text-[#111111] transition-all duration-300">
        {sectionFrame(
          <>
            <div className="rounded-xl border border-black/10 bg-white p-6">
              <p className="text-[11px] uppercase tracking-[0.2em] text-black/60">Collection Minimal</p>
              <h3 className="mt-2 font-heading text-4xl uppercase">Quiet Luxury</h3>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {previewProducts.slice(0, 4).map((item) => (
                <ProductMockCard key={item.id} item={item} />
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  if (resolved === "collection-story") {
    return (
      <div key={resolved} className="space-y-4 text-[#111111] transition-all duration-300">
        {sectionFrame(
          <>
            <div className="rounded-xl bg-[linear-gradient(120deg,#312E81,#1F2937)] p-6 text-white">
              <p className="text-[11px] uppercase tracking-[0.2em] text-indigo-200">Collection Story</p>
              <h3 className="mt-2 font-heading text-4xl uppercase">From Sketch to Statement</h3>
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              <Tile title="Chapter 1" image={previewCategories[0].image} />
              <Tile title="Chapter 2" image={previewCategories[1].image} />
              <Tile title="Chapter 3" image={previewCategories[2].image} />
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div key={resolved} className="space-y-4 text-[#111111] transition-all duration-300">
      {sectionFrame(
        <>
          <div className="rounded-xl bg-[linear-gradient(120deg,#111111,#343434,#575757)] p-6 text-white">
            <p className="text-[11px] uppercase tracking-[0.2em] text-white/80">Home Mixed</p>
            <h3 className="mt-2 font-heading text-4xl uppercase">Mixed Editorial Grid</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-12">
            <div className="md:col-span-7">
              <ProductMockCard item={previewProducts[0]} />
            </div>
            <div className="grid gap-3 md:col-span-5">
              <ProductMockCard item={previewProducts[1]} />
              <ProductMockCard item={previewProducts[2]} />
            </div>
            <div className="md:col-span-12">
              <Tile title="Wide Banner Story" image={previewCategories[2].image} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};
