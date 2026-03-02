import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { deleteCategory, fetchCategories, upsertCategory } from "@/services/categories";
import type { Category } from "@/types/domain";

const emptyForm: Partial<Category> = {
  name: "",
  slug: "",
  parent_slug: null,
  image_url: null,
  display_image_url: null,
  gender: null,
  display_order: 0,
  description: null,
  is_active: true,
};

export const AdminCategoriesPage = () => {
  const [form, setForm] = useState<Partial<Category>>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const query = useQuery({ queryKey: ["admin-categories"], queryFn: fetchCategories });

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-3xl text-gold-200">Category Manager</h1>
      <form
        className="grid gap-3 rounded-xl border border-white/10 p-4 md:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          setSuccess("");
          if (!form.name?.trim() || !form.slug?.trim()) {
            setError("Name and slug are required.");
            return;
          }
          try {
            setSaving(true);
            await upsertCategory({
              id: form.id,
              name: form.name,
              slug: form.slug,
              parent_slug: form.parent_slug ?? null,
              image_url: form.image_url ?? null,
              display_image_url: form.display_image_url ?? null,
              gender: form.gender ?? null,
              display_order: Number(form.display_order ?? 0),
              description: form.description ?? null,
              is_active: form.is_active ?? true,
            });
            await query.refetch();
            setForm(emptyForm);
            setSuccess("Category saved.");
          } catch (err) {
            setError((err as Error)?.message ?? "Could not save category.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <input
          value={form.name ?? ""}
          onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          placeholder="Name"
          className="rounded-lg border-white/20 bg-black/20"
        />
        <input
          value={form.slug ?? ""}
          onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))}
          placeholder="Slug"
          className="rounded-lg border-white/20 bg-black/20"
        />
        <input
          value={form.parent_slug ?? ""}
          onChange={(event) => setForm((prev) => ({ ...prev, parent_slug: event.target.value || null }))}
          placeholder="Parent Slug (optional)"
          className="rounded-lg border-white/20 bg-black/20"
        />
        <select
          value={form.gender ?? ""}
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              gender: (event.target.value || null) as "men" | "women" | "unisex" | null,
            }))
          }
          className="rounded-lg border-white/20 bg-black/20"
        >
          <option value="">Any Gender</option>
          <option value="men">Men</option>
          <option value="women">Women</option>
          <option value="unisex">Unisex</option>
        </select>
        <input
          value={form.image_url ?? ""}
          onChange={(event) => setForm((prev) => ({ ...prev, image_url: event.target.value || null }))}
          placeholder="Category Image URL"
          className="rounded-lg border-white/20 bg-black/20"
        />
        <input
          value={form.display_image_url ?? ""}
          onChange={(event) => setForm((prev) => ({ ...prev, display_image_url: event.target.value || null }))}
          placeholder="Tile Display Image URL"
          className="rounded-lg border-white/20 bg-black/20"
        />
        <input
          type="number"
          value={Number(form.display_order ?? 0)}
          onChange={(event) => setForm((prev) => ({ ...prev, display_order: Number(event.target.value) }))}
          placeholder="Display Order"
          className="rounded-lg border-white/20 bg-black/20"
        />
        <label className="flex items-center gap-2 text-xs text-white/80">
          <input
            type="checkbox"
            checked={Boolean(form.is_active)}
            onChange={(event) => setForm((prev) => ({ ...prev, is_active: event.target.checked }))}
          />
          Active
        </label>
        <textarea
          value={form.description ?? ""}
          onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value || null }))}
          placeholder="Description"
          className="rounded-lg border-white/20 bg-black/20 md:col-span-2"
          rows={2}
        />
        {error ? <p className="text-xs text-rose-300 md:col-span-2">{error}</p> : null}
        {success ? <p className="text-xs text-emerald-300 md:col-span-2">{success}</p> : null}
        <div className="md:col-span-2 flex gap-2">
          <Button type="submit" disabled={saving}>{saving ? "Saving..." : form.id ? "Update Category" : "Add Category"}</Button>
          {form.id ? (
            <Button type="button" variant="ghost" onClick={() => setForm(emptyForm)}>
              Cancel Edit
            </Button>
          ) : null}
        </div>
      </form>

      <div className="space-y-2">
        {(query.data ?? []).map((category) => (
          <div key={category.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 p-3">
            <div>
              <p className="text-sm text-white">{category.name} ({category.slug})</p>
              <p className="text-xs text-white/60">
                order {category.display_order} | {category.gender ?? "any"} | {category.is_active ? "active" : "inactive"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setForm(category)}>
                Edit
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={async () => {
                  if (!window.confirm("Delete this category?")) return;
                  await deleteCategory(category.id);
                  await query.refetch();
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
