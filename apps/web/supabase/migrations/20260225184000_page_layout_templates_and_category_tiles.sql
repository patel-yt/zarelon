alter table public.site_sections
  add column if not exists layout_template text;

alter table public.categories
  add column if not exists display_image_url text;

create index if not exists idx_site_sections_layout_template
  on public.site_sections (page_location, layout_template);

create index if not exists idx_categories_display_order_gender
  on public.categories (gender, display_order);
